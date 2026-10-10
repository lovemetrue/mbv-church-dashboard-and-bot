import { isBucketFilter, type BucketFilter } from '../../entities/buckets';

/**
 * Состояние экрана живёт в адресе (`?tab=requests&bucket=ready&req=12`), а не в памяти:
 * так оно переживает перезагрузку и кнопку «назад», а на запись можно дать ссылку.
 *
 *   tab     today (по умолчанию) | requests | reference
 *   q       поиск по заявкам (общий для шапки)
 *   bucket  all (по умолчанию) | ready | callback | human | done
 *   req     открытая заявка
 *   ent     groups (по умолчанию) | people | coordinators
 *   rec     открытая запись справочника
 *   f, rq, col, sort, gb — таблица справочника, см. shared/filters/serialize.ts
 */
export type TabId = 'today' | 'requests' | 'reference';
export const TAB_IDS: readonly TabId[] = ['today', 'requests', 'reference'];

export type EntityId = 'groups' | 'people' | 'coordinators';
export const ENTITY_IDS: readonly EntityId[] = ['groups', 'people', 'coordinators'];

export function parseTab(v: string | null): TabId {
  return (TAB_IDS as readonly string[]).includes(v ?? '') ? (v as TabId) : 'today';
}
export function parseEntity(v: string | null): EntityId {
  return (ENTITY_IDS as readonly string[]).includes(v ?? '') ? (v as EntityId) : 'groups';
}
export function parseBucket(v: string | null): BucketFilter {
  return isBucketFilter(v) ? v : 'all';
}
export function parseId(v: string | null): number | null {
  if (!v || !/^\d+$/.test(v)) return null;
  return Number(v);
}

export type ParamPatch = Record<string, string | readonly string[] | null | undefined>;

/**
 * Накладывает изменения на текущие параметры: null/undefined/'' убирают параметр, массив
 * записывает повторяющимся параметром. Пустой поиск и значения по умолчанию в адрес не пишем,
 * чтобы он оставался короткой чистой ссылкой.
 */
export function patchParams(current: URLSearchParams, patch: ParamPatch): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key);
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      if (value !== '') next.set(key, value);
    } else {
      value.forEach((v) => next.append(key, v));
    }
  }
  return next;
}

/**
 * Переход на другую вкладку. Поиск по заявкам общий для шапки и сохраняется; всё остальное
 * (корзина, открытая карточка, отборы справочника) принадлежит вкладке и сбрасывается:
 * иначе отбор из справочника «прилипал» бы к заявкам.
 */
export function tabParams(current: URLSearchParams, tab: TabId): URLSearchParams {
  const next = new URLSearchParams();
  const q = current.get('q');
  if (tab !== 'today') next.set('tab', tab);
  if (q) next.set('q', q);
  return next;
}
