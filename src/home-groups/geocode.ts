import type { GeocodeEntry, GeoPoint } from '../db/repos/geocode.repo.js';

/**
 * Ключ адреса для кэша: регистр, лишние пробелы и знаки не должны плодить повторные запросы к геокодеру
 * («ул. Рылеева, 32» и «ул Рылеева 32» — один адрес).
 */
export function addressKey(raw: string | null | undefined): string | null {
  const key = (raw ?? '').toLowerCase().replaceAll('ё', 'е').replace(/[,;.()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
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
export type GeocodeResult = { kind: 'found'; point: GeoPoint; precision: string } | { kind: 'missing' } | { kind: 'failed'; message: string };

export interface Geocoder { geocode(address: string): Promise<GeocodeResult> }

/**
 * Точность, при которой точка годится для расстояния. «street» и «other» — это середина улицы или центр города: по ним
 * «рядом» не определить, такие адреса остаются на сравнении по названию улицы.
 */
const USABLE_PRECISION = new Set(['exact', 'number', 'near', 'range']);

/** Адреса без города Яндекс ищет по всей России, поэтому достраиваем город и подсказываем центр поиска. */
const HAS_CITY = /петербург|спб|санкт|ленинградск|гатчин|всеволожск|колпино|петергоф|пушкин|кронштадт|сестрорецк|ломоносов|мурино|кудрово/i;

export function createYandexGeocoder(apiKey: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return {
    async geocode(address) {
      const query = HAS_CITY.test(address) ? address : `Санкт-Петербург, ${address}`;
      const url = new URL('https://geocode-maps.yandex.ru/v1/');
      url.search = new URLSearchParams({
        apikey: apiKey, geocode: query, format: 'json', results: '1', lang: 'ru_RU', ll: '30.3351,59.9343', spn: '1.5,1.0',
      }).toString();
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
      }
      // 403 — ключ неверный или лимит исчерпан, 429 — слишком часто: это не «адрес не найден», кэшировать нельзя.
      if (!res.ok) return { kind: 'failed', message: `Геокодер ответил ${res.status}` };
      const body = (await res.json().catch(() => null)) as {
        response?: { GeoObjectCollection?: { featureMember?: { GeoObject?: { Point?: { pos?: string }; metaDataProperty?: { GeocoderMetaData?: { precision?: string } } } }[] } };
      } | null;
      const found = body?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
      const precision = found?.metaDataProperty?.GeocoderMetaData?.precision ?? '';
      // Яндекс отдаёт «долгота широта» через пробел.
      const [lon, lat] = (found?.Point?.pos ?? '').split(' ').map(Number);
      if (!found || !USABLE_PRECISION.has(precision) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: 'missing' };
      return { kind: 'found', point: { lat: lat!, lon: lon! }, precision };
    },
  };
}

export interface GeocodeStore {
  all(): Promise<Map<string, GeocodeEntry>>;
  save(key: string, point: GeoPoint | null, precision: string | null): Promise<void>;
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
    await store.save(key, r.kind === 'found' ? r.point : null, r.kind === 'found' ? r.precision : null);
    done += 1;
    await sleep(pauseMs);
  }
  return { done, failed: null };
}
