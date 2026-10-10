import type { Cell, FieldDef, Filter, Op, Row, SortState } from './types';
import { NO_VALUE_OPS } from './types';

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

export const isBlank = (v: Cell | undefined): boolean => v === null || v === undefined || v === '';

/** Условия, доступные для поля: у чисел и дат есть «больше/меньше», у текста — нет. */
export function opsFor(def: FieldDef | undefined): Op[] {
  const kind = def?.kind ?? 'text';
  if (kind === 'text') return ['eq', 'ne', 'empty', 'filled'];
  return ['ge', 'le', 'eq', 'ne', 'empty', 'filled'];
}

export function needsValue(op: Op): boolean {
  return !NO_VALUE_OPS.includes(op);
}

/** Разбор ячейки-списка: «18–25, 26–35» → ['18–25', '26–35']. */
export function splitMulti(v: Cell): string[] {
  if (isBlank(v)) return [];
  return String(v)
    .split(/\s*,\s*/)
    .filter(Boolean);
}

/**
 * Проходит ли строка условие.
 *
 * Пустая ячейка не проходит «≥», «≤» и «=»: «Проверена, дн. ≥ 31» не должна ловить группы, у
 * которых проверки не было вовсе (иначе null превратился бы в 0 и сравнение стало бы ложью).
 * Для таких групп есть отдельное условие «пусто».
 */
export function matchesFilter(row: Row, f: Filter, defs: readonly FieldDef[]): boolean {
  const def = defs.find((d) => d.key === f.field);
  const v = row[f.field];
  if (f.op === 'empty') return isBlank(v);
  if (f.op === 'filled') return !isBlank(v);

  const kind = def?.kind ?? 'text';
  if (f.op === 'ge' || f.op === 'le') {
    if (isBlank(v) || f.value === '') return false;
    if (kind === 'number') {
      const a = Number(v);
      const b = Number(f.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return f.op === 'ge' ? a >= b : a <= b;
    }
    // Даты хранятся ISO-строкой, поэтому строковое сравнение совпадает с хронологическим.
    const a = String(v);
    return f.op === 'ge' ? a >= f.value : a <= f.value;
  }

  let equal: boolean;
  if (def?.multi) equal = splitMulti(v ?? null).includes(f.value);
  else if (kind === 'number') equal = !isBlank(v) && f.value !== '' && Number(v) === Number(f.value);
  else equal = !isBlank(v) && String(v) === f.value;
  return f.op === 'ne' ? !equal : equal;
}

export function applyFilters(rows: readonly Row[], filters: readonly Filter[], defs: readonly FieldDef[]): Row[] {
  if (!filters.length) return [...rows];
  return rows.filter((r) => filters.every((f) => matchesFilter(r, f, defs)));
}

/**
 * Быстрый поиск: подстрока в любой ячейке, без учёта регистра. Ключи, начинающиеся с «_»,
 * служебные (идентификатор записи) и в поиске не участвуют: иначе «u1» находил бы чужих людей.
 */
export function searchRows(rows: readonly Row[], text: string): Row[] {
  const t = text.trim().toLowerCase();
  if (!t) return [...rows];
  return rows.filter((r) =>
    Object.entries(r).some(([k, v]) => k[0] !== '_' && !isBlank(v) && String(v).toLowerCase().includes(t)),
  );
}

/**
 * Сортировка по полю. Пустые значения всегда внизу, в любом направлении: иначе при обратной
 * сортировке «не указано» вылезало бы наверх и закрывало настоящие данные.
 */
export function sortRows<T extends Row>(rows: readonly T[], sort: SortState | null, defs: readonly FieldDef[]): T[] {
  if (!sort) return [...rows];
  const kind = defs.find((d) => d.key === sort.field)?.kind ?? 'text';
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.field] ?? null;
    const y = b[sort.field] ?? null;
    const bx = isBlank(x);
    const by = isBlank(y);
    if (bx || by) return bx === by ? 0 : bx ? 1 : -1;
    if (kind === 'number') return (Number(x) - Number(y)) * sign;
    return collator.compare(String(x), String(y)) * sign;
  });
}

export interface RowGroup<T extends Row> {
  /** Значение поля группировки; '' — «не указано». */
  key: string;
  rows: T[];
}

/** Группировка с сохранением порядка строк внутри группы (то есть учётом сортировки). Пустая группа — последней. */
export function groupRows<T extends Row>(rows: readonly T[], field: string | null): RowGroup<T>[] {
  if (!field) return [{ key: '', rows: [...rows] }];
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const v = r[field];
    const key = isBlank(v) ? '' : String(v);
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : collator.compare(a, b)))
    .map(([key, list]) => ({ key, rows: list }));
}

/** Все значения поля для выпадающего списка в конструкторе отборов. */
export function distinctValues(rows: readonly Row[], def: FieldDef): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[def.key] ?? null;
    if (isBlank(v)) continue;
    if (def.multi) splitMulti(v).forEach((x) => set.add(x));
    else set.add(String(v));
  }
  return [...set].sort((a, b) => collator.compare(a, b));
}

/** Короткая подпись отбора для чипа: «Район = Приморский». */
export function filterLabel(f: Filter, opSymbol: Record<Op, string>): string {
  return needsValue(f.op) ? `${f.field} ${opSymbol[f.op]} ${f.value}` : `${f.field} ${opSymbol[f.op]}`;
}

/** Одинаковые ли отборы (для подсветки активного быстрого отбора). */
export function sameFilters(a: readonly Filter[], b: readonly Filter[]): boolean {
  if (a.length !== b.length) return false;
  const key = (f: Filter) => `${f.field}|${f.op}|${f.value}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}
