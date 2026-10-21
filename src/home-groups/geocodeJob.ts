import type { Pool } from 'pg';
import { GeocodeRepo, type GeocodeEntry } from '../db/repos/geocode.repo.js';
import { groupCode } from '../core/groups.js';
import { logger } from '../logger.js';
import { addressKey, createYandexGeocoder, geocodePending, type Geocoder } from './geocode.js';
import type { ViewsInput } from './api/views.js';

/** Группы, чьи адреса геокодируются: все, кроме закрытых (в том числе «Недвижимость»: они нужны справочнику и карте). */
export const GEOCODED_GROUP_STATUSES: ReadonlySet<string> = new Set(['Функционирует', 'На паузе', 'Потенциальная', 'Недвижимость']);

/** Откуда взят адрес: по этому описанию в таблице адресов открывается карточка. */
export interface AddressSource { kind: 'group' | 'request' | 'person'; id: string; label: string }
export interface AddressEntry { address: string; source: AddressSource }

/**
 * Адреса, которые нужны подбору и справочнику, вместе с тем, откуда они взяты: у групп из `GEOCODED_GROUP_STATUSES` и у всех
 * людей, где адрес заполнен (анкета регистрации, улица из заявок; правка координатора важнее анкеты).
 *
 * Порядок важен: у бесплатного ключа суточный лимит, а геокодер идёт по списку сверху вниз. Сначала группы (их мало, и без
 * них сравнивать не с чем), потом открытые заявки «в группу» (те, кого сейчас подбирают), потом остальные люди.
 */
export function addressEntries(input: {
  groups: readonly { id: number; leader: string; address: string | null; status: string }[];
  requests: readonly { id: number; fio: string | null; type: string; status: string; manual_street: string | null; address: string | null }[];
  participants?: readonly { id: number; full_name: string | null; address: string | null }[];
}): AddressEntry[] {
  const out: AddressEntry[] = [];
  for (const g of input.groups) {
    if (g.address && GEOCODED_GROUP_STATUSES.has(g.status)) {
      out.push({ address: g.address, source: { kind: 'group', id: String(g.id), label: `Группа ${groupCode(g.id)}, ${g.leader}` } });
    }
  }
  const text = (r: { manual_street: string | null; address: string | null }) => r.manual_street ?? r.address;
  const open = (r: { type: string; status: string }) => r.type === 'join_group' && r.status !== 'Исполнена' && r.status !== 'Аннулирована';
  const request = (r: (typeof input.requests)[number]): AddressEntry => ({
    address: text(r)!, source: { kind: 'request', id: String(r.id), label: `Заявка №${r.id}${r.fio ? `, ${r.fio}` : ''}` },
  });
  for (const r of input.requests) if (open(r) && text(r)) out.push(request(r));
  for (const r of input.requests) if (!open(r) && text(r)) out.push(request(r));
  for (const u of input.participants ?? []) {
    if (u.address) out.push({ address: u.address, source: { kind: 'person', id: `u${u.id}`, label: u.full_name ?? `Регистрация №${u.id}` } });
  }
  return out;
}

/** Только тексты адресов, в том же порядке (очередь геокодера). */
export const addressesOf = (input: Parameters<typeof addressEntries>[0]): string[] => addressEntries(input).map((e) => e.address);

/** Сколько нужных подбору адресов уже с координатами, сколько не нашлось и сколько ещё ждёт запроса; одинаковые адреса считаются один раз. */
export function addressStats(addresses: readonly string[], cache: ReadonlyMap<string, GeocodeEntry>) {
  const seen = new Set<string>();
  for (const a of addresses) {
    const key = addressKey(a);
    if (key !== null) seen.add(key);
  }
  let found = 0;
  let missing = 0;
  for (const key of seen) {
    if (!cache.has(key)) continue;
    if (cache.get(key)) found += 1;
    else missing += 1;
  }
  return { addresses: { total: seen.size, found, missing, waiting: seen.size - found - missing } };
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
