import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { GroupDirectionsRepo } from '../db/repos/groupDirections.repo.js';
import type { ActionError, GroupDirectionsView } from './contracts.js';

type Outcome = { ok: true; id?: number } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): Outcome => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

function nameOf(body: Record<string, unknown>): string | Outcome {
  const name = typeof body['name'] === 'string' ? body['name'].trim().replace(/\s+/g, ' ') : '';
  if (!name) return bad('Укажите название направления.');
  if (name.length > 80) return bad('Название направления — не длиннее 80 символов.');
  return name;
}

/**
 * «Настройки → Направления»: справочник, из которого выбирают направление группы (основное, подростковое,
 * молодёжное служение, филиалы). Новые филиалы добавляют здесь. В журнал пишется название — это не персональные данные.
 */
export function createGroupDirections(deps: { repo: GroupDirectionsRepo; audit: Pick<AuditRepo, 'write'> }) {
  return {
    async view(): Promise<GroupDirectionsView> {
      return { items: await deps.repo.list() };
    },

    async create(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body)) return bad('Нужно название направления.');
      const name = nameOf(body);
      if (typeof name !== 'string') return name;
      const id = await deps.repo.create(name);
      if (id === null) return { ok: false, error: 'conflict', message: `Направление «${name}» уже есть.` };
      await deps.audit.write(actor, 'group_direction.create', 'group_direction', id, { name });
      return { ok: true, id };
    },

    async update(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body) || !isId(body['id'])) return bad('Не указано направление.');
      const name = nameOf(body);
      if (typeof name !== 'string') return name;
      const done = await deps.repo.rename(body['id'], name);
      if (done === 'missing') return { ok: false, error: 'not_found', message: 'Такого направления больше нет: обновите страницу.' };
      if (done === 'taken') return { ok: false, error: 'conflict', message: `Направление «${name}» уже есть.` };
      await deps.audit.write(actor, 'group_direction.update', 'group_direction', body['id'], { name });
      return { ok: true };
    },

    async delete(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body) || !isId(body['id'])) return bad('Не указано направление.');
      const done = await deps.repo.delete(body['id']);
      if (done === 'missing') return { ok: false, error: 'not_found', message: 'Такого направления больше нет: обновите страницу.' };
      if (done === 'in_use') return { ok: false, error: 'conflict', message: 'У направления есть группы: сначала смените им направление.' };
      await deps.audit.write(actor, 'group_direction.delete', 'group_direction', body['id'], {});
      return { ok: true };
    },
  };
}

export type GroupDirections = ReturnType<typeof createGroupDirections>;
