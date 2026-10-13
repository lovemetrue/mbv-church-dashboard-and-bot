import type { GeocodeEntry } from '../db/repos/geocode.repo.js';
import type { ActionError, AddressRowView, AddressTableView } from './contracts.js';

type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
import { DAILY_LIMIT, addressKey, type Geocoder, type GeocodeStore } from './geocode.js';
import { addressEntries } from './geocodeJob.js';

type Entries = Parameters<typeof addressEntries>[0];

const ORDER = { missing: 0, waiting: 1, found: 2 } as const;

/**
 * Таблица адресов для «Настройки → Геокодер»: каждый нужный подбору адрес один раз, его состояние (найден, не нашёлся,
 * ждёт запроса) и все карточки, где он записан, чтобы по ссылке открыть нужную и поправить. Сверху — те, что требуют внимания.
 */
export function buildAddressTable(input: Entries, cache: ReadonlyMap<string, GeocodeEntry>, now: Date): AddressTableView {
  const rows = new Map<string, AddressRowView>();
  for (const { address, source } of addressEntries(input)) {
    const key = addressKey(address);
    if (key === null) continue;
    const row = rows.get(key);
    if (row) {
      if (!row.sources.some((s) => s.kind === source.kind && s.id === source.id)) row.sources.push(source);
      continue;
    }
    const entry = cache.get(key);
    rows.set(key, {
      address: address.trim(),
      state: !cache.has(key) ? 'waiting' : entry ? 'found' : 'missing',
      accuracy: entry?.accuracy ?? null,
      lat: entry?.lat ?? null,
      lon: entry?.lon ?? null,
      matched: entry?.matched ?? null,
      sources: [source],
    });
  }
  const items = [...rows.values()].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.address.localeCompare(b.address, 'ru'));
  return { generatedAt: now.toISOString(), items };
}

/**
 * Повторить определение координат одного адреса: один запрос к Яндексу, ответ сразу записывается в кэш. Адрес должен быть
 * среди нужных подбору (чужие тексты не принимаем: иначе по этой ручке можно было бы тратить суточный лимит впустую).
 */
export function createAddressRetry(deps: {
  load: () => Promise<Entries>;
  store: GeocodeStore;
  currentKey: () => Promise<string | null>;
  geocoderFor: (key: string) => Geocoder;
  invalidate: () => void;
}) {
  return async (body: unknown): Promise<Outcome> => {
    const address = typeof body === 'object' && body !== null ? (body as { address?: unknown }).address : undefined;
    if (typeof address !== 'string' || addressKey(address) === null) return { ok: false, error: 'bad_request', message: 'Укажите адрес.' };
    const key = addressKey(address)!;
    if (!addressEntries(await deps.load()).some((e) => addressKey(e.address) === key)) {
      return { ok: false, error: 'not_found', message: 'Такого адреса сейчас нет ни в одной карточке: возможно, его уже поправили.' };
    }
    const apiKey = await deps.currentKey();
    if (!apiKey) return { ok: false, error: 'unavailable', message: 'Ключ геокодера не задан: введите его в «Настройки → Геокодер».' };
    if ((await deps.store.countSince(24)) >= DAILY_LIMIT) {
      return { ok: false, error: 'unavailable', message: 'Суточный лимит запросов к Яндексу исчерпан. Повторите завтра.' };
    }
    const r = await deps.geocoderFor(apiKey).geocode(address.trim());
    if (r.kind === 'failed') return { ok: false, error: 'unavailable', message: `Яндекс не принял запрос: ${r.message}.` };
    await deps.store.save(key, r.kind === 'found' ? r.point : null, r.kind === 'found' ? r.point.accuracy : null);
    deps.invalidate();
    return { ok: true };
  };
}

/**
 * «Это не адрес»: Яндекс иногда принимает за улицу обычное слово («среда с 18:00»). Запись в кэше становится «не нашёлся»,
 * и ни карта, ни подбор эту точку больше не используют; повторный запрос к Яндексу не делается. Поправленный текст в
 * карточке даёт новый ключ и определяется заново.
 */
export function createAddressReject(deps: { load: () => Promise<Entries>; store: GeocodeStore; invalidate: () => void }) {
  return async (body: unknown): Promise<Outcome> => {
    const address = typeof body === 'object' && body !== null ? (body as { address?: unknown }).address : undefined;
    const key = typeof address === 'string' ? addressKey(address) : null;
    if (key === null) return { ok: false, error: 'bad_request', message: 'Укажите адрес.' };
    if (!addressEntries(await deps.load()).some((e) => addressKey(e.address) === key)) {
      return { ok: false, error: 'not_found', message: 'Такого адреса сейчас нет ни в одной карточке: возможно, его уже поправили.' };
    }
    await deps.store.save(key, null, null);
    deps.invalidate();
    return { ok: true };
  };
}
