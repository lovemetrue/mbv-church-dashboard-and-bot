import type { ParamPatch } from '../nav/params';

/**
 * «Мои виды» — сохранённые наборы отборов экрана. Вид = имя + строка адресных параметров
 * (`bucket=ready&resp=Анна`), поэтому применить его — значит записать эти параметры в адрес.
 * Всё здесь — чистые функции: хранилище и React подключены отдельно.
 */
export type ViewScope = 'requests' | 'reference';

export interface StoredView {
  /** Экран, на котором вид создан: виды «Заявок» и «Справочника» друг другу не показываем. */
  scope: ViewScope;
  name: string;
  query: string;
}

export const VIEW_NAME_MAX = 40;
/** Предел на экран, а не на всё хранилище: список в окошке должен оставаться обозримым. */
export const VIEWS_PER_SCOPE_MAX = 20;

/**
 * Белый список: в вид попадает только то, что перечислено, а не «всё, кроме вкладки и записи».
 * Так новый параметр адреса (например, открытая карточка) не начнёт сохраняться сам по себе.
 *
 * `nodef` у справочника — метка «отбор по умолчанию снят»: без неё вид с пустым отбором при
 * применении возвращал бы умолчание (у групп это скрытие закрытых), и вид показывал бы другое.
 */
const VIEW_KEYS: Record<ViewScope, readonly string[]> = {
  requests: ['bucket', 'resp', 'f'],
  reference: ['ent', 'f', 'col', 'gb', 'sort', 'nodef'],
};

/** Поиск по заявкам — введённый человеком текст (ФИО, телефон), поэтому хранится только по отметке. */
const SEARCH_KEY = 'q';

/**
 * Что сбрасывается при применении вида, даже если сам вид этого не хранит: открытая заявка/запись
 * и быстрый поиск таблицы относятся к прежнему списку и в новом могли бы не найтись.
 */
const RESET_KEYS: Record<ViewScope, readonly string[]> = {
  requests: ['req'],
  reference: ['rec', 'rq'],
};

const keysOf = (scope: ViewScope): readonly string[] =>
  scope === 'requests' ? [...VIEW_KEYS.requests, SEARCH_KEY] : VIEW_KEYS.reference;

/** Строка параметров для сохранения: только белый список; поиск — по явной отметке. */
export function pickViewParams(scope: ViewScope, params: URLSearchParams, opts: { withSearch: boolean }): string {
  const out = new URLSearchParams();
  const keys = scope === 'requests' && !opts.withSearch ? VIEW_KEYS.requests : keysOf(scope);
  for (const key of keys) params.getAll(key).forEach((v) => out.append(key, v));
  return out.toString();
}

/**
 * Изменение адреса для применения вида: сначала всё, что относится к экрану, обнуляется, потом
 * накладывается сохранённое. Вкладку не трогаем. Чужие параметры из записи (хранилище мог
 * подправить кто угодно) игнорируем так же, как при сохранении.
 */
export function viewPatch(scope: ViewScope, query: string): ParamPatch {
  const saved = new URLSearchParams(query);
  const patch: ParamPatch = {};
  for (const key of RESET_KEYS[scope]) patch[key] = null;
  for (const key of keysOf(scope)) {
    const values = saved.getAll(key);
    patch[key] = values.length === 0 ? null : key === 'f' || key === 'col' ? values : (values[0] ?? null);
  }
  return patch;
}

export const viewsOf = (all: readonly StoredView[], scope: ViewScope): StoredView[] =>
  all.filter((v) => v.scope === scope);

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export type AddError = 'empty' | 'long' | 'limit';

/** Имя без краевых и повторных пробелов. */
export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * Добавляет вид. Тот же вид под тем же именем (без учёта регистра) обновляется на месте:
 * человек, сохраняя «Мои звонки» ещё раз, хочет заменить, а не получить двойника.
 */
export function addView(
  all: readonly StoredView[],
  scope: ViewScope,
  rawName: string,
  query: string,
): { views: StoredView[]; error?: AddError } {
  const name = normalizeName(rawName);
  if (!name) return { views: [...all], error: 'empty' };
  if (name.length > VIEW_NAME_MAX) return { views: [...all], error: 'long' };
  const existing = all.findIndex((v) => v.scope === scope && sameName(v.name, name));
  if (existing >= 0) {
    const views = [...all];
    views[existing] = { scope, name, query };
    return { views };
  }
  if (viewsOf(all, scope).length >= VIEWS_PER_SCOPE_MAX) return { views: [...all], error: 'limit' };
  return { views: [...all, { scope, name, query }] };
}

export const removeView = (all: readonly StoredView[], scope: ViewScope, name: string): StoredView[] =>
  all.filter((v) => !(v.scope === scope && v.name === name));

const isScope = (x: unknown): x is ViewScope => x === 'requests' || x === 'reference';

/** Чтение из хранилища: что не похоже на вид — отбрасываем, а не роняем экран. */
export function parseStoredViews(raw: string | null): StoredView[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  let out: StoredView[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (!isScope(v.scope) || typeof v.name !== 'string' || typeof v.query !== 'string') continue;
    const name = normalizeName(v.name);
    if (!name || name.length > VIEW_NAME_MAX) continue;
    // Через addView, чтобы лимит и дубли имён действовали и на данные из хранилища.
    out = addView(out, v.scope, name, v.query).views;
  }
  return out;
}
