import type { ActionOutcome, PlacementRepo } from '../../db/repos/placement.repo.js';
import type { ViewsInput } from '../api/views.js';
import { BULK_LIMIT } from '../actions.js';
import { readyGroupOf, reconcileKindOf } from './plan.js';

type Failure = Extract<ActionOutcome, { ok: false }>;
export type ReconcileOutcome = { ok: true; already: boolean } | Failure;
export type ReconcileReadyOutcome = { ok: true; applied: number; skipped: number } | Failure;

const bad = (message: string): Failure => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Разбор «других обращений» по справочникам. Вид (в состав или ведущим) выводится из типа обращения на сервере, а не
 * берётся из запроса: клиент называет только группу. «Разобрать всё готовое» пересчитывает группу для каждого
 * обращения заново и берёт только случаи с одной точно найденной группой — на запросе от клиента группа не доверяется.
 */
export function createReconciler(deps: {
  load: () => Promise<ViewsInput>;
  placement: Pick<PlacementRepo, 'reconcile'>;
}) {
  return {
    async apply(requestId: number, body: unknown, actor: string): Promise<ReconcileOutcome> {
      if (!isRecord(body) || !isId(body['groupId'])) return bad('Нужно указать группу.');
      const input = await deps.load();
      const request = input.requests.find((r) => r.id === requestId);
      if (!request) return { ok: false, error: 'not_found', message: 'Обращение не найдено.' };
      const kind = reconcileKindOf(request.type);
      if (!kind) return bad('Это обращение не разбирается по справочникам.');
      const out = await deps.placement.reconcile(requestId, kind, body['groupId'], actor);
      return out.ok ? { ok: true, already: out.already === true } : out;
    },

    async applyReady(body: unknown, actor: string): Promise<ReconcileReadyOutcome> {
      if (!isRecord(body) || !Array.isArray(body['ids']) || body['ids'].length === 0) return bad('Нужно выбрать обращения.');
      const ids = body['ids'];
      if (ids.length > BULK_LIMIT * 5) return bad(`За раз можно разобрать не больше ${BULK_LIMIT * 5} обращений.`);
      if (!ids.every(isId)) return bad('Номера обращений должны быть целыми положительными числами.');
      const unique = [...new Set(ids as number[])];
      const input = await deps.load();
      const byId = new Map(input.requests.map((r) => [r.id, r]));
      let applied = 0;
      for (const id of unique) {
        const request = byId.get(id);
        const groupId = request ? readyGroupOf(request, input.groups) : null;
        const kind = request ? reconcileKindOf(request.type) : null;
        if (!request || groupId === null || !kind) continue;
        // По одному, каждое в своей транзакции: закрытое или изменившееся обращение пропускается и не срывает остальные.
        const out = await deps.placement.reconcile(id, kind, groupId, actor);
        if (out.ok) applied += 1;
      }
      return { ok: true, applied, skipped: unique.length - applied };
    },
  };
}

export type Reconciler = ReturnType<typeof createReconciler>;
