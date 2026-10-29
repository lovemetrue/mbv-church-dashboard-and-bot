import type { Pool, PoolClient } from 'pg';
import { groupCode } from '../../core/groups.js';
import { PASSING_STATUSES } from '../../core/matching.js';
import { normalizePhone } from '../../core/phone.js';
import { cancelQueuedNotices, enqueuePlacementNotices } from './placementNotices.repo.js';
import { humanOfRequest, readHuman, writeToHuman, type ContactPatch } from './contacts.repo.js';
import { diffSnapshots, parseSnapshot, type InputSnapshot } from '../../home-groups/plan/signature.js';

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

/** Поля заявки, которые координатор правит вручную; `null` или пустая строка очищают поле (кроме ФИО). */
export interface RequestEdit {
  fio?: string | null; phone?: string | null; age?: string | null; place?: string | null; note?: string | null; address?: string | null; schedule?: string | null; hobby?: string | null; profession?: string | null; family?: string | null;
  source?: string | null; ministry?: string | null; extra?: string | null; recommended?: string | null; recommendedAt?: string | null; attendance?: string | null;
}
const EDIT_LIMITS: Record<keyof RequestEdit, number> = {
  fio: 200, phone: 40, age: 60, place: 200, note: 1000, address: 200, schedule: 200, hobby: 200, profession: 200, family: 200,
  source: 200, ministry: 200, extra: 2000, recommended: 200, recommendedAt: 10, attendance: 200,
};
// Поля человека (ФИО, телефон, возраст, район, адрес, время, хобби, профессия, семья) пишутся в его запись — регистрацию
// или карточку (миграция 057): заявка на него ссылается. Комментарий и поля из таблицы церкви (источник, служение,
// рекомендация…) — свойство самой заявки. «Ходит в группу» (текст из таблицы) здесь не правится: куда человек ходит,
// задаёт утверждение в группу, и второе поле о том же разошлось бы с ним.
const HUMAN_FIELDS = ['fio', 'phone', 'age', 'place', 'address', 'schedule', 'hobby', 'profession', 'family'] as const;
type HumanField = (typeof HUMAN_FIELDS)[number];
const isHumanField = (k: keyof RequestEdit): k is HumanField => (HUMAN_FIELDS as readonly string[]).includes(k);
const REQUEST_EDIT_COLUMNS: Record<Exclude<keyof RequestEdit, HumanField>, string> = {
  note: 'note', source: 'source', ministry: 'ministry', extra: 'extra', recommended: 'recommended', recommendedAt: 'recommended_at',
  attendance: 'attendance',
};

/** Итог звонка человеку: что координатор записывает после разговора. */
export type CallResult = 'reached' | 'no_answer' | 'later' | 'refused';
/** Нужно ли после этого итога ещё звонить: «не дозвонился» и «просил позже» оставляют заявку в «Перезвонить». */
export const CALL_RESULTS: Readonly<Record<CallResult, { callback: boolean }>> = {
  reached: { callback: false }, refused: { callback: false }, no_answer: { callback: true }, later: { callback: true },
};

/** Причины аннулирования заявки: ключ уходит в запрос, подпись пишется в заявку (так её видит и старая выгрузка). */
export const CANCEL_REASONS = {
  declined: 'Отказались',
  no_answer: 'Не отвечают',
  duplicate: 'Дубль заявки',
  self_found: 'Нашли группу сами',
  other: 'Другое',
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;

export type ActionFailure = 'bad_request' | 'not_found' | 'already_closed' | 'group_unavailable' | 'group_full' | 'no_responsible' | 'conflict';
export type ActionOutcome = { ok: true } | { ok: false; error: ActionFailure; message: string };

type Failure = Extract<ActionOutcome, { ok: false }>;
const fail = (error: ActionFailure, message: string): Failure => ({ ok: false, error, message });

/** Дата только в виде 2026-08-27 и только существующая: «2026-02-31» база приняла бы как ошибку всей правки. */
function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const CLOSED = ['Исполнена', 'Аннулирована'];

interface RequestState {
  status: string;
  group_id: number | null;
  final_group: string | null;
  callback: boolean;
  responsible: string | null;
}

export interface DesiredProposal {
  requestId: number;
  groupId: number;
  /** Отпечаток данных заявки, по которым получено предложение (см. plan/signature.ts). */
  inputHash?: string;
  /** Данные заявки в виде для показа: по нему видно, что изменилось, когда отпечаток уже другой. */
  inputSnapshot?: InputSnapshot;
  confidence: number;
  /** Причины подбора как показываются человеку: [{tone, text}]. */
  rationale: unknown;
}

/**
 * Что знает расчёт о моменте запуска: какие группы принимают людей и текущие отпечатки данных заявок. По ним
 * снятому предложению пишется причина (`superseded_reason`, миграция 061); без них — «заменено», и оно не вернётся.
 */
export interface SyncContext {
  openGroupIds: ReadonlySet<number>;
  signatures: ReadonlyMap<number, string>;
}

/** Снятое автоматом предложение, которое вернётся, когда его группа снова примет людей (`PlanRequest.restoreGroupIds`). */
export interface RestorableProposal {
  groupId: number;
  inputHash: string | null;
}

export interface SyncResult {
  created: number;
  /** Заменённые и снятые предложения. */
  replaced: number;
  unchanged: number;
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
      `SELECT status, group_id, final_group, callback, responsible FROM requests
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
      // Утверждённого человека дальше ведёт ответственный (звонит, отмечает дошёл ли). Без него заявка повисает
      // ничьей — поэтому сначала «В работе у», потом «Утвердить». Проверка здесь, а не только в интерфейсе: любой путь
      // к утверждению (основная кнопка, запасной вариант, «Другая группа») сходится сюда.
      if (!state.responsible?.trim()) return fail('no_responsible', 'Сначала укажите, кто в работе («В работе у»), потом утверждайте.');

      const { rows } = await c.query<{
        id: number; leader: string; status: string; open_to_new: string | null; do_not_refer: boolean; chamber: boolean; people: number | null;
        capacity: number | null;
      }>(
        `SELECT id, leader, status, open_to_new, do_not_refer, chamber, people, capacity
           FROM groups WHERE id = $1 AND archived_at IS NULL FOR SHARE`,
        [groupId],
      );
      const g = rows[0];
      if (!g) return fail('group_unavailable', 'Группа не найдена или в архиве.');
      if (g.do_not_refer) return fail('group_unavailable', 'В эту группу направлять нельзя («Не направлять»).');
      if (g.chamber) return fail('group_unavailable', 'В эту группу направлять нельзя: она камерная (служителей или отдельного служения).');
      if (!PASSING_STATUSES.has(g.status)) return fail('group_unavailable', `Группа не принимает людей: статус «${g.status}».`);
      // Мест нет — не запрет: координатор мог договориться с ведущим. Но решает он осознанно (force).
      if (!opts.force && g.people !== null && g.people >= (g.capacity ?? opts.defaultCapacity)) {
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
      await enqueuePlacementNotices(c, requestId, g.id, actor);
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

  /**
   * «Выбрать» в окне «Другая группа»: группа становится основным предложением заявки (в рамке наверху карточки),
   * утверждает её потом обычная «Утвердить». Это решение человека: автоподбор его не заменяет (`syncProposals`),
   * снимает только «Подобрать заново». Отпечаток данных не пишем — выбор не зависит от того, что считал расчёт.
   */
  async choose(requestId: number, groupId: number, actor: string): Promise<ActionOutcome> {
    return this.tx(async (c) => {
      // Та же блокировка, что у запуска подбора: иначе он, прочитав предложения до выбора, упрётся в «одно действующее».
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('hg_matching'))`);
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      const { rows } = await c.query<{ id: number; status: string; do_not_refer: boolean; chamber: boolean }>(
        `SELECT id, status, do_not_refer, chamber FROM groups WHERE id = $1 AND archived_at IS NULL`,
        [groupId],
      );
      const g = rows[0];
      if (!g) return fail('group_unavailable', 'Группа не найдена или в архиве.');
      // Те же запреты, что у «Утвердить»: выбрать то, что потом нельзя утвердить, — тупик. Места проверит утверждение.
      if (g.do_not_refer) return fail('group_unavailable', 'В эту группу направлять нельзя («Не направлять»).');
      if (g.chamber) return fail('group_unavailable', 'В эту группу направлять нельзя: она камерная (служителей или отдельного служения).');
      if (!PASSING_STATUSES.has(g.status)) return fail('group_unavailable', `Группа не принимает людей: статус «${g.status}».`);
      await c.query(
        `UPDATE placement_proposals SET status = 'superseded', decided_by = $2, decided_at = now()
          WHERE request_id = $1 AND status = 'proposed'`,
        [requestId, actor],
      );
      await c.query(
        `INSERT INTO placement_proposals (request_id, group_id, source, status) VALUES ($1, $2, 'manual', 'proposed')`,
        [requestId, groupId],
      );
      await this.audit(c, actor, 'request.choose', requestId, null, { chosen_group_id: groupId }, null);
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

  /**
   * Улица и удобное время, поправленные координатором. Правка лежит рядом с ответом из анкеты и
   * имеет приоритет; пустое значение убирает правку. В журнал пишется факт, а не текст: адрес — личные данные.
   */
  /**
   * Правка полей заявки (ФИО, телефон, возраст, район, комментарий). Район и возраст влияют на подбор:
   * закреплённое предложение само устареет, потому что отпечаток данных изменится (см. `inputSignature`).
   * В журнал идут названия изменённых полей, значения — нет: там телефон и имя человека.
   */
  async editRequest(requestId: number, patch: RequestEdit, actor: string): Promise<ActionOutcome> {
    const keys = (Object.keys(patch) as (keyof RequestEdit)[]).filter((k) => k in EDIT_LIMITS && patch[k] !== undefined);
    if (keys.length === 0) return fail('bad_request', 'Нечего менять.');
    const clean: Partial<Record<keyof RequestEdit, string | null>> = {};
    for (const k of keys) {
      const v = patch[k];
      if (v !== null && typeof v !== 'string') return fail('bad_request', 'Значение должно быть текстом.');
      const t = (v ?? '').trim();
      if (t.length > EDIT_LIMITS[k]) return fail('bad_request', `Слишком длинный текст (до ${EDIT_LIMITS[k]} знаков).`);
      if (k === 'fio' && t === '') return fail('bad_request', 'ФИО не может быть пустым.');
      if (k === 'phone' && t !== '') {
        const normalized = normalizePhone(t);
        if (!normalized) return fail('bad_request', 'Не похоже на номер телефона. Пример: +7 911 123-45-67.');
        clean[k] = normalized;
        continue;
      }
      if (k === 'recommendedAt' && t !== '' && !isIsoDate(t)) return fail('bad_request', 'Дата рекомендации — в виде 2026-08-27.');
      clean[k] = t === '' ? null : t;
    }
    // ФИО — у человека в «Людях», без него записи не бывает.
    if (keys.includes('fio') && !clean.fio) return fail('bad_request', 'ФИО не может быть пустым.');

    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      const human = await humanOfRequest(c, requestId);
      if (!human && keys.some(isHumanField)) return fail('not_found', 'У заявки нет человека в «Людях»: обновите страницу.');
      const { rows } = await c.query<Record<Exclude<keyof RequestEdit, HumanField>, string | null>>(
        `SELECT note, source, ministry, extra, recommended, recommended_at AS "recommendedAt", attendance FROM requests WHERE id = $1`, [requestId],
      );
      const old: Partial<Record<keyof RequestEdit, string | null>> = { ...rows[0]!, ...(human ? await readHuman(c, human) : {}) };
      const changed = keys.filter((k) => (clean[k] ?? null) !== (old[k] ?? null));
      if (changed.length === 0) return { ok: true } as const;
      const own = changed.filter((k): k is Exclude<keyof RequestEdit, HumanField> => !isHumanField(k));
      if (own.length > 0) {
        await c.query(
          `UPDATE requests SET ${own.map((k, i) => `${REQUEST_EDIT_COLUMNS[k]} = $${i + 2}`).join(', ')},
                  origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
            WHERE id = $1`,
          [requestId, ...own.map((k) => clean[k] ?? null)],
        );
      }
      const forHuman: ContactPatch = {};
      for (const k of changed) if (isHumanField(k)) (forHuman as Record<string, string | null>)[k] = clean[k] ?? null;
      if (human && Object.keys(forHuman).length > 0) {
        await writeToHuman(c, human, forHuman);
        // Правка через заявку — правка заявки: из таблицы она переходит в «ui», и повторный перенос таблицы её не затрёт.
        await c.query(`UPDATE requests SET origin = 'ui' WHERE id = $1 AND origin = 'таблица'`, [requestId]);
      }
      await this.audit(c, actor, 'request.edit', requestId, {}, { fields: changed }, null);
      return { ok: true } as const;
    });
  }

  /**
   * Закрыть заявку без группы: «обработано» (например, вопрос или «готов открыть» разобрали по телефону)
   * или «аннулировать» с причиной (отказались, не отвечают, дубль). Действующие предложения заменяются:
   * человек в подбор больше не идёт.
   */
  async closeRequest(
    requestId: number, outcome: 'done' | 'cancel', reason: CancelReason | null, comment: string | null, actor: string,
  ): Promise<ActionOutcome> {
    if (outcome !== 'done' && outcome !== 'cancel') return fail('bad_request', 'Неизвестный исход.');
    const note = (comment ?? '').trim() || null;
    if ((note ?? '').length > 500) return fail('bad_request', 'Комментарий слишком длинный (до 500 знаков).');
    let cancelText: string | null = null;
    if (outcome === 'cancel') {
      if (reason === null || !Object.hasOwn(CANCEL_REASONS, reason)) return fail('bad_request', 'Выберите причину.');
      if (reason === 'other' && !note) return fail('bad_request', 'Для причины «Другое» нужен комментарий.');
      cancelText = reason === 'other' ? `${CANCEL_REASONS[reason]}: ${note}` : CANCEL_REASONS[reason];
    }
    const status = outcome === 'done' ? 'Исполнена' : 'Аннулирована';
    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      await c.query(
        `UPDATE requests SET status = $2, cancel_reason = $3, callback = false, handled_by = $4, handled_at = now(),
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, status, cancelText, actor],
      );
      await c.query(
        `UPDATE placement_proposals SET status = 'superseded', decided_by = $2, decided_at = now()
          WHERE request_id = $1 AND status = 'proposed'`,
        [requestId, actor],
      );
      await this.audit(c, actor, 'request.close', requestId,
        { status: state.status, callback: state.callback }, outcome === 'cancel' ? { outcome, status, reason } : { outcome, status }, note);
      return { ok: true } as const;
    });
  }

  /**
   * Разбор «другого обращения» по справочникам: «уже состою в группе» — человек вносится в состав группы ссылкой на свою
   * регистрацию, «уже веду группу» — группа получает ссылку на регистрацию ведущего. В обоих случаях обращение закрывается
   * как обработанное: звонить незачем, данные легли в справочники. Всё в одной транзакции, с записью в журнал.
   *
   * Групп может быть несколько: человек ходит в две группы или ведёт две. Записывается всё или ничего — недоступная
   * группа или чужой ведущий у любой из них отменяют весь разбор. «Уже было» — только если не изменилось ни одной.
   *
   * Группы выбирает вызывающий (предложение расчёта по имени ведущего или выбор человека): здесь проверяется только,
   * что они есть. Чужую связь «ведущий» не перезаписываем — это решает человек.
   *
   * `coLeaderIn` — группы, где человек совпал с соведущим: там он записывается соведущим (миграция 054), с той же
   * проверкой на чужую связь. Остальные группы — ведущим.
   */
  async reconcile(
    requestId: number,
    kind: 'member' | 'leader',
    groupIds: readonly number[],
    actor: string,
    coLeaderIn: ReadonlySet<number> = new Set(),
  ): Promise<ActionOutcome & { already?: boolean }> {
    // Порядок блокировок один у всех (по возрастанию), иначе два разбора с пересекающимися группами повисли бы друг на друге.
    const ids = [...new Set(groupIds)].sort((a, b) => a - b);
    if (ids.length === 0) return fail('bad_request', 'Нужно указать группу.');
    return this.tx(async (c) => {
      const { rows } = await c.query<{ status: string; type: string; user_id: number | null; callback: boolean }>(
        `SELECT status, type, user_id::int AS user_id, callback FROM requests WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
        [requestId],
      );
      const req = rows[0];
      if (!req) return fail('not_found', 'Обращение не найдено.');
      if (CLOSED.includes(req.status)) return fail('already_closed', 'Обращение уже обработали.');
      if (req.type !== (kind === 'member' ? 'already_member' : 'already_leader')) return fail('bad_request', 'Это обращение другого вида.');
      if (req.user_id === null) return fail('bad_request', 'У обращения нет регистрации человека: внесите его в справочник вручную.');
      const registered = await c.query('SELECT 1 FROM users WHERE id = $1 AND registration_no IS NOT NULL', [req.user_id]);
      if ((registered.rowCount ?? 0) === 0) return fail('bad_request', 'Человек не завершил регистрацию.');
      const g = await c.query<{ id: number; user_id: number | null; person_id: number | null; co_user_id: number | null; co_person_id: number | null }>(
        `SELECT id::int AS id, leader_user_id::int AS user_id, leader_person_id::int AS person_id,
                co_leader_user_id::int AS co_user_id, co_leader_person_id::int AS co_person_id
           FROM groups WHERE id = ANY($1::bigint[]) AND archived_at IS NULL ORDER BY id FOR UPDATE`, [ids],
      );
      const co = (row: (typeof g.rows)[number]) => kind === 'leader' && coLeaderIn.has(row.id);
      const cardOf = (row: (typeof g.rows)[number]) => (co(row) ? row.co_person_id : row.person_id);
      // Карточка на позиции бывает этим же человеком: ведущим групп из таблицы миграция 057 завела карточки, а потом
      // человек сам пишет боту «я веду группу». Такую (те же ФИО — card_is_user, миграция 059) сливаем с регистрацией,
      // а не отказываем. Чужая карточка — по-прежнему другой человек.
      const ownCards = new Set<number>();
      if (kind === 'leader') {
        for (const row of g.rows) {
          const card = cardOf(row);
          if (card === null) continue;
          const same = await c.query<{ same: boolean }>('SELECT card_is_user($1, $2) AS same', [card, req.user_id]);
          if (same.rows[0]?.same) ownCards.add(card);
        }
      }
      // Кто сейчас на позиции, куда человек встанет: регистрация (число), карточка (своя — он сам, иначе другой человек) или никто.
      const holder = (row: (typeof g.rows)[number]) => {
        const card = cardOf(row);
        if (card !== null) return ownCards.has(card) ? req.user_id : -1;
        return co(row) ? row.co_user_id : row.user_id;
      };
      // Все или ничего: одна недоступная группа в списке отменяет весь разбор, человек увидит ошибку и поправит выбор.
      if (g.rows.length !== ids.length) return fail('group_unavailable', 'Одна из групп не найдена или в архиве.');

      // Сначала проверки, потом записи: проваленная проверка на середине оставила бы часть групп записанной.
      if (kind === 'leader' && g.rows.some((r) => holder(r) !== null && holder(r) !== req.user_id)) {
        return fail('conflict', 'У одной из этих групп уже связан другой ведущий.');
      }
      // Ведущий и соведущий одной группы — разные люди: второй раз того же на соседнюю позицию не ставим.
      if (kind === 'leader' && g.rows.some((r) => (co(r) ? r.user_id : r.co_user_id) === req.user_id)) {
        return fail('conflict', 'В одной из этих групп человек уже связан на другой позиции: ведущим или соведущим.');
      }

      let changed = 0;
      for (const row of g.rows) {
        if (kind === 'member') {
          // Утверждённый сервисом в эту группу уже виден в составе сам (по заявке «Исполнена»): второй записи не нужно.
          const placed = await c.query(
            `SELECT 1 FROM requests WHERE group_id = $1 AND user_id = $2 AND type = 'join_group' AND status = 'Исполнена' AND archived_at IS NULL`,
            [row.id, req.user_id],
          );
          const inserted = (placed.rowCount ?? 0) > 0 ? null : await c.query(
            `INSERT INTO group_members (group_id, user_id, created_by) SELECT $1, $2, $3
              WHERE NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND archived_at IS NULL)`,
            [row.id, req.user_id, actor],
          );
          if (inserted !== null && (inserted.rowCount ?? 0) > 0) changed += 1;
        } else if (ownCards.has(cardOf(row)!)) {
          // Сливаем один раз (у человека бывает две группы): позиция переходит на регистрацию вместе со всем остальным.
          const card = cardOf(row)!;
          if ((await c.query('SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL', [card])).rowCount) {
            await c.query('SELECT merge_card_into_user($1, $2)', [card, req.user_id]);
          }
          await c.query(`UPDATE groups SET source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END WHERE id = $1`, [row.id]);
          changed += 1;
        } else if (holder(row) !== req.user_id) {
          // Запись из таблицы после правки в интерфейсе — «ui»: повторный перенос таблицы её не затрёт (см. CLAUDE.md).
          const column = co(row) ? 'co_leader_user_id' : 'leader_user_id';
          await c.query(`UPDATE groups SET ${column} = $2, source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END WHERE id = $1`, [row.id, req.user_id]);
          changed += 1;
        }
      }
      const already = changed === 0;

      await c.query(
        `UPDATE requests SET status = 'Исполнена', callback = false, handled_by = $2, handled_at = now(),
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, actor],
      );
      // group_id — первая группа (так журнал читали до нескольких групп), group_ids — все.
      await this.audit(c, actor, 'request.reconcile', requestId, { status: req.status, callback: req.callback }, { kind, group_id: ids[0], group_ids: ids, already }, null);
      return { ok: true, already } as const;
    });
  }

  /**
   * Вернуть закрытую заявку в работу: ошибочное утверждение или аннулирование не должно быть тупиком.
   * Группа и причина очищаются, число участников группы вернётся само (считается по действующим утверждениям).
   */
  async reopen(requestId: number, actor: string): Promise<ActionOutcome> {
    return this.tx(async (c) => {
      const { rows } = await c.query<RequestState & { cancel_reason: string | null }>(
        `SELECT status, group_id, final_group, callback, cancel_reason FROM requests
          WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
        [requestId],
      );
      const row = rows[0];
      if (!row) return fail('not_found', 'Заявка не найдена.');
      if (!CLOSED.includes(row.status)) return fail('bad_request', 'Заявка и так в работе.');
      await c.query(
        `UPDATE requests SET status = 'В работе', group_id = NULL, final_group = NULL, cancel_reason = NULL,
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId],
      );
      await cancelQueuedNotices(c, requestId);
      await this.audit(c, actor, 'request.reopen', requestId,
        { status: row.status, group_id: row.group_id, cancel_reason: row.cancel_reason }, { status: 'В работе' }, null);
      return { ok: true } as const;
    });
  }

  /** «В работе у»: кто из координаторов занимается заявкой. Имя служителя — не персональные данные заявителя, в журнал идёт. */
  async assign(requestId: number, responsible: string | null, actor: string): Promise<ActionOutcome> {
    const name = (responsible ?? '').trim() || null;
    if ((name ?? '').length > 200) return fail('bad_request', 'Слишком длинное имя (до 200 знаков).');
    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      const { rows } = await c.query<{ responsible: string | null }>('SELECT responsible FROM requests WHERE id = $1', [requestId]);
      const old = rows[0]!.responsible;
      if (old === name) return { ok: true } as const;
      await c.query(
        `UPDATE requests SET responsible = $2,
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, name],
      );
      await this.audit(c, actor, 'request.assign', requestId, { responsible: old }, { responsible: name }, null);
      return { ok: true } as const;
    });
  }

  /** Итог звонка: запись в ленту заявки и, когда ещё нужно звонить, отметка «Перезвонить». */
  async recordCall(requestId: number, result: CallResult, comment: string | null, actor: string): Promise<ActionOutcome> {
    if (!Object.hasOwn(CALL_RESULTS, result)) return fail('bad_request', 'Неизвестный итог звонка.');
    const note = (comment ?? '').trim() || null;
    if ((note ?? '').length > 500) return fail('bad_request', 'Комментарий слишком длинный (до 500 знаков).');
    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      const callback = CALL_RESULTS[result].callback;
      await c.query(
        `UPDATE requests SET callback = $2,
                origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
          WHERE id = $1`,
        [requestId, callback],
      );
      await this.audit(c, actor, 'request.call', requestId, { callback: state.callback }, { result, callback }, note);
      return { ok: true } as const;
    });
  }

  async setParams(
    requestId: number, patch: { street?: string | null; schedule?: string | null }, actor: string,
  ): Promise<ActionOutcome> {
    const clean = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    };
    const street = clean(patch.street);
    const schedule = clean(patch.schedule);
    if (street === undefined && schedule === undefined) return fail('bad_request', 'Нечего менять.');
    if ((street ?? '').length > 200 || (schedule ?? '').length > 200) return fail('bad_request', 'Слишком длинный текст (до 200 знаков).');

    return this.tx(async (c) => {
      const state = await this.lockOpenRequest(c, requestId);
      if (PlacementRepo.isFailure(state)) return state;
      // Улица и удобное время — данные человека (миграция 057): правка в подборе пишет в его запись.
      const human = await humanOfRequest(c, requestId);
      if (!human) return fail('not_found', 'У заявки нет человека в «Людях»: обновите страницу.');
      const now = await readHuman(c, human);
      const changedStreet = street !== undefined && street !== now.address;
      const changedSchedule = schedule !== undefined && schedule !== now.schedule;
      if (!changedStreet && !changedSchedule) return { ok: true } as const;
      await writeToHuman(c, human, {
        ...(changedStreet ? { address: street ?? null } : {}),
        ...(changedSchedule ? { schedule: schedule ?? null } : {}),
      });
      // Как любая правка заявки: из таблицы — под управление интерфейса, иначе повторный перенос таблицы её затрёт.
      await c.query(`UPDATE requests SET origin = 'ui' WHERE id = $1 AND origin = 'таблица'`, [requestId]);
      await this.audit(c, actor, 'request.params', requestId,
        { street: now.address !== null, schedule: now.schedule !== null },
        { street: changedStreet ? street !== null : undefined, schedule: changedSchedule ? schedule !== null : undefined },
        null);
      return { ok: true } as const;
    });
  }

  /**
   * «Подобрать заново»: снимает закреплённые предложения (одной заявки или всех открытых), чтобы
   * следующий расчёт собрал их с нуля. Утверждённое и отклонённое не трогает: отклонённые группы и
   * дальше исключены из подбора. Для одной заявки проверяет, что она открыта.
   */
  async resetProposals(requestId: number | null, actor: string): Promise<ActionOutcome> {
    return this.tx(async (c) => {
      if (requestId !== null) {
        const state = await this.lockOpenRequest(c, requestId);
        if (PlacementRepo.isFailure(state)) return state;
        await c.query(
          `UPDATE placement_proposals SET status = 'superseded', decided_by = $2, decided_at = now()
            WHERE request_id = $1 AND status = 'proposed'`,
          [requestId, actor],
        );
        await this.audit(c, actor, 'request.rematch', requestId, null, null, null);
      } else {
        const res = await c.query(
          `UPDATE placement_proposals p SET status = 'superseded', decided_by = $1, decided_at = now()
             FROM requests r
            WHERE r.id = p.request_id AND p.status = 'proposed' AND p.group_id IS NOT NULL
              AND r.status NOT IN ('Исполнена', 'Аннулирована') AND r.archived_at IS NULL`,
          [actor],
        );
        await c.query(
          `INSERT INTO audit_log (actor, service, action, entity_type, after) VALUES ($1, 'home-groups', 'matching.rerun_all', 'matching', $2::jsonb)`,
          [actor, JSON.stringify({ reset: res.rowCount ?? 0 })],
        );
      }
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

  /** Действующие предложения: заявка → группа и кто предложил. Закрепляют выбор при следующем расчёте. */
  async activeProposals(): Promise<Map<number, { groupId: number | null; source: 'script' | 'agent' | 'manual'; inputHash: string | null; inputSnapshot: InputSnapshot | null }>> {
    const { rows } = await this.db.query<{ request_id: number; group_id: number | null; source: 'script' | 'agent' | 'manual'; input_hash: string | null; input_snapshot: unknown }>(
      `SELECT request_id, group_id, source, input_hash, input_snapshot FROM placement_proposals WHERE status = 'proposed'`,
    );
    return new Map(rows.map((r) => [
      Number(r.request_id),
      { groupId: r.group_id === null ? null : Number(r.group_id), source: r.source, inputHash: r.input_hash, inputSnapshot: parseSnapshot(r.input_snapshot) },
    ]));
  }

  /**
   * Что вернуть открытым заявкам: подряд идущие с конца снятые предложения с причиной «группа перестала принимать людей»,
   * свежее первым. Снятое иначе (человеком, сменой данных, утверждением) обрывает цепочку: дальше назад не смотрим.
   */
  async restorableProposals(): Promise<Map<number, RestorableProposal[]>> {
    const { rows } = await this.db.query<{ request_id: number; group_id: number; input_hash: string | null; superseded_reason: string | null }>(
      `SELECT p.request_id, p.group_id, p.input_hash, p.superseded_reason
         FROM placement_proposals p
         JOIN requests r ON r.id = p.request_id
        WHERE p.status = 'superseded' AND p.group_id IS NOT NULL
          AND r.archived_at IS NULL AND r.status NOT IN ('Исполнена', 'Аннулирована')
        ORDER BY p.request_id, p.decided_at DESC, p.id DESC`,
    );
    const out = new Map<number, RestorableProposal[]>();
    const broken = new Set<number>();
    for (const row of rows) {
      const id = Number(row.request_id);
      if (broken.has(id)) continue;
      if (row.superseded_reason !== 'unavailable') { broken.add(id); continue; }
      out.set(id, [...(out.get(id) ?? []), { groupId: Number(row.group_id), inputHash: row.input_hash }]);
    }
    return out;
  }

  /**
   * Сохраняет в базе то, что предлагает расчёт: новым заявкам — предложение, изменившимся —
   * замену, пропавшим (группа заполнилась, закрылась) — снятие. Остальное не трогает: накопленное
   * не меняется само, пока остаётся доступным. Один запуск за раз (блокировка), иначе кнопка и
   * автоматический запуск, нажатые вместе, переписывали бы друг друга.
   */
  async syncProposals(desired: readonly DesiredProposal[], actor: string, scope?: ReadonlySet<number>, context?: SyncContext): Promise<SyncResult> {
    return this.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('hg_matching'))`);
      const { rows } = await c.query<{ id: number; request_id: number; group_id: number; source: string; input_hash: string | null; input_snapshot: unknown }>(
        `SELECT id, request_id, group_id, source, input_hash, input_snapshot FROM placement_proposals WHERE status = 'proposed' AND group_id IS NOT NULL`,
      );
      // Выбор координатора («Выбрать») расчёт не заменяет и не снимает: группа могла и не пройти отсев расчёта.
      const chosen = new Set(rows.filter((r) => r.source === 'manual').map((r) => Number(r.request_id)));
      // scope — «подобрать заново» для одной заявки: остальные закреплённые предложения не трогаем.
      const current = new Map(rows.filter((r) => (!scope || scope.has(Number(r.request_id))) && !chosen.has(Number(r.request_id))).map((r) => [Number(r.request_id), r]));
      const wanted = new Set(desired.map((d) => d.requestId));
      const result: SyncResult = { created: 0, replaced: 0, unchanged: 0 };

      const insert = (d: DesiredProposal) =>
        c.query(
          `INSERT INTO placement_proposals (request_id, group_id, source, confidence, rationale, input_hash, input_snapshot)
           VALUES ($1, $2, 'script', $3, $4::jsonb, $5, $6::jsonb)`,
          [d.requestId, d.groupId, d.confidence, JSON.stringify(d.rationale), d.inputHash ?? null, d.inputSnapshot ? JSON.stringify(d.inputSnapshot) : null],
        );
      // В журнал — какие поля заявки изменились (названия, без значений: улица и время — данные человека).
      const logDataChange = async (had: { request_id: number; input_hash: string | null; input_snapshot: unknown }, d: DesiredProposal) => {
        if (!d.inputHash || had.input_hash === d.inputHash) return;
        const before = parseSnapshot(had.input_snapshot);
        const fields = before && d.inputSnapshot ? diffSnapshots(before, d.inputSnapshot).map((x) => x.field) : [];
        await c.query(
          `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after) VALUES ($1, 'home-groups', 'request.data_changed', 'request', $2, $3::jsonb)`,
          [actor, d.requestId, JSON.stringify({ fields })],
        );
      };
      // Изменились данные заявки — «data»; группа перестала принимать людей — «unavailable» (вернётся, когда снова примет).
      const reasonOf = (had: { request_id: number; group_id: number; input_hash: string | null }, hash: string | undefined) => {
        const now = hash ?? context?.signatures.get(Number(had.request_id));
        if (now && had.input_hash && now !== had.input_hash) return 'data';
        if (context && !context.openGroupIds.has(Number(had.group_id))) return 'unavailable';
        return 'replaced';
      };
      const supersede = (id: number, reason: string) =>
        c.query(
          `UPDATE placement_proposals SET status = 'superseded', decided_by = $2, decided_at = now(), superseded_reason = $3 WHERE id = $1`,
          [id, actor, reason],
        );

      for (const d of desired) {
        if (chosen.has(d.requestId)) continue;
        const had = current.get(d.requestId);
        if (!had) { await insert(d); result.created += 1; continue; }
        if (Number(had.group_id) === d.groupId) {
          // Та же группа, но данные заявки другие: предложение подтверждено по новым данным — обновляем отпечаток.
          if (d.inputHash && had.input_hash !== d.inputHash) {
            await logDataChange(had, d);
            await c.query('UPDATE placement_proposals SET input_hash = $2, input_snapshot = $3::jsonb WHERE id = $1', [Number(had.id), d.inputHash, d.inputSnapshot ? JSON.stringify(d.inputSnapshot) : null]);
          }
          result.unchanged += 1;
          continue;
        }
        await logDataChange(had, d);
        await supersede(Number(had.id), reasonOf(had, d.inputHash));
        await insert(d);
        result.replaced += 1;
      }
      for (const [requestId, had] of current) {
        if (wanted.has(requestId)) continue;
        await supersede(Number(had.id), reasonOf(had, undefined));
        result.replaced += 1;
      }

      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, after) VALUES ($1, 'home-groups', 'matching.run', 'matching', $2::jsonb)`,
        [actor, JSON.stringify(result)],
      );
      return result;
    });
  }

  /**
   * Сколько человек сервис утвердил в группу после последней обратной связи ведущего. Ведущий
   * сообщает число участников — оно уже включает тех, кого утвердили до этой даты, — а позже
   * утверждённых в нём ещё нет. Считаем только утверждения сервиса (по журналу) и только те,
   * что остались в силе: заявку вернули в работу или перенесли в другую группу — не считаем.
   */
  async placedSinceFeedback(timeZone = 'Europe/Moscow'): Promise<Map<number, number>> {
    const { rows } = await this.db.query<{ group_id: number; n: number }>(
      `SELECT g.id AS group_id, count(DISTINCT r.id)::int AS n
         FROM audit_log a
         JOIN requests r ON r.id = a.entity_id
         JOIN groups g ON g.id = (a.after->>'group_id')::bigint
        WHERE a.action = 'request.approve' AND a.entity_type = 'request'
          AND r.status = 'Исполнена' AND r.group_id = g.id AND r.archived_at IS NULL
          AND g.archived_at IS NULL
          AND (g.feedback_at IS NULL OR (a.at AT TIME ZONE $1)::date > g.feedback_at)
        GROUP BY g.id`,
      [timeZone],
    );
    return new Map(rows.map((r) => [Number(r.group_id), r.n]));
  }
}

