import { describe, expect, test, vi } from 'vitest';
import { autoPlace, createLocator, placeOf, stationName, type Station } from '../src/home-groups/locate.js';
import type { Geocoder, GeocodeStore } from '../src/home-groups/geocode.js';

const PIONERSKAYA: Station = { name: 'метро Пионерская', lat: 60.0026, lon: 30.2967 };
const CHERNAYA: Station = { name: 'метро Чёрная речка', lat: 59.9855, lon: 30.3006 };
const HOME = { lat: 60.0, lon: 30.29, accuracy: 'house' as const, matched: 'Россия, Санкт-Петербург, Коломяжский проспект, 15' };

describe('район и метро по точке адреса', () => {
  test('ближайшая станция без слова «метро», район — тот, что назвал Яндекс', () => {
    expect(placeOf(HOME, [CHERNAYA, PIONERSKAYA], ['муниципальный округ Комендантский аэродром Санкт-Петербург', 'Приморский район Санкт-Петербург, Россия']))
      .toEqual({ district: 'Приморский', metro: 'Пионерская' });
  });

  test('станция дальше 2,5 км — не ориентир: метро пустое', () => {
    const far = { ...HOME, lat: 60.1 };
    expect(placeOf(far, [PIONERSKAYA], ['Приморский район']).metro).toBeNull();
  });

  test('посёлок найден только центром — метро не ставим, район остаётся', () => {
    expect(placeOf({ ...HOME, accuracy: 'area' }, [PIONERSKAYA], ['Приморский район'])).toEqual({ district: 'Приморский', metro: null });
  });

  test('Кировский район области — это область, а не Кировский район города', () => {
    const p = { ...HOME, matched: 'Россия, Ленинградская область, Кировский район, Шлиссельбург' };
    expect(placeOf(p, [], ['Кировский район Ленинградская область, Россия']).district).toBe('Ленинградская область');
  });

  test('Яндекс района не назвал — район по станции, как в подборе', () => {
    expect(placeOf(HOME, [PIONERSKAYA], []).district).toBe('Приморский');
  });

  test('«метро» и «станция метро» перед названием убираются', () => {
    expect(stationName('станция метро Площадь Восстания')).toBe('Площадь Восстания');
  });
});

const yandex = (objects: { name: string; description?: string; pos?: string }[]) => ({
  response: { GeoObjectCollection: { featureMember: objects.map((o) => ({ GeoObject: { name: o.name, description: o.description, Point: { pos: o.pos ?? '' } } })) } },
});

function locator(opts: { key?: string | null; used?: number; found?: boolean } = {}) {
  const saved: string[] = [];
  const store: Pick<GeocodeStore, 'save' | 'countSince'> = {
    save: async (k) => { saved.push(k); },
    countSince: async () => opts.used ?? 0,
  };
  const geocoder: Geocoder = { geocode: async () => (opts.found === false ? { kind: 'missing' as const } : { kind: 'found' as const, point: HOME }) };
  const fetchImpl = vi.fn(async (url: URL) => {
    const kind = url.searchParams.get('kind');
    const body = kind === 'metro'
      ? yandex([{ name: 'метро Пионерская', pos: `${PIONERSKAYA.lon} ${PIONERSKAYA.lat}` }])
      : yandex([{ name: 'Приморский район', description: 'Санкт-Петербург, Россия' }]);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const invalidate = vi.fn();
  const locate = createLocator({ currentKey: async () => (opts.key === undefined ? 'K' : opts.key), store, fetchImpl, geocoderFor: () => geocoder, invalidate });
  return { locate, saved, fetchImpl, invalidate };
}

describe('поиск при сохранении группы', () => {
  test('адрес → точка в кэш координат (метка сразу на карте), район и метро — ответом', async () => {
    const { locate, saved, invalidate } = locator();
    expect(await locate('Коломяжский пр. 15')).toEqual({ district: 'Приморский', metro: 'Пионерская' });
    expect(saved).toHaveLength(1);
    expect(invalidate).toHaveBeenCalled();
  });

  test('нет ключа, исчерпан суточный запас или адрес не найден — ничего не подставляем и к Яндексу лишний раз не ходим', async () => {
    const noKey = locator({ key: null });
    expect(await noKey.locate('Коломяжский пр. 15')).toBeNull();
    const spent = locator({ used: 900 });
    expect(await spent.locate('Коломяжский пр. 15')).toBeNull();
    const missing = locator({ found: false });
    expect(await missing.locate('нигде')).toBeNull();
    expect(missing.fetchImpl).not.toHaveBeenCalled();
  });

  test('онлайн-группе район по адресу не меняют, пустой адрес не ищут', async () => {
    const locate = vi.fn(async () => ({ district: 'Приморский', metro: 'Пионерская' }));
    expect(await autoPlace(locate, 'Коломяжский пр. 15', 'Онлайн')).toEqual({});
    expect(await autoPlace(locate, '  ', 'Приморский')).toEqual({});
    expect(locate).not.toHaveBeenCalled();
    expect(await autoPlace(locate, 'Коломяжский пр. 15', 'Невский')).toEqual({ district: 'Приморский', metro: 'Пионерская' });
  });
});
