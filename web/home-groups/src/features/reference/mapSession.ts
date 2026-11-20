import type { GroupItem } from '@contracts';
import { isFilter, type Filter } from '../../shared/filters';

/**
 * Что карта групп помнит.
 *
 * 1. Вид — в localStorage браузера (личное удобство, как темы и сохранённые виды): центр, масштаб, переключатели и фильтры.
 *    После перезагрузки страницы с ним строится и снимок, и живая карта — «без потери форматирования».
 * 2. «Сессия» — в памяти страницы, до перезагрузки: загружен ли уже скрипт Яндекса (тогда карта живая сразу и лимит не
 *    тратится) и зафиксированные данные групп. Метки меняются только по «Обновить»: между нажатиями картина та же, даже
 *    если список групп в фоне обновился. Карта на «Сегодня» и в «Заявках» — один компонент, сессия у них общая.
 */
export interface MapView {
  /** null — вид ещё не выбирали: карта сама охватит все метки. */
  center: [number, number] | null;
  zoom: number | null;
  kinds: { active: boolean; potential: boolean };
  noOnline: boolean;
  /** «Не направлять»: показать некамерные группы с отметкой «не направлять» (своим цветом). По умолчанию скрыты. */
  noRefer: boolean;
  filters: Filter[];
}

export const MAP_VIEW_KEY = 'hg.groupsMap.view';
export const DEFAULT_MAP_VIEW: MapView = { center: null, zoom: null, kinds: { active: true, potential: true }, noOnline: true, noRefer: false, filters: [] };

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function parseMapView(raw: string | null): MapView {
  if (!raw) return DEFAULT_MAP_VIEW;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return DEFAULT_MAP_VIEW;
    const c = v.center;
    const center = Array.isArray(c) && c.length === 2 && isNum(c[0]) && isNum(c[1]) ? ([c[0], c[1]] as [number, number]) : null;
    const k = (v.kinds ?? {}) as Record<string, unknown>;
    return {
      center,
      zoom: center && isNum(v.zoom) ? v.zoom : null,
      kinds: { active: k.active !== false, potential: k.potential !== false },
      noOnline: v.noOnline !== false,
      noRefer: v.noRefer === true,
      filters: Array.isArray(v.filters) ? v.filters.filter(isFilter) : [],
    };
  } catch {
    return DEFAULT_MAP_VIEW;
  }
}

export function readMapView(): MapView {
  try {
    return parseMapView(window.localStorage.getItem(MAP_VIEW_KEY));
  } catch {
    // Хранилище закрыто (приватное окно, запрет сайта): живём с видом по умолчанию.
    return DEFAULT_MAP_VIEW;
  }
}

export function writeMapView(view: MapView): void {
  try {
    window.localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(view));
  } catch {
    /* не запомнилось — не страшно */
  }
}

/** Память одной загрузки страницы. F5 и новая вкладка браузера начинают с чистой: показывается снимок. */
export const mapSession: {
  /** Скрипт JS API уже на странице: карта живая сразу, без кнопки и без нового открытия в счётчике. */
  live: boolean;
  /** Группы на момент последнего «Обновить» (или первого показа); null — ещё не брали. */
  frozen: readonly GroupItem[] | null;
  /** Какой вид последним отправлен на снимок: тот же второй раз не шлём. */
  pushed: string | null;
} = { live: false, frozen: null, pushed: null };

/** Пауза перед снимком: человек двигает карту, снимок нужен от вида, на котором он остановился. */
export const mapTiming = { snapshotDelayMs: 1500 };

/** Для тестов: как после перезагрузки страницы. */
export function resetMapSession(): void {
  mapSession.live = false;
  mapSession.frozen = null;
  mapSession.pushed = null;
}
