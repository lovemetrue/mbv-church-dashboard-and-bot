import type { Pool } from 'pg';
import { GeocodeRepo, type GeocodeEntry } from '../db/repos/geocode.repo.js';
import { logger } from '../logger.js';
import { addressKey, createYandexGeocoder, geocodePending, type Geocoder } from './geocode.js';
import type { ViewsInput } from './api/views.js';

/**
 * Адреса, которые нужно знать подбору: адреса действующих групп и улица из открытых заявок «в группу» (правка координатора
 * важнее анкеты). Закрытые группы и закрытые заявки в подбор не идут, а лимит запросов у бесплатного ключа небольшой.
 */
export function addressesOf(input: Pick<ViewsInput, 'groups' | 'requests'>): string[] {
  const out: string[] = [];
  for (const g of input.groups) if (g.address && g.status !== 'Закрыта') out.push(g.address);
  for (const r of input.requests) {
    if (r.type !== 'join_group' || r.status === 'Исполнена' || r.status === 'Аннулирована') continue;
    const text = r.manual_street ?? r.address;
    if (text) out.push(text);
  }
  return out;
}

/** Сколько нужных подбору адресов уже с координатами, сколько не нашлось и сколько ещё ждёт запроса; одинаковые адреса считаются один раз. */
export function addressStats(addresses: readonly string[], cache: ReadonlyMap<string, GeocodeEntry>, listLimit = 30) {
  const seen = new Map<string, string>();
  for (const a of addresses) {
    const key = addressKey(a);
    if (key !== null && !seen.has(key)) seen.set(key, a.trim());
  }
  let found = 0;
  let missing = 0;
  const missingList: string[] = [];
  for (const [key, text] of seen) {
    if (!cache.has(key)) continue;
    if (cache.get(key)) found += 1;
    else {
      missing += 1;
      if (missingList.length < listLimit) missingList.push(text);
    }
  }
  return { addresses: { total: seen.size, found, missing, waiting: seen.size - found - missing }, missingList };
}

/**
 * Раз в несколько минут дозаполняет кэш координат. Сбой (лимит, сеть) не роняет сервис: следующий заход повторит.
 * Первый заход — сразу после запуска, чтобы свежие адреса не ждали.
 */
export function startGeocoding(deps: {
  load: () => Promise<ViewsInput>; db: Pool; apiKey: () => Promise<string | null>; invalidate: () => void;
  geocoderFor?: (key: string) => Geocoder; intervalMs?: number;
}): NodeJS.Timeout {
  const store = new GeocodeRepo(deps.db);
  const geocoderFor = deps.geocoderFor ?? ((key: string) => createYandexGeocoder(key));
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const key = await deps.apiKey();
      if (!key) return;
      const { done, failed } = await geocodePending(addressesOf(await deps.load()), store, geocoderFor(key));
      if (done > 0) deps.invalidate();
      if (failed) logger.warn({ failed, done }, 'геокодер: остановились до следующего захода');
      else if (done > 0) logger.info({ done }, 'геокодер: адреса добавлены в кэш');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : err }, 'геокодер: заход не удался');
    } finally {
      busy = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), deps.intervalMs ?? 5 * 60_000);
}
