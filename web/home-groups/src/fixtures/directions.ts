import type { GroupDirectionsView } from '@contracts';
import { ApiError } from '../shared/api/client';
import { DEMO_DIRECTIONS, RAW_GROUPS } from './raw';

/** Направления в демо: правка запоминается до перезагрузки страницы, как на сервере — с отказами по тем же правилам. */
const directions = DEMO_DIRECTIONS.map((name, i) => ({ id: i + 1, name }));
let nextId = directions.length + 1;

const groupsOf = (name: string): number => RAW_GROUPS.filter((g) => g.direction === name).length;

export function buildDirections(): GroupDirectionsView {
  return { items: directions.map((d) => ({ ...d, groups: groupsOf(d.name) })) };
}

export function directionAction(action: 'create' | 'update' | 'delete', body: unknown): { ok: true; id?: number } {
  const b = (body ?? {}) as { id?: number; name?: string };
  const taken = (name: string, id?: number) => directions.some((d) => d.id !== id && d.name.toLowerCase() === name.trim().toLowerCase());
  if (action === 'create') {
    const name = (b.name ?? '').trim();
    if (taken(name)) throw new ApiError(409, `Направление «${name}» уже есть.`, 'conflict');
    const id = nextId++;
    directions.push({ id, name });
    return { ok: true, id };
  }
  const found = directions.find((d) => d.id === b.id);
  if (!found) throw new ApiError(404, 'Такого направления больше нет: обновите страницу.', 'not_found');
  if (action === 'update') {
    const name = (b.name ?? '').trim();
    if (taken(name, found.id)) throw new ApiError(409, `Направление «${name}» уже есть.`, 'conflict');
    found.name = name;
    return { ok: true };
  }
  if (groupsOf(found.name) > 0) throw new ApiError(409, 'У направления есть группы: сначала смените им направление.', 'conflict');
  directions.splice(directions.indexOf(found), 1);
  return { ok: true };
}
