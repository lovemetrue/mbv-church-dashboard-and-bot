import { describe, expect, test } from 'vitest';
import type { GeocodeEntry } from '../src/db/repos/geocode.repo.js';
import { addressKey, type Geocoder, type GeocodeStore } from '../src/home-groups/geocode.js';
import { buildAddressTable, createAddressRetry } from '../src/home-groups/geocodeAddresses.js';

const group = (id: number, address: string | null, status = 'Функционирует', leader = 'Ольга') => ({ id, no: id, leader, address, status });
const request = (id: number, address: string | null, over: Partial<{ type: string; status: string; manual_street: string | null; fio: string | null }> = {}) =>
  ({ id, fio: `Человек ${id}`, type: 'join_group', status: 'Новая', manual_street: null, address, ...over });
const person = (id: number, address: string | null) => ({ id, full_name: `Участник ${id}`, address });

const input = {
  groups: [group(1, 'ул. Рылеева, 32'), group(2, 'ул. Закрытая, 1', 'Закрыта')],
  requests: [request(10, 'ул. Рылеева, 32'), request(11, 'Колизей'), request(12, null)],
  participants: [person(5, 'пр. Мира, 5')],
};

describe('таблица адресов геокодера', () => {
  test('каждый адрес один раз, у него все карточки, где он записан, и состояние; сверху те, что требуют внимания', () => {
    const cache = new Map<string, GeocodeEntry>([
      [addressKey('ул. Рылеева, 32')!, { lat: 59.94, lon: 30.35, accuracy: 'street' }],
      [addressKey('Колизей')!, null],
    ]);
    const t = buildAddressTable(input, cache, new Date('2026-10-13T10:00:00Z'));
    expect(t.items.map((i) => [i.address, i.state])).toEqual([['Колизей', 'missing'], ['пр. Мира, 5', 'waiting'], ['ул. Рылеева, 32', 'found']]);
    const ryleeva = t.items.find((i) => i.state === 'found')!;
    expect(ryleeva).toMatchObject({ lat: 59.94, lon: 30.35, accuracy: 'street' });
    expect(ryleeva.sources).toEqual([
      { kind: 'group', id: '1', label: 'Группа №1, Ольга' },
      { kind: 'request', id: '10', label: 'Заявка №10, Человек 10' },
    ]);
    expect(t.items[1]!.sources).toEqual([{ kind: 'person', id: 'u5', label: 'Участник 5' }]);
    // Закрытая группа и заявка без адреса в таблицу не попадают.
    expect(t.items.some((i) => i.address.includes('Закрытая'))).toBe(false);
  });
});

describe('повтор по одному адресу', () => {
  const memory = (used = 0) => {
    const rows = new Map<string, GeocodeEntry>();
    const store: GeocodeStore & { rows: typeof rows } = { rows, all: async () => new Map(rows), save: async (k, p) => { rows.set(k, p); }, countSince: async () => used };
    return store;
  };
  const found: Geocoder = { geocode: async () => ({ kind: 'found', point: { lat: 1, lon: 2, accuracy: 'area' } }) };
  const make = (over: Partial<Parameters<typeof createAddressRetry>[0]> = {}) => {
    const store = memory();
    let invalidated = 0;
    const retry = createAddressRetry({ load: async () => input, store, currentKey: async () => 'KEY', geocoderFor: () => found, invalidate: () => { invalidated += 1; }, ...over });
    return { retry, store, invalidated: () => invalidated };
  };

  test('одним запросом записывает ответ в кэш и сбрасывает снимок, чтобы подбор увидел новые координаты', async () => {
    const { retry, store, invalidated } = make();
    expect(await retry({ address: 'Колизей' })).toEqual({ ok: true });
    expect(store.rows.get(addressKey('Колизей')!)).toEqual({ lat: 1, lon: 2, accuracy: 'area' });
    expect(invalidated()).toBe(1);
  });

  test('«не нашёлся» тоже записывается: Яндекс ответил, повторно спрашивать то же не надо', async () => {
    const { retry, store } = make({ geocoderFor: () => ({ geocode: async () => ({ kind: 'missing' }) }) });
    expect(await retry({ address: 'Колизей' })).toEqual({ ok: true });
    expect(store.rows.get(addressKey('Колизей')!)).toBeNull();
  });

  test('чужой текст не принимается: лимит запросов нельзя тратить на что попало', async () => {
    const { retry, store } = make();
    expect(await retry({ address: 'Какой-то левый адрес' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await retry({})).toMatchObject({ ok: false, error: 'bad_request' });
    expect(store.rows.size).toBe(0);
  });

  test('нет ключа, исчерпан суточный лимит или сбой Яндекса — понятная ошибка и ничего не записано', async () => {
    const noKey = make({ currentKey: async () => null });
    expect(await noKey.retry({ address: 'Колизей' })).toMatchObject({ ok: false, error: 'unavailable' });
    const spent = make({ store: memory(900) });
    expect(await spent.retry({ address: 'Колизей' })).toMatchObject({ ok: false, error: 'unavailable', message: expect.stringContaining('лимит') });
    const broken = make({ geocoderFor: () => ({ geocode: async () => ({ kind: 'failed', message: 'Геокодер ответил 403' }) }) });
    expect(await broken.retry({ address: 'Колизей' })).toMatchObject({ ok: false, message: expect.stringContaining('403') });
    expect(broken.store.rows.size).toBe(0);
  });
});
