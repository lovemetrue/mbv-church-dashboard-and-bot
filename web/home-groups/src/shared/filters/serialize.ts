import type { FieldDef, Filter, Op, SortState, TableState } from './types';
import { EMPTY_TABLE_STATE } from './types';
import { needsValue } from './engine';

/**
 * Состояние таблицы справочника ↔ параметры адреса страницы. Так отбор переживает перезагрузку
 * и кнопку «назад», а ссылкой можно поделиться.
 *
 *   f=Район:eq:Приморский     (повторяется; двоеточие и % в частях экранируются)
 *   rq=текст                  быстрый поиск
 *   col=Район&col=Статус      столбцы (только если отличаются от стандартных)
 *   sort=Район:asc            сортировка
 *   gb=Район                  группировка
 */
export const TABLE_PARAMS = ['f', 'rq', 'col', 'sort', 'gb'] as const;

const OPS: readonly Op[] = ['eq', 'ne', 'ge', 'le', 'empty', 'filled'];

const esc = (s: string): string => s.replace(/%/g, '%25').replace(/:/g, '%3A');
const unesc = (s: string): string => s.replace(/%(25|3A)/g, (_, c: string) => (c === '25' ? '%' : ':'));

export function serializeFilter(f: Filter): string {
  return `${esc(f.field)}:${f.op}:${esc(needsValue(f.op) ? f.value : '')}`;
}

/** Обратный разбор; мусор и неизвестные поля/условия отбрасываем, а не роняем страницу. */
export function parseFilter(raw: string, defs: readonly FieldDef[]): Filter | null {
  const parts = raw.split(':');
  if (parts.length !== 3) return null;
  const [rawField, rawOp, rawValue] = parts as [string, string, string];
  const field = unesc(rawField);
  if (!defs.some((d) => d.key === field)) return null;
  if (!(OPS as readonly string[]).includes(rawOp)) return null;
  const op = rawOp as Op;
  const value = unesc(rawValue);
  if (needsValue(op) && value === '') return null;
  return { field, op, value: needsValue(op) ? value : '' };
}

export function serializeTableState(state: TableState, defaultColumns: readonly string[]): URLSearchParams {
  const p = new URLSearchParams();
  state.filters.forEach((f) => p.append('f', serializeFilter(f)));
  if (state.text.trim()) p.set('rq', state.text);
  const sameCols =
    state.columns === null ||
    (state.columns.length === defaultColumns.length && state.columns.every((c, i) => c === defaultColumns[i]));
  if (!sameCols && state.columns) state.columns.forEach((c) => p.append('col', c));
  if (state.sort) p.set('sort', `${esc(state.sort.field)}:${state.sort.dir}`);
  if (state.group) p.set('gb', state.group);
  return p;
}

export function parseTableState(
  params: URLSearchParams,
  defs: readonly FieldDef[],
  allColumns: readonly string[],
): TableState {
  const filters = params
    .getAll('f')
    .map((raw) => parseFilter(raw, defs))
    .filter((f): f is Filter => f !== null);

  const cols = params.getAll('col').filter((c) => allColumns.includes(c));
  // Столбцы показываем в порядке справочника, а не в порядке адреса: порядок задаёт сама таблица.
  const columns = cols.length ? allColumns.filter((c) => cols.includes(c)) : null;

  let sort: SortState | null = null;
  const rawSort = params.get('sort');
  if (rawSort) {
    const idx = rawSort.lastIndexOf(':');
    const field = unesc(rawSort.slice(0, idx));
    const dir = rawSort.slice(idx + 1);
    if (idx > 0 && allColumns.includes(field) && (dir === 'asc' || dir === 'desc')) sort = { field, dir };
  }

  const gb = params.get('gb');
  const group = gb && defs.some((d) => d.key === gb && d.groupable) ? gb : null;

  return { ...EMPTY_TABLE_STATE, filters, text: params.get('rq') ?? '', columns, sort, group };
}
