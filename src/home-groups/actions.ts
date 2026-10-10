import type { ActionError, ApproveBody, NeedCallBody, RejectBody, RejectReason } from './contracts.js';
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
}

const bad = (message: string): ActionOutcome => ({ ok: false, error: 'bad_request', message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function createActions(placement: PlacementRepo, opts: { defaultCapacity: number }): RequestActions {
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
};
