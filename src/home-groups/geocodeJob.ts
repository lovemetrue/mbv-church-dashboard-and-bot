import type { Pool } from 'pg';
import { GeocodeRepo } from '../db/repos/geocode.repo.js';
import { logger } from '../logger.js';
import { createYandexGeocoder, geocodePending, type Geocoder } from './geocode.js';
import type { ViewsInput } from './api/views.js';

/** Адреса, которые нужно знать подбору: адреса групп и улица из заявок (правка координатора важнее анкеты). */
export function addressesOf(input: Pick<ViewsInput, 'groups' | 'requests'>): string[] {
  const out: string[] = [];
  for (const g of input.groups) if (g.address) out.push(g.address);
  for (const r of input.requests) {
    const text = r.manual_street ?? r.address;
    if (text) out.push(text);
  }
  return out;
}

/**
 * Раз в несколько минут дозаполняет кэш координат. Сбой (лимит, сеть) не роняет сервис: следующий заход повторит.
 * Первый заход — сразу после запуска, чтобы свежие адреса не ждали.
 */
export function startGeocoding(deps: {
  load: () => Promise<ViewsInput>; db: Pool; apiKey: string; invalidate: () => void; geocoder?: Geocoder; intervalMs?: number;
}): NodeJS.Timeout {
  const store = new GeocodeRepo(deps.db);
  const geocoder = deps.geocoder ?? createYandexGeocoder(deps.apiKey);
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const { done, failed } = await geocodePending(addressesOf(await deps.load()), store, geocoder);
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
