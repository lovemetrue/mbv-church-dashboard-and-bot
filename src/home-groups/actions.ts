import type { ActionError, ApproveBody, NeedCallBody, RejectBody, RejectReason } from './contracts.js';
import { CALL_RESULTS, CANCEL_REASONS, type CallResult, type CancelReason } from '../db/repos/placement.repo.js';
import type { ActionOutcome, PlacementRepo } from '../db/repos/placement.repo.js';

/**
 * Действия координатора над заявкой. Здесь только разбор тела запроса: то, что пришло из сети,
 * проверяется до обращения к базе. Сами правила (можно ли в эту группу, закрыта ли заявка) —
 * в `PlacementRepo`, в той же транзакции, что и запись.
 */
export interface RequestActions {
  approve(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  reject(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  setNeedCall(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  setParams(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  rematch(requestId: number, actor: string): Promise<ActionOutcome>;
  bulk(body: unknown, actor: string): Promise<BulkOutcome>;
  close(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  reopen(requestId: number, actor: string): Promise<ActionOutcome>;
  edit(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  assign(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
  call(requestId: number, body: unknown, actor: string): Promise<ActionOutcome>;
}

export type BulkOutcome = { ok: true; done: number; skipped: number } | Extract<ActionOutcome, { ok: false }>;

/** Сколько заявок можно обработать за раз: ограничение от случайного «выбрать всё» на тысячу строк. */
export const BULK_LIMIT = 100;

const badBulk = (message: string): Extract<ActionOutcome, { ok: false }> => ({ ok: false, error: 'bad_request', message });
const bad = (message: string): ActionOutcome => ({ ok: false, error: 'bad_request', message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function createActions(
  placement: PlacementRepo,
  opts: { defaultCapacity: number },
  matching?: { rematch(requestId: number, actor: string): Promise<ActionOutcome> },
): RequestActions {
  return {
    async approve(requestId, body, actor) {
      if (!isRecord(body) || !isId(body['groupId'])) return bad('Нужно указать группу.');
      const force = body['force'];
      if (force !== undefined && typeof force !== 'boolean') return bad('Некорректное подтверждение.');
      const input: ApproveBody = { groupId: body['groupId'], ...(force === undefined ? {} : { force }) };
      return placement.approve(requestId, input.groupId, actor, {
        force: input.force === true, defaultCapacity: opts.defaultCapacity,
      });
    },

    async reject(requestId, body, actor) {
      if (!isRecord(body) || !isId(body['groupId'])) return bad('Нужно указать группу.');
      const reason = body['reason'];
      const comment = body['comment'];
      if (typeof reason !== 'string') return bad('Нужно указать причину.');
      if (comment !== undefined && comment !== null && typeof comment !== 'string') return bad('Комментарий должен быть текстом.');
      // Длина комментария ограничена: он попадает в журнал и в ленту карточки.
      if (typeof comment === 'string' && comment.length > 500) return bad('Комментарий слишком длинный (до 500 знаков).');
      const input: RejectBody = { groupId: body['groupId'], reason: reason as RejectReason, ...(typeof comment === 'string' ? { comment } : {}) };
      return placement.reject(requestId, input.groupId, input.reason, input.comment ?? null, actor);
    },

    async setParams(requestId, body, actor) {
      if (!isRecord(body)) return bad('Нужно указать, что менять.');
      const out: { street?: string | null; schedule?: string | null } = {};
      for (const key of ['street', 'schedule'] as const) {
        const v = body[key];
        if (v === undefined) continue;
        if (v !== null && typeof v !== 'string') return bad('Значение должно быть текстом или null.');
        out[key] = v;
      }
      return placement.setParams(requestId, out, actor);
    },

    async bulk(body, actor) {
      if (!isRecord(body) || !Array.isArray(body['ids'])) return badBulk('Нужно выбрать заявки.');
      const ids = body['ids'];
      if (ids.length === 0) return badBulk('Нужно выбрать заявки.');
      if (ids.length > BULK_LIMIT) return badBulk(`За раз можно обработать не больше ${BULK_LIMIT} заявок.`);
      if (!ids.every(isId)) return badBulk('Номера заявок должны быть целыми положительными числами.');
      const unique = [...new Set(ids as number[])];
      let run: (id: number) => Promise<ActionOutcome>;
      if (body['action'] === 'assign') {
        const who = body['responsible'];
        if (who !== undefined && who !== null && typeof who !== 'string') return badBulk('Имя должно быть текстом или null.');
        run = (id) => placement.assign(id, who ?? null, actor);
      } else if (body['action'] === 'need-call') {
        if (typeof body['value'] !== 'boolean') return badBulk('Нужно указать, ставить отметку или снимать.');
        const value = body['value'];
        run = (id) => placement.setNeedCall(id, value, actor);
      } else {
        return badBulk('Неизвестное действие.');
      }
      // По одной, каждая в своей транзакции: закрытая или пропавшая заявка пропускается и не срывает остальные.
      let done = 0;
      for (const id of unique) {
        const out = await run(id);
        if (out.ok) done += 1;
        else if (out.error === 'bad_request') return out;
      }
      return { ok: true, done, skipped: unique.length - done };
    },

    async close(requestId, body, actor) {
      if (!isRecord(body) || (body['outcome'] !== 'done' && body['outcome'] !== 'cancel')) return bad('Нужно указать исход: обработано или аннулировать.');
      const reason = body['reason'];
      if (reason !== undefined && reason !== null && (typeof reason !== 'string' || !Object.hasOwn(CANCEL_REASONS, reason))) return bad('Неизвестная причина.');
      const comment = body['comment'];
      if (comment !== undefined && comment !== null && typeof comment !== 'string') return bad('Комментарий должен быть текстом.');
      return placement.closeRequest(requestId, body['outcome'], (reason ?? null) as CancelReason | null, comment ?? null, actor);
    },

    async reopen(requestId, actor) {
      return placement.reopen(requestId, actor);
    },

    async edit(requestId, body, actor) {
      if (!isRecord(body)) return bad('Нужно указать, что менять.');
      // Форма правки одна и у людей, и у заявок и шлёт `{fields}`; плоское тело принимаем для прежних вкладок.
      const src = isRecord(body['fields']) ? body['fields'] : body;
      const out: Record<string, string | null> = {};
      for (const key of ['fio', 'phone', 'age', 'place', 'note', 'address', 'schedule', 'hobby', 'profession', 'family'] as const) {
        const v = src[key];
        if (v === undefined) continue;
        if (v !== null && typeof v !== 'string') return bad('Значение должно быть текстом или null.');
        out[key] = v;
      }
      return placement.editRequest(requestId, out, actor);
    },

    async assign(requestId, body, actor) {
      if (!isRecord(body) || !('responsible' in body)) return bad('Нужно указать, кому передать заявку.');
      const v = body['responsible'];
      if (v !== null && typeof v !== 'string') return bad('Имя должно быть текстом или null.');
      return placement.assign(requestId, v, actor);
    },

    async call(requestId, body, actor) {
      if (!isRecord(body) || typeof body['result'] !== 'string' || !Object.hasOwn(CALL_RESULTS, body['result'])) {
        return bad('Нужно указать итог звонка.');
      }
      const comment = body['comment'];
      if (comment !== undefined && comment !== null && typeof comment !== 'string') return bad('Комментарий должен быть текстом.');
      return placement.recordCall(requestId, body['result'] as CallResult, comment ?? null, actor);
    },

    async rematch(requestId, actor) {
      if (!matching) return { ok: false, error: 'not_found', message: 'Подбор недоступен.' };
      return matching.rematch(requestId, actor);
    },

    async setNeedCall(requestId, body, actor) {
      if (!isRecord(body) || typeof body['value'] !== 'boolean') return bad('Нужно указать, ставить отметку или снимать.');
      const input: NeedCallBody = { value: body['value'] };
      return placement.setNeedCall(requestId, input.value, actor);
    },
  };
}

export const ACTION_STATUS: Record<ActionError['error'], number> = {
  bad_request: 400,
  not_found: 404,
  already_closed: 409,
  group_unavailable: 409,
  group_full: 409,
  forbidden: 403,
  conflict: 409,
  unavailable: 503,
};
