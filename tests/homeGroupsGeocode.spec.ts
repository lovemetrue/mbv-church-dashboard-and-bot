import { describe, expect, test } from 'vitest';
import { addressKey, createYandexGeocoder, distanceMeters, geocodePending, type Geocoder, type GeocodeStore } from '../src/home-groups/geocode.js';
import { addressStats, addressesOf } from '../src/home-groups/geocodeJob.js';
import type { GeocodeEntry } from '../src/db/repos/geocode.repo.js';

const reply = (pos: string, precision: string) => ({
  response: { GeoObjectCollection: { featureMember: [{ GeoObject: { Point: { pos }, metaDataProperty: { GeocoderMetaData: { precision } } } }] } },
});
const fakeFetch = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('ключ адреса', () => {
  test('регистр, знаки препинания и пробелы не плодят разные адреса', () => {
    expect(addressKey('ул. Рылеева, д. 32')).toBe(addressKey('УЛ  Рылеева д 32'));
    expect(addressKey('  ')).toBeNull();
    expect(addressKey(null)).toBeNull();
  });
});

describe('расстояние', () => {
  test('Невский пр. — Лиговский пр. по прямой около километра', () => {
    const m = distanceMeters({ lat: 59.9343, lon: 30.3351 }, { lat: 59.9311, lon: 30.3609 });
    expect(m).toBeGreaterThan(1300);
    expect(m).toBeLessThan(1700);
  });
});

describe('Яндекс.Геокодер', () => {
  test('«долгота широта» разбирается в правильном порядке, к адресу достраивается город', async () => {
    let asked = '';
    const geocoder = createYandexGeocoder('KEY', (async (url: URL) => { asked = String(url); return new Response(JSON.stringify(reply('30.30 59.93', 'exact'))); }) as unknown as typeof fetch);
    expect(await geocoder.geocode('ул. Рылеева, 32')).toEqual({ kind: 'found', point: { lat: 59.93, lon: 30.3 }, precision: 'exact' });
    expect(decodeURIComponent(asked.replaceAll('+', ' '))).toContain('geocode=Санкт-Петербург, ул. Рылеева, 32');
    expect(asked).toContain('apikey=KEY');
  });

  test('середина улицы и центр города (street, other) для расстояния не годятся — адрес «не найден»', async () => {
    for (const precision of ['street', 'other']) {
      expect(await createYandexGeocoder('K', fakeFetch(200, reply('30 59', precision))).geocode('Рылеева')).toEqual({ kind: 'missing' });
    }
  });

  test('лимит и неверный ключ (403/429) — это сбой, а не «не найден»: кэшировать нельзя', async () => {
    for (const status of [403, 429]) {
      expect((await createYandexGeocoder('K', fakeFetch(status, {})).geocode('Рылеева 1')).kind).toBe('failed');
    }
  });
});

describe('дозаполнение кэша', () => {
  let used = 0;
  const memory = (): GeocodeStore & { rows: Map<string, GeocodeEntry> } => {
    const rows = new Map<string, GeocodeEntry>();
    return { rows, all: async () => new Map(rows), save: async (k, p) => { rows.set(k, p); }, countSince: async () => used };
  };
  const found: Geocoder = { geocode: async () => ({ kind: 'found', point: { lat: 1, lon: 2 }, precision: 'exact' }) };

  test('спрашивает только то, чего нет в кэше, и один адрес один раз', async () => {
    const store = memory();
    store.rows.set(addressKey('ул. Рылеева, 32')!, { lat: 9, lon: 9 });
    const asked: string[] = [];
    const geocoder: Geocoder = { geocode: async (a) => { asked.push(a); return found.geocode(a); } };
    const r = await geocodePending(['ул. Рылеева, 32', 'Мира 5', 'мира  5'], store, geocoder, { pauseMs: 0, sleep: async () => {} });
    expect(asked).toEqual(['Мира 5']);
    expect(r).toEqual({ done: 1, failed: null });
  });

  test('«не найден» записывается (повторно не спрашиваем), сбой останавливает заход и ничего не записывает', async () => {
    const store = memory();
    const missing: Geocoder = { geocode: async () => ({ kind: 'missing' }) };
    await geocodePending(['Неизвестная 1'], store, missing, { sleep: async () => {} });
    expect(store.rows.get(addressKey('Неизвестная 1')!)).toBeNull();
    const broken: Geocoder = { geocode: async () => ({ kind: 'failed', message: 'лимит' }) };
    const r = await geocodePending(['Новая 2', 'Новая 3'], store, broken, { sleep: async () => {} });
    expect(r).toEqual({ done: 0, failed: 'лимит' });
    expect(store.rows.has(addressKey('Новая 2')!)).toBe(false);
  });

  test('суточный лимит: на остаток запрашивает не больше, а когда он кончился — ничего', async () => {
    const asked: string[] = [];
    const geocoder: Geocoder = { geocode: async (a) => { asked.push(a); return found.geocode(a); } };
    used = 898;
    await geocodePending(['Раз 1', 'Два 2', 'Три 3'], memory(), geocoder, { sleep: async () => {} });
    expect(asked).toHaveLength(2);
    used = 900;
    expect(await geocodePending(['Четыре 4'], memory(), geocoder, { sleep: async () => {} })).toEqual({ done: 0, failed: null });
    expect(asked).toHaveLength(2);
    used = 0;
  });

  test('геокодируются группы «Функционирует», «На паузе» и «Потенциальная» и все люди с адресом; закрытые и «недвижимость» — нет', () => {
    const g = (status: string, address: string | null) => ({ status, address });
    const groups = [g('Функционирует', 'ул. Живая, 1'), g('На паузе', 'ул. Пауза, 2'), g('Потенциальная', 'ул. Потенциал, 3'), g('Закрыта', 'ул. Закрытая, 4'), g('Недвижимость', 'ул. Дом, 5'), g('Функционирует', null)] as never;
    const r = (type: string, status: string, address: string) => ({ type, status, manual_street: null, address });
    const requests = [r('lead_group', 'Новая', 'ул. Хозяйская, 6'), r('join_group', 'Исполнена', 'ул. Исполненная, 7'), r('join_group', 'Новая', 'ул. Открытая, 8')] as never;
    const participants = [{ address: 'ул. Анкетная, 9' }, { address: null }];
    // Порядок: группы, открытые заявки «в группу», остальные заявки, регистрации.
    expect(addressesOf({ groups, requests, participants })).toEqual([
      'ул. Живая, 1', 'ул. Пауза, 2', 'ул. Потенциал, 3', 'ул. Открытая, 8', 'ул. Хозяйская, 6', 'ул. Исполненная, 7', 'ул. Анкетная, 9',
    ]);
  });

  test('сводка по адресам: найдены, не нашлись и ждут; одинаковые адреса считаются один раз, список не нашедшихся виден', () => {
    const cache = new Map<string, { lat: number; lon: number } | null>([
      [addressKey('ул. Раз, 1')!, { lat: 1, lon: 2 }],
      [addressKey('ул. Два, 2')!, null],
    ]);
    const r = addressStats(['ул. Раз, 1', 'УЛ Раз 1', 'ул. Два, 2', 'ул. Три, 3'], cache);
    expect(r).toEqual({ addresses: { total: 3, found: 1, missing: 1, waiting: 1 }, missingList: ['ул. Два, 2'] });
  });

  test('адреса берутся у групп и из заявок; правка координатора важнее анкеты', () => {
    const groups = [{ address: 'ул. Группы, 1', status: 'Функционирует' }, { address: null, status: 'Функционирует' }] as never;
    const open = { type: 'join_group', status: 'Новая' };
    const requests = [{ ...open, manual_street: 'ул. Правка, 2', address: 'ул. Анкета, 3' }, { ...open, manual_street: null, address: 'ул. Анкета, 4' }, { ...open, manual_street: null, address: null }] as never;
    expect(addressesOf({ groups, requests })).toEqual(['ул. Группы, 1', 'ул. Правка, 2', 'ул. Анкета, 4']);
  });
});
