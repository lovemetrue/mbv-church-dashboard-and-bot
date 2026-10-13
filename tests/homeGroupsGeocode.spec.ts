import { describe, expect, test } from 'vitest';
import { addressKey, cleanAddress, createYandexGeocoder, distanceMeters, geocodePending, type Geocoder, type GeocodeStore } from '../src/home-groups/geocode.js';
import { addressStats, addressesOf } from '../src/home-groups/geocodeJob.js';
import type { GeocodeEntry } from '../src/db/repos/geocode.repo.js';

const reply = (pos: string, kind: string, precision = 'exact', name = 'объект') => ({
  response: { GeoObjectCollection: { featureMember: [{ GeoObject: { name, Point: { pos }, metaDataProperty: { GeocoderMetaData: { kind, precision } } } }] } },
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

describe('текст, который нашёл Яндекс', () => {
  test('полный адрес из ответа сохраняется в точке: по нему видно, что принято за адрес', async () => {
    const body = { response: { GeoObjectCollection: { featureMember: [{ GeoObject: { name: 'улица Средняя', Point: { pos: '30.3 59.9' }, metaDataProperty: { GeocoderMetaData: { kind: 'street', precision: 'other', text: 'Россия, Санкт-Петербург, улица Средняя' } } } }] } } };
    const r = await createYandexGeocoder('K', fakeFetch(200, body)).geocode('среда');
    expect(r).toMatchObject({ kind: 'found', point: { matched: 'Россия, Санкт-Петербург, улица Средняя' } });
  });
});

describe('очистка адреса', () => {
  test('смайлики, «)))» и знаки на краях уходят, а нужные адресу знаки остаются', () => {
    expect(cleanAddress('Гражданский проспект)))')).toBe('Гражданский проспект');
    expect(cleanAddress('😊 ул. Рылеева, 32 ✨')).toBe('ул. Рылеева, 32');
    expect(cleanAddress(' ,пр. Мира, д. 5/2, кв. 3. ')).toBe('пр. Мира, д. 5/2, кв. 3');
    expect(cleanAddress('Суворовский пр/9-ая Советская')).toBe('Суворовский пр/9-ая Советская');
    expect(cleanAddress('Школьная (рядом с метро «Чёрная речка»)')).toBe('Школьная рядом с метро «Чёрная речка»');
  });

  test('один и тот же адрес с разным «мусором» — один ключ кэша и один запрос', () => {
    expect(addressKey('Гражданский проспект)))')).toBe(addressKey('гражданский  проспект 😊'));
    expect(addressKey('😊')).toBeNull();
  });
});

describe('Яндекс.Геокодер', () => {
  test('«долгота широта» разбирается в правильном порядке, к очищенному адресу достраивается город', async () => {
    let asked = '';
    const geocoder = createYandexGeocoder('KEY', (async (url: URL) => { asked = String(url); return new Response(JSON.stringify(reply('30.30 59.93', 'house'))); }) as unknown as typeof fetch);
    expect(await geocoder.geocode('ул. Рылеева, 32 😊)))')).toEqual({ kind: 'found', point: { lat: 59.93, lon: 30.3, accuracy: 'house', matched: 'объект' } });
    expect(decodeURIComponent(asked.replaceAll('+', ' '))).toContain('geocode=Санкт-Петербург, ул. Рылеева, 32&');
    expect(asked).toContain('apikey=KEY');
  });

  test('только улица без дома — середина улицы, только посёлок или район — их центр: точность запоминается', async () => {
    const at = async (kind: string, precision = 'street', name = 'Юкки') => (await createYandexGeocoder('K', fakeFetch(200, reply('30 59', kind, precision, name))).geocode('адрес'));
    expect(await at('street', 'street', 'улица Рылеева')).toMatchObject({ kind: 'found', point: { accuracy: 'street' } });
    expect(await at('locality', 'other', 'Юкки')).toMatchObject({ kind: 'found', point: { accuracy: 'area' } });
    expect(await at('district', 'other', 'Приморский район')).toMatchObject({ kind: 'found', point: { accuracy: 'area' } });
    expect(await at('house', 'near', 'Рылеева 32')).toMatchObject({ kind: 'found', point: { accuracy: 'house' } });
    expect(await at('metro', 'other', 'метро Беговая')).toMatchObject({ kind: 'found', point: { accuracy: 'house' } });
  });

  test('слишком крупное — страна, область, район области, весь Петербург — и неточный дом не годятся: «не найден»', async () => {
    const at = async (kind: string, precision: string, name: string) => (await createYandexGeocoder('K', fakeFetch(200, reply('30 59', kind, precision, name))).geocode('адрес'));
    expect(await at('locality', 'other', 'Санкт-Петербург')).toEqual({ kind: 'missing' });
    expect(await at('province', 'other', 'Ленинградская область')).toEqual({ kind: 'missing' });
    expect(await at('area', 'other', 'Тосненский район')).toEqual({ kind: 'missing' });
    expect(await at('country', 'other', 'Россия')).toEqual({ kind: 'missing' });
    expect(await at('house', 'other', 'какой-то дом')).toEqual({ kind: 'missing' });
  });

  test('если с «Санкт-Петербург,» ничего подходящего нет, повторяет запрос как написано; из трёх ответов берёт первый подходящий', async () => {
    const queries: string[] = [];
    const responses = [
      { response: { GeoObjectCollection: { featureMember: [] } } },
      { response: { GeoObjectCollection: { featureMember: [
        { GeoObject: { name: 'Ленинградская область', Point: { pos: '30 60' }, metaDataProperty: { GeocoderMetaData: { kind: 'province', precision: 'other' } } } },
        { GeoObject: { name: 'Колотай 5/1', Point: { pos: '30.5 60.1' }, metaDataProperty: { GeocoderMetaData: { kind: 'house', precision: 'exact' } } } },
      ] } } },
    ];
    const geocoder = createYandexGeocoder('K', (async (url: URL) => { queries.push(decodeURIComponent(String(url).replaceAll('+', ' '))); return new Response(JSON.stringify(responses.shift())); }) as unknown as typeof fetch);
    expect(await geocoder.geocode('Колотай 5/1')).toEqual({ kind: 'found', point: { lat: 60.1, lon: 30.5, accuracy: 'house', matched: 'Колотай 5/1' } });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('geocode=Санкт-Петербург, Колотай 5/1&');
    expect(queries[1]).toContain('geocode=Колотай 5/1&');
  });

  test('адрес уже с городом спрашивается один раз; сбой на первом запросе повтор не запускает', async () => {
    let calls = 0;
    const once = createYandexGeocoder('K', (async () => { calls += 1; return new Response(JSON.stringify({ response: { GeoObjectCollection: { featureMember: [] } } })); }) as unknown as typeof fetch);
    expect(await once.geocode('г. Колпино, Тверская 1')).toEqual({ kind: 'missing' });
    expect(calls).toBe(1);
    calls = 0;
    const broken = createYandexGeocoder('K', (async () => { calls += 1; return new Response('{}', { status: 429 }); }) as unknown as typeof fetch);
    expect((await broken.geocode('Рылеева 1')).kind).toBe('failed');
    expect(calls).toBe(1);
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
  const found: Geocoder = { geocode: async () => ({ kind: 'found', point: { lat: 1, lon: 2, accuracy: 'house' } }) };

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

  test('геокодируются группы всех статусов, кроме «Закрыта», и все люди с адресом', () => {
    const g = (status: string, address: string | null) => ({ status, address });
    const groups = [g('Функционирует', 'ул. Живая, 1'), g('На паузе', 'ул. Пауза, 2'), g('Потенциальная', 'ул. Потенциал, 3'), g('Закрыта', 'ул. Закрытая, 4'), g('Недвижимость', 'ул. Дом, 5'), g('Кампания', 'ул. Кампания, 10'), g('Функционирует', null)] as never;
    const r = (type: string, status: string, address: string) => ({ type, status, manual_street: null, address });
    const requests = [r('lead_group', 'Новая', 'ул. Хозяйская, 6'), r('join_group', 'Исполнена', 'ул. Исполненная, 7'), r('join_group', 'Новая', 'ул. Открытая, 8')] as never;
    const participants = [{ address: 'ул. Анкетная, 9' }, { address: null }];
    // Порядок: группы, открытые заявки «в группу», остальные заявки, регистрации.
    expect(addressesOf({ groups, requests, participants })).toEqual([
      'ул. Живая, 1', 'ул. Пауза, 2', 'ул. Потенциал, 3', 'ул. Дом, 5', 'ул. Кампания, 10', 'ул. Открытая, 8', 'ул. Хозяйская, 6', 'ул. Исполненная, 7', 'ул. Анкетная, 9',
    ]);
  });

  test('сводка по адресам: найдены, не нашлись и ждут; одинаковые адреса считаются один раз', () => {
    const cache = new Map<string, { lat: number; lon: number } | null>([
      [addressKey('ул. Раз, 1')!, { lat: 1, lon: 2 }],
      [addressKey('ул. Два, 2')!, null],
    ]);
    const r = addressStats(['ул. Раз, 1', 'УЛ Раз 1', 'ул. Два, 2', 'ул. Три, 3'], cache);
    expect(r).toEqual({ addresses: { total: 3, found: 1, missing: 1, waiting: 1 } });
  });

  test('адреса берутся у групп и из заявок; правка координатора важнее анкеты', () => {
    const groups = [{ address: 'ул. Группы, 1', status: 'Функционирует' }, { address: null, status: 'Функционирует' }] as never;
    const open = { type: 'join_group', status: 'Новая' };
    const requests = [{ ...open, manual_street: 'ул. Правка, 2', address: 'ул. Анкета, 3' }, { ...open, manual_street: null, address: 'ул. Анкета, 4' }, { ...open, manual_street: null, address: null }] as never;
    expect(addressesOf({ groups, requests })).toEqual(['ул. Группы, 1', 'ул. Правка, 2', 'ул. Анкета, 4']);
  });
});
