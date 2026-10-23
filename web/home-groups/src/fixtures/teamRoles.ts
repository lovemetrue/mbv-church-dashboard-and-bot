import type { TeamRoleKind, TeamRolesView } from '@contracts';
import { ApiError } from '../shared/api/client';
import { COORDINATOR_ROLES, DEMO_TEAM_ROLES } from './raw';

/** Роли команды в демо: правка запоминается до перезагрузки страницы, как на сервере — с отказами по тем же правилам. */
const roles = DEMO_TEAM_ROLES.map((r) => ({ ...r }));
let nextId = roles.length + 1;

const membersOf = (name: string): number => Object.values(COORDINATOR_ROLES).filter((roles) => roles.includes(name)).length;

export function buildTeamRoles(): TeamRolesView {
  return {
    items: [...roles].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((r) => ({ ...r, members: membersOf(r.name) })),
  };
}

export function teamRoleAction(action: 'create' | 'update' | 'delete', body: unknown): { ok: true; id?: number } {
  const b = (body ?? {}) as { id?: number; name?: string; kind?: TeamRoleKind | null };
  const taken = (name: string, id?: number) => roles.some((r) => r.id !== id && r.name.toLowerCase() === name.trim().toLowerCase());
  if (action === 'create') {
    const name = (b.name ?? '').trim();
    if (taken(name)) throw new ApiError(409, `Роль «${name}» уже есть.`, 'conflict');
    const id = nextId++;
    roles.push({ id, name, kind: b.kind ?? null });
    return { ok: true, id };
  }
  const role = roles.find((r) => r.id === b.id);
  if (!role) throw new ApiError(404, 'Такой роли больше нет: обновите страницу.', 'not_found');
  if (action === 'update') {
    const name = (b.name ?? '').trim();
    if (taken(name, role.id)) throw new ApiError(409, `Роль «${name}» уже есть.`, 'conflict');
    role.name = name;
    role.kind = b.kind ?? null;
    return { ok: true };
  }
  if (membersOf(role.name) > 0) throw new ApiError(409, 'Роль есть у людей в справочнике команды: сначала смените им роль.', 'conflict');
  roles.splice(roles.indexOf(role), 1);
  return { ok: true };
}
