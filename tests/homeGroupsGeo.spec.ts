import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DISTRICTS } from '../src/core/groups.js';
import {
  METRO_DISTRICT,
  NEIGHBORS,
  buildMetroIndex,
  normalizeStation,
  resolveDistrict,
} from '../src/home-groups/plan/geo.js';

interface Table {
  groups: { district: string; metro: string | null }[];
  requests: { place: string | null }[];
}
const table = JSON.parse(readFileSync(new URL('../dashboard/data.json', import.meta.url), 'utf8')) as Table;

describe('справочник соседних районов', () => {
  test('охватывает каждый район из DISTRICTS', () => {
    for (const district of DISTRICTS) expect(NEIGHBORS, district).toHaveProperty([district]);
  });

  test('симметричен: если А сосед Б, то Б сосед А', () => {
    for (const [district, list] of Object.entries(NEIGHBORS)) {
      for (const other of list) {
        expect(NEIGHBORS[other], `${district} ↔ ${other}`).toContain(district);
      }
    }
  });

  test('ссылается только на известные районы и не считает район соседом самого себя', () => {
    const known = new Set<string>(DISTRICTS);
    for (const [district, list] of Object.entries(NEIGHBORS)) {
      expect(list).not.toContain(district);
      for (const other of list) expect(known.has(other), `${district} → ${other}`).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test('соседство совпадает с картой для опорных пар', () => {
    expect(NEIGHBORS['Приморский']).toContain('Выборгский');
    expect(NEIGHBORS['Выборгский']).toContain('Калининский');
    expect(NEIGHBORS['Центральный']).toContain('Адмиралтейский');
    expect(NEIGHBORS['Приморский']).not.toContain('Невский');
  });

  test('у «Онлайн» и «Не указан» соседей нет: они не привязаны к карте', () => {
    expect(NEIGHBORS['Онлайн']).toEqual([]);
    expect(NEIGHBORS['Не указан'] ?? []).toEqual([]);
  });
});

describe('справочник метро', () => {
  test('каждая станция ведёт в существующий район', () => {
    const known = new Set<string>(DISTRICTS);
    expect(Object.keys(METRO_DISTRICT).length).toBeGreaterThan(60);
    for (const [station, district] of Object.entries(METRO_DISTRICT)) {
      expect(known.has(district), `${station} → ${district}`).toBe(true);
    }
  });

  test('станции церковных групп из таблицы спорят со справочником только там, где расхождение названо явно', () => {
    // Церковь относит группу к району ведущего, а не станции: «Автово, Ленинский проспект» у неё
    // Красносельский, хотя станции в Кировском. Для индекса это нужно (человек и ищет группу церкви),
    // но новое расхождение должно заметить человек, а не пройти молча.
    const known = new Set([
      'спортивная',
      'выборгская',
      'лесная',
      'площадь мужества',
      'ленинский проспект',
      'автово',
      'колпино',
    ]);
    const index = buildMetroIndex(table.groups.map((g) => ({ metro: g.metro, district: g.district })));
    expect(index.size).toBeGreaterThan(30);
    for (const [key, district] of index) {
      const staticDistrict = [...Object.entries(METRO_DISTRICT)].find(([name]) => normalizeStation(name) === key)?.[1];
      if (staticDistrict && staticDistrict !== district) {
        expect(known.has(key), `${key}: ${district} против ${staticDistrict}`).toBe(true);
      }
    }
  });
});

describe('normalizeStation', () => {
  test('убирает «м.», «метро», «ст.м.», регистр и ё', () => {
    expect(normalizeStation('м. Комендантский пр.')).toBe('комендантский пр');
    expect(normalizeStation('Метро Лесная')).toBe('лесная');
    expect(normalizeStation('Ст.м.Улица Дыбенко')).toBe('улица дыбенко');
    expect(normalizeStation('Звёздная')).toBe('звездная');
  });
});

describe('buildMetroIndex', () => {
  test('станция, встреченная у групп одного района, попадает в индекс', () => {
    const index = buildMetroIndex([
      { metro: 'Пионерская', district: 'Приморский' },
      { metro: 'Пионерская', district: 'Приморский' },
      { metro: 'Озерки', district: 'Выборгский' },
    ]);
    expect(index.get('пионерская')).toBe('Приморский');
    expect(index.get('озерки')).toBe('Выборгский');
  });

  test('станция, встреченная у групп разных районов, в индекс не попадает: непонятно, чему верить', () => {
    const index = buildMetroIndex([
      { metro: 'Девяткино, Гражданский проспект', district: 'Красногвардейский' },
      { metro: 'Девяткино', district: 'Ленинградская область' },
    ]);
    expect(index.has('девяткино')).toBe(false);
    expect(index.get('гражданский проспект')).toBe('Красногвардейский');
  });

  test('список станций через запятую разбирается на отдельные станции', () => {
    const index = buildMetroIndex([{ metro: 'Площадь Восстания, Пушкинская, Маяковская', district: 'Центральный' }]);
    expect([...index.keys()].sort()).toEqual(['маяковская', 'площадь восстания', 'пушкинская']);
  });

  test('группы без метро, «Онлайн» и «Не указан» в индекс не попадают: это не география города', () => {
    const index = buildMetroIndex([
      { metro: null, district: 'Приморский' },
      { metro: '', district: 'Приморский' },
      { metro: 'Санкт-Петербург', district: 'Онлайн' },
      { metro: 'Сербия', district: 'Онлайн' },
      { metro: 'Беговая', district: 'Не указан' },
    ]);
    expect(index.size).toBe(0);
  });
});

describe('resolveDistrict: район словами', () => {
  test('район, названный словами, определяется с любым окончанием', () => {
    expect(resolveDistrict('Приморский')).toBe('Приморский');
    expect(resolveDistrict('приморском районе')).toBe('Приморский');
    expect(resolveDistrict('Невский р')).toBe('Невский');
    expect(resolveDistrict('Адмиралтейский район')).toBe('Адмиралтейский');
    expect(resolveDistrict('центральный')).toBe('Центральный');
    expect(resolveDistrict('Красносельский')).toBe('Красносельский');
  });

  test('район выигрывает у станции, если назван в том же месте', () => {
    expect(resolveDistrict('Приморский р., Беговая')).toBe('Приморский');
    expect(resolveDistrict('Выборгский пл.Мужества')).toBe('Выборгский');
    expect(resolveDistrict('Красносельский, центральный')).toBe('Красносельский');
  });

  test('«Онлайн» и «Ленинградская область» тоже районы справочника', () => {
    expect(resolveDistrict('онлайн')).toBe('Онлайн');
    expect(resolveDistrict('Ленинградская область')).toBe('Ленинградская область');
  });
});

describe('resolveDistrict: станция из текста', () => {
  test('«где-то у Пионерской» и «м. Комендантский пр.» определяются как Приморский', () => {
    expect(resolveDistrict('где-то у Пионерской')).toBe('Приморский');
    expect(resolveDistrict('«где-то у Пионерской»')).toBe('Приморский');
    expect(resolveDistrict('м. Комендантский пр.')).toBe('Приморский');
    expect(resolveDistrict('Комендантский пр')).toBe('Приморский');
    expect(resolveDistrict('м.Дыбенко')).toBe('Невский');
    expect(resolveDistrict('Ст.м.Улица Дыбенко')).toBe('Невский');
  });

  test('«Проспект Просвещения» определяется, а опечатка «просвящения» — нет: ложный район хуже пустого', () => {
    expect(resolveDistrict('Проспект Просвещения')).toBe('Выборгский');
    expect(resolveDistrict('Просвещение')).toBe('Выборгский');
    expect(resolveDistrict('Проспект просвящения')).toBeNull();
  });

  test('станция с «Ё» и с цифрой в названии', () => {
    expect(resolveDistrict('Звездная, Купчино')).toBe('Московский');
    expect(resolveDistrict('Метро Технологический институт 1')).toBe('Адмиралтейский');
    expect(resolveDistrict('Станция метро Московская')).toBe('Московский');
  });

  test('«Пушкин» и «Пушкинская» не путаются: побеждает более длинное название станции', () => {
    expect(resolveDistrict('Пушкинская')).toBe('Центральный');
    expect(resolveDistrict('Пушкин')).toBe('Пушкинский');
  });

  test('самое длинное название станции побеждает при любом порядке записей в индексе', () => {
    const shortFirst = new Map([['пушкин', 'Пушкинский'], ['пушкинская', 'Центральный']]);
    const longFirst = new Map([['пушкинская', 'Центральный'], ['пушкин', 'Пушкинский']]);
    for (const index of [shortFirst, longFirst]) {
      expect(resolveDistrict('Пушкинская', index)).toBe('Центральный');
      expect(resolveDistrict('Пушкин', index)).toBe('Пушкинский');
    }
  });

  test('«Лесная» не уводит «Лесной» в чужой район и находится как станция', () => {
    expect(resolveDistrict('Метро Лесная')).toBe('Выборгский');
  });

  test('«Невский проспект» и «Площадь Александра Невского» — Центральный, а «Невский район» — Невский', () => {
    // matchesDistrict принимает «Невского» и «Невский проспект» за Невский район; без поправки
    // эти заявки уехали бы за Неву.
    expect(resolveDistrict('Невский проспект')).toBe('Центральный');
    expect(resolveDistrict('Невский пр.')).toBe('Центральный');
    expect(resolveDistrict('Площадь Александра Невского')).toBe('Центральный');
    expect(resolveDistrict('Невский р')).toBe('Невский');
    expect(resolveDistrict('Невский район')).toBe('Невский');
    expect(resolveDistrict('Невский, Дыбенко')).toBe('Невский');
  });

  test('станция, названная в тексте целиком, важнее похожей по основе: «Славянка» — не «Проспект Славы»', () => {
    expect(resolveDistrict('Славянка')).toBe('Пушкинский');
    expect(resolveDistrict('Проспект Славы')).toBe('Фрунзенский');
  });

  test('городские разговорные названия: «Петроградка», «Центр»', () => {
    expect(resolveDistrict('Петроградка')).toBe('Петроградский');
    expect(resolveDistrict('Центр, ближе к колизею')).toBe('Центральный');
  });

  test('посёлки Ленинградской области определяются без метро', () => {
    expect(resolveDistrict('Мурино Цветной город')).toBe('Ленинградская область');
    expect(resolveDistrict('г.Шлиссельбург')).toBe('Ленинградская область');
    expect(resolveDistrict('Кудрово')).toBe('Ленинградская область');
  });
});

describe('resolveDistrict: несколько мест в одном тексте', () => {
  test('берётся первое распознанное, остальное игнорируется', () => {
    expect(resolveDistrict('Беговая, Комендантский')).toBe('Приморский');
    expect(resolveDistrict('Выборгский, Калининский, Приморский')).toBe('Выборгский');
    expect(resolveDistrict('м.Дыбенко / м. Проспект Большевиков')).toBe('Невский');
    expect(resolveDistrict('Ладожская/Черная речка')).toBe('Красногвардейский');
  });

  test('нераспознанное в начале пропускается: берётся первое, которое распозналось', () => {
    expect(resolveDistrict('Ржевка, Окраинная 9д, метро ладожская')).toBe('Красногвардейский');
    expect(resolveDistrict('Север города , мистолово, Парнас')).toBe('Выборгский');
  });

  test('название в скобках считается отдельным местом', () => {
    expect(resolveDistrict('Кудрово (Дыбенко)')).toBe('Ленинградская область');
  });
});

describe('resolveDistrict: не распознано', () => {
  test('пусто, «Любой» и размытое — null', () => {
    for (const place of [null, '', '   ', 'Любой', 'не принципиально)', 'понедельний любая', 'Север города']) {
      expect(resolveDistrict(place), String(place)).toBeNull();
    }
  });
});

describe('resolveDistrict с индексом из групп', () => {
  test('индекс из реестра имеет приоритет над статическим справочником', () => {
    const index = buildMetroIndex([{ metro: 'Купчино', district: 'Пушкинский' }]);
    expect(resolveDistrict('Купчино')).toBe('Фрунзенский');
    expect(resolveDistrict('Купчино', index)).toBe('Пушкинский');
  });

  test('станция, которой нет в индексе, берётся из статического справочника', () => {
    const index = buildMetroIndex([{ metro: 'Купчино', district: 'Пушкинский' }]);
    expect(resolveDistrict('Пионерская', index)).toBe('Приморский');
  });

  test('станция, известная только индексу (посёлок), находится по тексту', () => {
    const index = buildMetroIndex([{ metro: 'Гореловская Слобода', district: 'Красносельский' }]);
    expect(resolveDistrict('где-то в Гореловская Слобода', index)).toBe('Красносельский');
  });
});

describe('resolveDistrict на реальных заявках из таблицы', () => {
  const index = buildMetroIndex(table.groups.map((g) => ({ metro: g.metro, district: g.district })));
  const places = [...new Set(table.requests.map((r) => r.place).filter((p): p is string => !!p))];

  test('не падает ни на одной строке и возвращает только известные районы', () => {
    const known = new Set<string>(DISTRICTS);
    expect(places.length).toBeGreaterThan(100);
    for (const place of places) {
      const district = resolveDistrict(place, index);
      if (district !== null) expect(known.has(district), `${place} → ${district}`).toBe(true);
    }
  });

  test('выборочно: реальные строки дают ожидаемые районы', () => {
    const expectations: [string, string | null][] = [
      ['м.Дыбенко / м. Проспект Большевиков', 'Невский'],
      ['Комендантский пр или Центр, возможна Петроградка', 'Приморский'],
      ['Удобен будет либо Московский район либо центр', 'Московский'],
      ['Станция метро Купчино', 'Фрунзенский'],
      ['Метро Девяткино, г. Мурино', 'Ленинградская область'],
      ['Красное село , Красносельский р.', 'Красносельский'],
      ['Ст.м Проспект Просвещения', 'Выборгский'],
      ['Проспект просвящения', null],
      ['Любой', null],
    ];
    for (const [place, expected] of expectations) expect(resolveDistrict(place, index), place).toBe(expected);
  });

  test('колонка «метро» групп в большинстве случаев даёт тот же район, что записала церковь', () => {
    const withMetro = table.groups.filter((g) => g.metro && g.district !== 'Онлайн' && g.district !== 'Не указан');
    const same = withMetro.filter((g) => resolveDistrict(g.metro) === g.district).length;
    expect(withMetro.length).toBeGreaterThan(80);
    // Расхождения — станции на границе районов, где церковь относит группу к району ведущего.
    expect(same / withMetro.length).toBeGreaterThan(0.85);
  });

  test('подавляющее большинство непустых мест распознаётся', () => {
    const recognized = places.filter((p) => resolveDistrict(p, index) !== null).length;
    expect(recognized / places.length).toBeGreaterThan(0.8);
  });
});
