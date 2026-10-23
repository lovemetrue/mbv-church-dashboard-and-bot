import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { TeamRoleKind } from '../db/repos/coordinators.repo.js';
import { TEAM_ROLE_KINDS, type TeamRolesRepo } from '../db/repos/teamRoles.repo.js';
import type { ActionError, TeamRolesView } from './contracts.js';

type Outcome = { ok: true; id?: number } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): Outcome => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Название и смысл роли из тела запроса. Смысл необязателен: null — роль без отборов и без автоназначения. */
function parse(body: Record<string, unknown>): { name: string; kind: TeamRoleKind | null } | Outcome {
  const name = typeof body['name'] === 'string' ? body['name'].trim().replace(/\s+/g, ' ') : '';
  if (!name) return bad('Укажите название роли.');
  if (name.length > 80) return bad('Название роли — не длиннее 80 символов.');
  const kind = body['kind'] ?? null;
  if (kind !== null && !(TEAM_ROLE_KINDS as readonly unknown[]).includes(kind)) return bad('Выберите, что значит роль, из списка.');
  return { name, kind: kind as TeamRoleKind | null };
}

/**
 * «Настройки → Роли команды»: справочник, из которого выбирают роль координатора. В журнал пишутся название и смысл
 * роли — это не персональные данные.
 */
export function createTeamRoles(deps: { repo: TeamRolesRepo; audit: Pick<AuditRepo, 'write'> }) {
  return {
    async view(): Promise<TeamRolesView> {
      return { items: await deps.repo.list() };
    },

    async create(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body)) return bad('Нужны название и смысл роли.');
      const p = parse(body);
      if ('ok' in p) return p;
      const id = await deps.repo.create(p.name, p.kind);
      if (id === null) return { ok: false, error: 'conflict', message: `Роль «${p.name}» уже есть.` };
      await deps.audit.write(actor, 'team_role.create', 'team_role', id, p);
      return { ok: true, id };
    },

    async update(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body) || !isId(body['id'])) return bad('Не указана роль.');
      const p = parse(body);
      if ('ok' in p) return p;
      const done = await deps.repo.update(body['id'], p.name, p.kind);
      if (done === 'missing') return { ok: false, error: 'not_found', message: 'Такой роли больше нет: обновите страницу.' };
      if (done === 'taken') return { ok: false, error: 'conflict', message: `Роль «${p.name}» уже есть.` };
      await deps.audit.write(actor, 'team_role.update', 'team_role', body['id'], p);
      return { ok: true };
    },

    async delete(body: unknown, actor: string): Promise<Outcome> {
      if (!isRecord(body) || !isId(body['id'])) return bad('Не указана роль.');
      const done = await deps.repo.delete(body['id']);
      if (done === 'missing') return { ok: false, error: 'not_found', message: 'Такой роли больше нет: обновите страницу.' };
      if (done === 'in_use') return { ok: false, error: 'conflict', message: 'Роль есть у людей в справочнике команды: сначала смените им роль.' };
      await deps.audit.write(actor, 'team_role.delete', 'team_role', body['id'], {});
      return { ok: true };
    },
  };
}

export type TeamRoles = ReturnType<typeof createTeamRoles>;
