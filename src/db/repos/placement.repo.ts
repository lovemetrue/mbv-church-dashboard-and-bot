import type { Pool, PoolClient } from 'pg';
import { groupCode } from '../../core/groups.js';
import { PASSING_STATUSES } from '../../core/matching.js';

/**
 * «Предварительно» и решения координатора.
 *
 * Главное правило: предложение (расчёта или языковой модели) заявку не меняет. Человек
 * считается распределённым только после `approve` — он единственный, кто пишет в `requests`,
 * и делает это вместе с записью в журнал, в одной транзакции: нет утверждения без следа и следа
 * без утверждения.
 */

export type RejectReason = 'time' | 'far' | 'age' | 'declined' | 'other';
export const REJECT_REASONS: readonly RejectReason[] = ['time', 'far', 'age', 'declined', 'other'];

export type ActionFailure = 'bad_request' | 'not_found' | 'already_closed' | 'group_unavailable' | 'group_full';
export type ActionOutcome = { ok: true } | { ok: false; error: ActionFailure; message: string };

type Failure = Extract<ActionOutcome, { ok: false }>;
const fail = (error: ActionFailure, message: string): Failure => ({ ok: false, error, message });

const CLOSED = ['Исполнена', 'Аннулирована'];

interface RequestState {
  status: string;
  group_id: number | null;
  final_group: string | null;
  callback: boolean;
}

export class PlacementRepo {
  constructor(private readonly db: Pool) {}

  /** Транзакция с откатом при любой ошибке: половина действия (заявка без журнала) недопустима. */
  private async tx<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * Заявка под блокировкой: два координатора, нажавшие одновременно, не утвердят её дважды.
   * Возвращает исход-ошибку, если заявки нет или она уже закрыта.
   */
  private async lockOpenRequest(c: PoolClient, id: number): Promise<RequestState | Failure> {
    const { rows } = await c.query<RequestState>(
      `SELECT status, group_id, final_group, callback FROM requests
        WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    if (!row) return fail('not_found', 'Заявка не найдена.');
    if (CLOSED.includes(row.status)) return fail('already_closed', 'Заявку уже обработали.');
    return row;
  }

  private static isFailure(x: RequestState | Failure): x is Failure {
    return 'ok' in x;
  }

  private async audit(
    c: PoolClient, actor: string, action: string, requestId: number,
    before: unknown, after: unknown, note: string | null,
  ): Promise<void> {
    await c.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, before, after, note)
       VALUES ($1, 'home-groups', $2, 'request', $3, $4::jsonb, $5::jsonb, $6)`,
      [actor, action, requestId, JSON.stringify(before), JSON.stringify(after), note],
    );
  }

  /** Утвердить: заявка исполнена, привязана к группе; предложение помечено принятым. */
  async approve(
    requestId: number, groupId: number, actor: string,
    opts: { force: boolean; defaultCapacity: number },
  ): Promise<ActionOutcome> {
    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;

      const { rows } = await c.query<{
        id: number; leader: string; status: string; open_to_new: string | null; do_not_refer: boolean; people: number | null;
      }>(
        `SELECT id, leader, status, open_to_new, do_not_refer, people
           FROM groups WHERE id = $1 AND archived_at IS NULL FOR SHARE`,
        [groupId],
      );
      const g = rows[0];
      if (!g) return fail('group_unavailable', 'Группа не найдена или в архиве.');
      if (g.do_not_refer) return fail('group_unavailable', 'В эту группу направлять нельзя («Не направлять»).');
      if (!PASSING_STATUSES.has(g.status)) return fail('group_unavailable', `Группа не принимает людей: статус «${g.status}».`);
      // Мест нет — не запрет: координатор мог договориться с ведущим. Но решает он осознанно (force).
      if (!opts.force && g.people !== null && g.people >= opts.defaultCapacity) {
        return fail('group_full', 'В группе нет свободных мест.');
      }

      const finalGroup = `${groupCode(g.id)}, ${g.leader}`;
      // origin: правка заявки из таблицы церкви переводит её под управление интерфейса, иначе
      // повторный перенос таблицы стёр бы утверждение (импорт удаляет и заводит заново origin='таблица').
      await c.query(
        `UPDATE requests
            SET status = 'Исполнена', group_id = $2, final_group = $3, callback = false,
                handled_by = $4, handled_at = now(),
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, g.id, finalGroup, actor],
      );

      // Предложение на эту же группу принимается; остальные действующие заменяются.
      const accepted = await c.query(
        `UPDATE placement_proposals SET status = 'approved', decided_by = $3, decided_at = now()
          WHERE request_id = $1 AND status = 'proposed' AND group_id = $2`,
        [requestId, g.id, actor],
      );
      await c.query(
        `UPDATE placement_proposals SET status = 'superseded', decided_by = $2, decided_at = now()
          WHERE request_id = $1 AND status = 'proposed'`,
        [requestId, actor],
      );
      // Расчёт сервиса не хранится (он пересчитывается на каждый показ), поэтому утверждение
      // без сохранённого предложения записываем как решение координатора.
      if ((accepted.rowCount ?? 0) === 0) {
        await c.query(
          `INSERT INTO placement_proposals (request_id, group_id, source, status, decided_by, decided_at)
           VALUES ($1, $2, 'manual', 'approved', $3, now())`,
          [requestId, g.id, actor],
        );
      }

      await this.audit(
        c, actor, 'request.approve', requestId,
        { status: state.status, group_id: state.group_id, final_group: state.final_group, callback: state.callback },
        { status: 'Исполнена', group_id: g.id, final_group: finalGroup, callback: false },
        opts.force && g.people !== null && g.people >= opts.defaultCapacity ? 'утверждено без свободных мест' : null,
      );
      return { ok: true } as const;
    });
  }

  /** Отклонить предложенную группу: заявка остаётся открытой, а группа больше не предлагается. */
  async reject(
    requestId: number, groupId: number, reason: RejectReason, comment: string | null, actor: string,
  ): Promise<ActionOutcome> {
    if (!REJECT_REASONS.includes(reason)) return fail('bad_request', 'Неизвестная причина отказа.');
    const note = comment?.trim() || null;
    if (reason === 'other' && !note) return fail('bad_request', 'Для причины «Другое» нужен комментарий.');

    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      const group = await c.query('SELECT 1 FROM groups WHERE id = $1', [groupId]);
      if ((group.rowCount ?? 0) === 0) return fail('bad_request', 'Такой группы нет.');

      const updated = await c.query(
        `UPDATE placement_proposals
            SET status = 'rejected', reject_reason = $3, reject_comment = $4, decided_by = $5, decided_at = now()
          WHERE request_id = $1 AND group_id = $2 AND status IN ('proposed', 'rejected')`,
        [requestId, groupId, reason, note, actor],
      );
      // Предложение расчёта не хранится, поэтому отказ записываем как самостоятельную строку.
      if ((updated.rowCount ?? 0) === 0) {
        await c.query(
          `INSERT INTO placement_proposals
             (request_id, group_id, source, status, reject_reason, reject_comment, decided_by, decided_at)
           VALUES ($1, $2, 'script', 'rejected', $3, $4, $5, now())`,
          [requestId, groupId, reason, note, actor],
        );
      }
      await this.audit(c, actor, 'request.reject', requestId, { group_id: groupId }, { rejected_group_id: groupId, reason }, note);
      return { ok: true } as const;
    });
  }

  /** Отметка «нужен звонок»: решение человека, поэтому она в заявке, а не в расчёте. */
  async setNeedCall(requestId: number, value: boolean, actor: string): Promise<ActionOutcome> {
    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      if (state.callback === value) return { ok: true } as const;
      await c.query(
        `UPDATE requests SET callback = $2,
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, value],
      );
      await this.audit(c, actor, value ? 'request.need_call' : 'request.need_call_off', requestId,
        { callback: state.callback }, { callback: value }, null);
      return { ok: true } as const;
    });
  }

  /** Группы, которые координатор уже отклонил для заявки: движок их не предлагает снова. */
  async rejectedGroups(): Promise<Map<number, number[]>> {
    const { rows } = await this.db.query<{ request_id: number; group_id: number }>(
      `SELECT request_id, group_id FROM placement_proposals WHERE status = 'rejected' AND group_id IS NOT NULL`,
    );
    const byRequest = new Map<number, number[]>();
    for (const r of rows) byRequest.set(Number(r.request_id), [...(byRequest.get(Number(r.request_id)) ?? []), Number(r.group_id)]);
    return byRequest;
  }
}
