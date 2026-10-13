import type { GeoAccuracy, GeocodeEntry, GeoPoint } from '../db/repos/geocode.repo.js';

/**
 * Адрес как его пишут люди: со смайликами, скобками-улыбками («Гражданский проспект)))»), точками и запятыми на краях. Лишние
 * знаки убираем и в запросе, и в ключе кэша, иначе один и тот же адрес с разным «мусором» тратил бы разные запросы.
 * Остаются буквы, цифры, пробелы и знаки, нужные адресу: запятая, точка, дефис, косая черта, «№», кавычки.
 */
export function cleanAddress(raw: string | null | undefined): string {
  return (raw ?? '')
    // Скобки уходят вместе со смайликами: «(кв. 5)» читается и без них, а «)))» — просто эмоция.
    .replace(/[^\p{L}\p{N}\s,.\-/№'"«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.\-/]+|[\s,.\-/]+$/g, '')
    .trim();
}

/**
 * Ключ адреса для кэша: регистр, лишние пробелы и знаки не должны плодить повторные запросы к геокодеру
 * («ул. Рылеева, 32» и «ул Рылеева 32» — один адрес).
 */
export function addressKey(raw: string | null | undefined): string | null {
  const key = cleanAddress(raw).toLowerCase().replaceAll('ё', 'е').replace(/[,;.()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  return key.length >= 3 ? key : null;
}

const EARTH_RADIUS_M = 6_371_000;

/** Расстояние по большому кругу, метры. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Результат одного запроса: точка, «не нашли» (кэшируем) или сбой (не кэшируем, повторим позже). */
export type GeocodeResult = { kind: 'found'; point: GeoPoint & { accuracy: GeoAccuracy } } | { kind: 'missing' } | { kind: 'failed'; message: string };

export interface Geocoder { geocode(address: string): Promise<GeocodeResult> }

/**
 * Что считать найденным. Берём не только дом, но и центр улицы (дома в адресе нет) и центр посёлка или района (улицы нет):
 * человек, написавший «Юкки», живёт в Юкки, и для подбора этого достаточно. Не годятся слишком крупные объекты: страна,
 * область, район области и сам Санкт-Петербург целиком: центр города ничего не говорит о том, кто рядом.
 * Точность хранится вместе с точкой: по грубой точке расстояние считается с поправкой.
 */
const HOUSE_KINDS = new Set(['house', 'entrance', 'metro', 'airport', 'railway_station', 'vegetation', 'hydro', 'other']);
const STREET_KINDS = new Set(['street']);
const AREA_KINDS = new Set(['locality', 'district']);

export function accuracyOf(kind: string, precision: string, name: string): GeoAccuracy | null {
  if (kind === 'house') return precision === 'other' ? null : 'house';
  if (HOUSE_KINDS.has(kind)) return 'house';
  if (STREET_KINDS.has(kind)) return 'street';
  // Город-миллионник целиком (и «Ленинградская область» как locality) — слишком грубо.
  if (AREA_KINDS.has(kind)) return /^(санкт-петербург|ленинградская область)$/i.test(name.trim()) ? null : 'area';
  return null;
}

/** Адреса без города Яндекс ищет по всей России, поэтому достраиваем город и подсказываем центр поиска. */
const HAS_CITY = /петербург|спб|санкт|ленинградск|гатчин|всеволожск|колпино|петергоф|пушкин|кронштадт|сестрорецк|ломоносов|мурино|кудрово/i;

type YandexObject = { name?: string; Point?: { pos?: string }; metaDataProperty?: { GeocoderMetaData?: { kind?: string; precision?: string; text?: string } } };

export function createYandexGeocoder(apiKey: string, fetchImpl: typeof fetch = fetch): Geocoder {
  /** Один запрос к Яндексу: первый подходящий из трёх ответов (первый бывает слишком крупным, а второй — нужным домом). */
  async function lookup(query: string): Promise<GeocodeResult> {
    const url = new URL('https://geocode-maps.yandex.ru/v1/');
    url.search = new URLSearchParams({
      apikey: apiKey, geocode: query, format: 'json', results: '3', lang: 'ru_RU', ll: '30.3351,59.9343', spn: '1.5,1.0',
    }).toString();
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
    }
    // 403 — ключ неверный или лимит исчерпан, 429 — слишком часто: это не «адрес не найден», кэшировать нельзя.
    if (!res.ok) return { kind: 'failed', message: `Геокодер ответил ${res.status}` };
    const body = (await res.json().catch(() => null)) as { response?: { GeoObjectCollection?: { featureMember?: { GeoObject?: YandexObject }[] } } } | null;
    for (const member of body?.response?.GeoObjectCollection?.featureMember ?? []) {
      const found = member.GeoObject;
      const meta = found?.metaDataProperty?.GeocoderMetaData;
      const accuracy = found ? accuracyOf(meta?.kind ?? '', meta?.precision ?? '', found.name ?? '') : null;
      // Яндекс отдаёт «долгота широта» через пробел.
      const [lon, lat] = (found?.Point?.pos ?? '').split(' ').map(Number);
      if (accuracy !== null && Number.isFinite(lat) && Number.isFinite(lon)) return { kind: 'found', point: { lat: lat!, lon: lon!, accuracy, matched: meta?.text ?? found?.name ?? null } };
    }
    return { kind: 'missing' };
  }

  return {
    async geocode(address) {
      const clean = cleanAddress(address);
      if (HAS_CITY.test(clean)) return lookup(clean);
      // Сначала с Санкт-Петербургом: короткие «Рылеева 32» без него уходят куда угодно. Но деревня или посёлок области с
      // таким префиксом может не найтись, поэтому при неудаче спрашиваем ещё раз как написано (центр поиска и так в Петербурге).
      const first = await lookup(`Санкт-Петербург, ${clean}`);
      return first.kind === 'missing' ? lookup(clean) : first;
    },
  };
}

export interface GeocodeStore {
  all(): Promise<Map<string, GeocodeEntry>>;
  save(key: string, point: GeoPoint | null, accuracy: GeoAccuracy | null): Promise<void>;
  /** Сколько запросов уже сделано за последние `hours` часов (для суточного лимита). */
  countSince(hours: number): Promise<number>;
}

/** Бесплатный ключ — тысяча запросов в сутки; оставляем запас, чтобы ручные проверки и повторы не упёрлись в лимит. */
export const DAILY_LIMIT = 900;

/**
 * Дозаполняет кэш: берёт адреса, которых в нём нет, и спрашивает по одному с паузой (бесплатный лимит небольшой, а
 * адресов у церкви мало). На первом сбое (лимит, сеть) останавливается до следующего запуска.
 */
export async function geocodePending(
  addresses: readonly string[], store: GeocodeStore, geocoder: Geocoder,
  opts: { limit?: number; pauseMs?: number; dailyLimit?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ done: number; failed: string | null }> {
  const { limit = 50, pauseMs = 1000, dailyLimit = DAILY_LIMIT, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  // Остаток на сутки: когда он кончился, ждём — адреса дозаполнятся завтра, а подбор пока сравнивает улицы по названию.
  const budget = Math.min(limit, dailyLimit - (await store.countSince(24)));
  if (budget <= 0) return { done: 0, failed: null };
  const cache = await store.all();
  const todo = new Map<string, string>();
  for (const a of addresses) {
    const key = addressKey(a);
    if (key !== null && !cache.has(key) && !todo.has(key)) todo.set(key, a.trim());
  }
  let done = 0;
  for (const [key, address] of [...todo].slice(0, budget)) {
    const r = await geocoder.geocode(address);
    if (r.kind === 'failed') return { done, failed: r.message };
    await store.save(key, r.kind === 'found' ? r.point : null, r.kind === 'found' ? r.point.accuracy : null);
    done += 1;
    await sleep(pauseMs);
  }
  return { done, failed: null };
}
