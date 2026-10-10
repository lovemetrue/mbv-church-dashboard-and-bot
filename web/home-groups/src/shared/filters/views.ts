import type { Filter, SavedView, SortState } from './types';

/**
 * Сохранённые виды лежат в localStorage браузера: это личное удобство каждого служителя, на
 * сервер они не уходят. Хранилище может быть недоступно, поэтому каждое обращение в try/catch.
 */
const storageKey = (entity: string): string => `hg.views.${entity}`;

function isFilter(x: unknown): x is Filter {
  if (!x || typeof x !== 'object') return false;
  const f = x as Record<string, unknown>;
  return typeof f.field === 'string' && typeof f.op === 'string' && typeof f.value === 'string';
}

function isSort(x: unknown): x is SortState {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return typeof s.field === 'string' && (s.dir === 'asc' || s.dir === 'desc');
}

function parseViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: SavedView[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const v = item as Record<string, unknown>;
      if (typeof v.name !== 'string' || !Array.isArray(v.filters) || !v.filters.every(isFilter)) continue;
      out.push({
        name: v.name,
        filters: v.filters,
        columns: Array.isArray(v.columns) && v.columns.every((c) => typeof c === 'string') ? (v.columns as string[]) : undefined,
        group: typeof v.group === 'string' ? v.group : null,
        sort: isSort(v.sort) ? v.sort : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadViews(entity: string): SavedView[] {
  try {
    return parseViews(window.localStorage.getItem(storageKey(entity)));
  } catch {
    return [];
  }
}

function persist(entity: string, views: SavedView[]): void {
  try {
    window.localStorage.setItem(storageKey(entity), JSON.stringify(views));
  } catch {
    /* вид не сохранится — не критично */
  }
}

/** Вид с тем же названием заменяется: так можно «обновить» вид, сохранив под прежним именем. */
export function saveView(entity: string, view: SavedView): SavedView[] {
  const name = view.name.trim();
  if (!name) return loadViews(entity);
  const next = [...loadViews(entity).filter((v) => v.name !== name), { ...view, name }];
  persist(entity, next);
  return next;
}

export function deleteView(entity: string, name: string): SavedView[] {
  const next = loadViews(entity).filter((v) => v.name !== name);
  persist(entity, next);
  return next;
}
