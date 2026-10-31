import { DISTRICTS } from '../core/groups.js';
import { matchesDistrict } from '../core/matching.js';
import type { GeoPoint } from '../db/repos/geocode.repo.js';
import { logger } from '../logger.js';
import { addressKey, createYandexGeocoder, DAILY_LIMIT, distanceMeters, type Geocoder, type GeocodeStore } from './geocode.js';
import { resolveDistrict } from './plan/geo.js';

/**
 * Район и метро группы по её адресу — при сохранении карточки, а не фоном: служитель видит их сразу после «Сохранить».
 *
 * Три запроса к Яндексу: адрес → точка (её же кладём в кэш координат, и метка на карте появляется без ожидания
 * фонового захода), точка → ближайшая станция метро, точка → административный район. Район берём у Яндекса, а не из
 * станции: у границ районов ближайшая станция бывает в соседнем (и за рекой). Станция — запасной путь к району.
 *
 * Сбой здесь не должен мешать сохранению: на любой ошибке — `null`, и группа сохраняется с тем, что ввели руками.
 */
export interface Place { district: string | null; metro: string | null }
export type Locate = (address: string) => Promise<Place | null>;

/** Дальше этого станция «ближайшей» не считается: в посёлке области метро в 15 км — не ориентир. */
export const METRO_MAX_M = 2500;

/** Районы, которые может назвать Яндекс: без «Онлайн» и без области (её узнаём по адресу целиком). */
const CITY_DISTRICTS = DISTRICTS.filter((d) => d !== 'Онлайн' && d !== 'Ленинградская область');
const REGION = 'Ленинградская область';

export interface Station { name: string; lat: number; lon: number }

/** «метро Пионерская» → «Пионерская»: так метро записано у групп и так его ищет подбор. */
export const stationName = (raw: string): string => raw.replace(/^\s*(станция\s+)?метро\s+/i, '').trim();

/**
 * Чистое решение по ответам Яндекса (тестируется без сети). `districtNames` — названия районов вокруг точки
 * («Приморский район», «муниципальный округ …»): первый из районов города; не нашёлся, а адрес в области — область;
 * иначе район по станции, как его определяет подбор.
 */
export function placeOf(point: GeoPoint, stations: readonly Station[], districtNames: readonly string[]): Place {
  // Посёлок или деревня найдены только центром: «ближайшее метро» от центра посёлка ничего не говорит.
  const nearest = point.accuracy === 'area' ? null : stations
    .map((s) => ({ s, m: distanceMeters(point, s) }))
    .filter((x) => x.m <= METRO_MAX_M)
    .sort((a, b) => a.m - b.m)[0]?.s ?? null;
  const metro = nearest ? stationName(nearest.name) : null;
  // В области свои Кировский и Ломоносовский районы: всё, что Яндекс отнёс к области, — область, а не район города.
  const inRegion = /ленинградская область/i.test(point.matched ?? '') || districtNames.some((n) => /ленинградская область/i.test(n));
  const named = inRegion ? null : districtNames.flatMap((n) => (/район/i.test(n) ? CITY_DISTRICTS.filter((d) => matchesDistrict(n, d)) : []))[0];
  const district = inRegion ? REGION : named ?? resolveDistrict(metro);
  return { district: district ?? null, metro };
}

type YandexObject = { name?: string; description?: string; Point?: { pos?: string } };

/** Обратный запрос «что рядом с точкой» нужного вида (`metro`, `district`). */
async function around(apiKey: string, fetchImpl: typeof fetch, p: GeoPoint, kind: 'metro' | 'district'): Promise<YandexObject[]> {
  const url = new URL('https://geocode-maps.yandex.ru/v1/');
  url.search = new URLSearchParams({
    apikey: apiKey, geocode: `${p.lon},${p.lat}`, kind, format: 'json', results: kind === 'metro' ? '3' : '5', lang: 'ru_RU',
  }).toString();
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Геокодер ответил ${res.status}`);
  const body = (await res.json()) as { response?: { GeoObjectCollection?: { featureMember?: { GeoObject?: YandexObject }[] } } };
  return (body.response?.GeoObjectCollection?.featureMember ?? []).flatMap((m) => (m.GeoObject ? [m.GeoObject] : []));
}

function stationsOf(objects: readonly YandexObject[]): Station[] {
  return objects.flatMap((o) => {
    const [lon, lat] = (o.Point?.pos ?? '').split(' ').map(Number);
    return o.name && Number.isFinite(lat) && Number.isFinite(lon) ? [{ name: o.name, lat: lat!, lon: lon! }] : [];
  });
}

export function createLocator(deps: {
  currentKey: () => Promise<string | null>;
  store: Pick<GeocodeStore, 'save' | 'countSince'>;
  /** Новая точка в кэше: представления пересчитываются, и метка группы встаёт на карту. */
  invalidate?: () => void;
  fetchImpl?: typeof fetch;
  geocoderFor?: (key: string, fetchImpl: typeof fetch) => Geocoder;
}): Locate {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const geocoderFor = deps.geocoderFor ?? ((key: string, f: typeof fetch) => createYandexGeocoder(key, f));
  return async (address) => {
    try {
      const key = await deps.currentKey();
      const cacheKey = addressKey(address);
      if (!key || cacheKey === null) return null;
      // Тот же суточный запас, что у фонового заполнения: ручные сохранения не должны выедать лимит ключа.
      if ((await deps.store.countSince(24)) >= DAILY_LIMIT) return null;
      const found = await geocoderFor(key, fetchImpl).geocode(address);
      if (found.kind === 'failed') return null;
      await deps.store.save(cacheKey, found.kind === 'found' ? found.point : null, found.kind === 'found' ? found.point.accuracy : null);
      deps.invalidate?.();
      if (found.kind !== 'found') return null;
      const [metro, districts] = await Promise.all([
        around(key, fetchImpl, found.point, 'metro'),
        around(key, fetchImpl, found.point, 'district'),
      ]);
      return placeOf(found.point, stationsOf(metro), districts.map((d) => `${d.name ?? ''} ${d.description ?? ''}`));
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'район и метро по адресу не определились');
      return null;
    }
  };
}

/**
 * Что дописать в группу по адресу: найденные район и метро (ненайденное остаётся как было). Онлайн-группе — ничего:
 * у неё бывает адрес ведущего, но «район» у неё — «Онлайн», и по адресу его менять нельзя.
 */
export async function autoPlace(
  locate: Locate | undefined, address: string | null | undefined, district: string,
): Promise<{ district?: string; metro?: string }> {
  if (!locate || !address?.trim() || district === 'Онлайн') return {};
  const place = await locate(address);
  return { ...(place?.district ? { district: place.district } : {}), ...(place?.metro ? { metro: place.metro } : {}) };
}
