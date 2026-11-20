import type { MapSnapshotRepo } from '../db/repos/mapSnapshots.repo.js';
import type { ActionError, GroupItem, MapSnapshotMeta, MapSnapshotOk } from './contracts.js';

/**
 * Снимок карты групп через Yandex Static API. После перезагрузки страницы интерфейс показывает эту картинку, а не живую
 * карту: каждая загрузка JS API расходует суточный лимит ключа, а картинка — нет.
 *
 * Снимок делает и хранит сервер, у каждого входа свой (свои центр, масштаб и фильтры). Ключ Static API из сервера не
 * выходит. Страница присылает только вид (центр, масштаб) и номера групп, чьи метки у неё на карте; координаты берутся
 * из списка групп, который сервер уже отдал этому входу (`groupsFor` в `contactsAccess.ts`), поэтому на снимок не попадёт
 * то, чего вошедший не видит и так. Камерных групп на снимке нет никогда, как и на живой карте.
 */
const STATIC_URL = 'https://static-maps.yandex.ru/v1';
/** Больше меток Static API в одном запросе не берёт. */
export const STATIC_MAX_MARKS = 100;
/** Наибольший размер картинки у Static API. */
const SIZE = '650,450';
/** Снимок больше этого — не картинка карты, что-то пошло не так. */
const MAX_PNG_BYTES = 2_000_000;
/** «Закрыта» и «Аннулирована» на карту не идут: туда не направляют (как на живой карте). */
const OFF_MAP: ReadonlySet<string> = new Set(['Закрыта', 'Аннулирована']);

type Failure = { ok: false; error: ActionError['error']; message: string };

/** Цвет метки как на живой карте: «не направлять» — серая, потенциальная — оранжевая, остальные — синие. */
const markStyle = (g: GroupItem): string => (g.doNotRefer ? 'pm2grm' : g.status === 'Потенциальная' ? 'pm2orm' : 'pm2blm');
/** Шесть знаков после запятой — это десятки сантиметров: точнее, чем отдаёт геокодер, не нужно. */
const num = (x: number): string => String(Number(x.toFixed(6)));

interface View { lat: number; lon: number; zoom: number; groupIds: number[] }

function parseBody(body: unknown): View | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const c = b['center'];
  if (typeof c !== 'object' || c === null) return null;
  const { lat, lon } = c as Record<string, unknown>;
  const zoom = b['zoom'];
  const ids = b['groupIds'];
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof zoom !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 21) return null;
  if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((id) => Number.isSafeInteger(id))) return null;
  return { lat, lon, zoom: Math.round(zoom), groupIds: ids as number[] };
}

export function createMapSnapshots(deps: {
  repo: Pick<MapSnapshotRepo, 'get' | 'put'>;
  staticKey: () => Promise<string | null>;
  /** Запрос картинки к Яндексу; в тестах подменяется. */
  fetchImage?: (url: string) => Promise<Buffer>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const fetchImage = deps.fetchImage ?? fetchPng;
  const metaOf = (r: { takenAt: Date; marks: number; skipped: number }): MapSnapshotMeta => ({ takenAt: r.takenAt.toISOString(), marks: r.marks, skipped: r.skipped });

  return {
    async meta(viewer: string): Promise<MapSnapshotMeta | null> {
      const row = await deps.repo.get(viewer);
      return row ? metaOf(row) : null;
    },

    async png(viewer: string): Promise<Buffer | null> {
      return (await deps.repo.get(viewer))?.png ?? null;
    },

    /** `groups` — группы, как их видит этот вход (уже через `groupsFor`). */
    async take(viewer: string, body: unknown, groups: readonly GroupItem[]): Promise<MapSnapshotOk | Failure> {
      const view = parseBody(body);
      if (!view) return { ok: false, error: 'bad_request', message: 'Не тот вид карты: нужны центр, масштаб и номера групп.' };
      const key = await deps.staticKey();
      if (!key) return { ok: false, error: 'unavailable', message: 'Ключ Static API не задан в «Настройки → Карта»: снимка карты нет.' };

      const byId = new Map(groups.map((g) => [g.id, g]));
      const wanted = [...new Set(view.groupIds)].sort((a, b) => a - b);
      const marks = wanted
        .map((id) => byId.get(id))
        .filter((g): g is GroupItem => g !== undefined && !g.chamber && g.coords !== null && !OFF_MAP.has(g.status));
      const shown = marks.slice(0, STATIC_MAX_MARKS);
      const params = new URLSearchParams({ lang: 'ru_RU', ll: `${num(view.lon)},${num(view.lat)}`, z: String(view.zoom), size: SIZE });
      if (shown.length > 0) params.set('pt', shown.map((g) => `${num(g.coords!.lon)},${num(g.coords!.lat)},${markStyle(g)}`).join('~'));
      // Ключ в сравнение не входит: смена ключа не повод перезапрашивать ту же картинку.
      const signature = params.toString();

      const old = await deps.repo.get(viewer);
      if (old && old.params === signature) return { ok: true, snapshot: metaOf(old) };

      let png: Buffer;
      try {
        png = await fetchImage(`${STATIC_URL}?apikey=${encodeURIComponent(key)}&${signature}`);
      } catch {
        // Текст ответа Яндекса не показываем: в нём бывает ключ. Прежний снимок остаётся.
        return { ok: false, error: 'unavailable', message: 'Яндекс не отдал снимок карты. Проверьте ключ Static API в «Настройки → Карта».' };
      }
      const row = { params: signature, png, marks: shown.length, skipped: marks.length - shown.length, takenAt: now() };
      await deps.repo.put(viewer, row);
      return { ok: true, snapshot: metaOf(row) };
    },
  };
}

async function fetchPng(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Static API: ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('Static API: не картинка');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_PNG_BYTES) throw new Error('Static API: размер картинки');
  return buf;
}

export type MapSnapshots = ReturnType<typeof createMapSnapshots>;
