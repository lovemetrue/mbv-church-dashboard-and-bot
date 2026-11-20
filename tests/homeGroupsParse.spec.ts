import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { AGE_GROUPS } from '../src/core/texts.js';
import {
  AGE_COLUMNS,
  AGE_COLUMN_RANGES,
  ageColumnOf,
  ageColumnsOverlapping,
  formatWhen,
  groupAgeCategories,
  parseAgeRange,
  parseGroupAgeRanges,
  parseGroupWhen,
} from '../src/home-groups/plan/parse.js';

interface Table {
  groups: { day: string | null; time: string | null; age: string | null }[];
  requests: { age: string | null }[];
}
const table = JSON.parse(readFileSync(new URL('../dashboard/data.json', import.meta.url), 'utf8')) as Table;

describe('parseAgeRange', () => {
  test('пусто, «любой» и мусор означают «возраст неизвестен», а не «любой возраст в числах»', () => {
    for (const raw of [null, undefined, '', '   ', 'любой', 'Любой', '?', '???']) {
      expect(parseAgeRange(raw), String(raw)).toBeNull();
    }
  });

  test('понимает диапазоны, «65+», подростков и одиночные числа из заявок', () => {
    expect(parseAgeRange('35-45 лет')).toEqual([35, 45]);
    expect(parseAgeRange('25–35')).toEqual([25, 35]);
    expect(parseAgeRange('65+')).toEqual([65, 120]);
    expect(parseAgeRange('подростки (до 18 лет)')).toEqual([12, 17]);
    expect(parseAgeRange('37 лет')).toEqual([37, 37]);
    expect(parseAgeRange('40.0')).toEqual([40, 40]);
  });

  test('каждое значение возраста из реальной таблицы разбирается без исключений в диапазон или null', () => {
    const raws = new Set([...table.groups.map((g) => g.age), ...table.requests.map((r) => r.age)]);
    expect(raws.size).toBeGreaterThan(10);
    for (const raw of raws) {
      const range = parseAgeRange(raw);
      if (range) expect(range[0], String(raw)).toBeLessThanOrEqual(range[1]);
    }
  });
});

describe('parseGroupWhen: день', () => {
  test('один день недели из таблицы переводится в сокращение', () => {
    expect(parseGroupWhen('Четверг', null).days).toEqual(['Чт']);
    expect(parseGroupWhen('Пятница', null).days).toEqual(['Пт']);
    expect(parseGroupWhen('вторник', null).days).toEqual(['Вт']);
    expect(parseGroupWhen('Воскресенье', null).days).toEqual(['Вс']);
    expect(parseGroupWhen('Понедельник', null).days).toEqual(['Пн']);
    expect(parseGroupWhen('Среда', null).days).toEqual(['Ср']);
    expect(parseGroupWhen('Суббота', null).days).toEqual(['Сб']);
  });

  test('несколько дней в одной ячейке — все эти дни, в порядке недели', () => {
    expect(parseGroupWhen('Среда, Четверг', '19:00')).toEqual({ days: ['Ср', 'Чт'], slot: 'вечер' });
    expect(parseGroupWhen('Чт, Вт', null).days).toEqual(['Вт', 'Чт']);
  });

  test('каноничная запись формы «Вт, Чт» читается как два дня', () => {
    expect(parseGroupWhen('Вт, Чт', '19:00')).toEqual({ days: ['Вт', 'Чт'], slot: 'вечер' });
  });

  test('«Плавающий», пусто и строка None — дня нет', () => {
    expect(parseGroupWhen('Плавающий', '19:00').days).toEqual([]);
    expect(parseGroupWhen('', null).days).toEqual([]);
    expect(parseGroupWhen(null, null).days).toEqual([]);
    expect(parseGroupWhen('None', 'None')).toEqual({ days: [], slot: null });
  });

  test('одинаковый день, названный дважды, остаётся днём', () => {
    expect(parseGroupWhen('Четверг, четверг', null).days).toEqual(['Чт']);
  });
});

describe('parseGroupWhen: время суток', () => {
  test('граница: до 12:00 утро, 12:00–16:59 день, с 17:00 вечер', () => {
    expect(parseGroupWhen(null, '09:00').slot).toBe('утро');
    expect(parseGroupWhen(null, '11:59').slot).toBe('утро');
    expect(parseGroupWhen(null, '12:00').slot).toBe('день');
    expect(parseGroupWhen(null, '16:59').slot).toBe('день');
    expect(parseGroupWhen(null, '17:00').slot).toBe('вечер');
    expect(parseGroupWhen(null, '19:00').slot).toBe('вечер');
    expect(parseGroupWhen(null, '20:30').slot).toBe('вечер');
  });

  test('слова «Утро», «День», «Вечер» принимаются в любом регистре', () => {
    expect(parseGroupWhen(null, 'Утро').slot).toBe('утро');
    expect(parseGroupWhen(null, 'День').slot).toBe('день');
    expect(parseGroupWhen(null, 'вечер').slot).toBe('вечер');
  });

  test('пусто, None и нераспознанное — slot = null', () => {
    expect(parseGroupWhen(null, '').slot).toBeNull();
    expect(parseGroupWhen(null, 'None').slot).toBeNull();
    expect(parseGroupWhen(null, 'по договорённости').slot).toBeNull();
    expect(parseGroupWhen(null, '25:99').slot).toBeNull();
  });

  test('разделитель времени может быть точкой', () => {
    expect(parseGroupWhen(null, '19.30').slot).toBe('вечер');
  });

  test('все дни и все времена из реальной таблицы разбираются без исключений', () => {
    const pairs = new Set(table.groups.map((g) => `${g.day}|${g.time}`));
    expect(pairs.size).toBeGreaterThan(10);
    for (const pair of pairs) {
      const [day, time] = pair.split('|') as [string, string];
      const parsed = parseGroupWhen(day === 'null' ? null : day, time === 'null' ? null : time);
      expect(parsed).toHaveProperty('days');
      expect(parsed).toHaveProperty('slot');
    }
  });

  test('реальные строки таблицы церкви: «Четверг» + «19:00», «Плавающий» + «День», «Пятница» + «12:00»', () => {
    expect(parseGroupWhen('Четверг', '19:00')).toEqual({ days: ['Чт'], slot: 'вечер' });
    expect(parseGroupWhen('Плавающий', 'День')).toEqual({ days: [], slot: 'день' });
    expect(parseGroupWhen('Пятница', '12:00')).toEqual({ days: ['Пт'], slot: 'день' });
    expect(parseGroupWhen('Четверг', 'Вечер')).toEqual({ days: ['Чт'], slot: 'вечер' });
  });
});

describe('реальные значения из таблицы церкви (dashboard/data.json)', () => {
  // Список снят с выгрузки: так записан день, время и возраст у групп и заявок. Если в таблице
  // появится новая запись, которой нет здесь, общие проверки выше всё равно прогонят её через разбор.
  test('значения колонки «день»', () => {
    const expected: [string, string[]][] = [
      ['Четверг', ['Чт']], ['Пятница', ['Пт']], ['Вторник', ['Вт']], ['Суббота', ['Сб']], ['Воскресенье', ['Вс']],
      ['Понедельник', ['Пн']], ['Среда', ['Ср']], ['Плавающий', []], ['Среда, Четверг', ['Ср', 'Чт']], ['', []],
    ];
    for (const [raw, days] of expected) expect(parseGroupWhen(raw, null).days, raw).toEqual(days);
  });

  test('значения колонки «время»', () => {
    const expected: [string | null, string | null][] = [
      ['19:00', 'вечер'], ['18:30', 'вечер'], ['15:00', 'день'], ['14:00', 'день'], ['20:00', 'вечер'],
      ['18:00', 'вечер'], ['13:00', 'день'], ['12:00', 'день'], ['16:00', 'день'], ['День', 'день'],
      ['11:00', 'утро'], ['17:00', 'вечер'], ['16:30', 'день'], ['19:30', 'вечер'], ['20:30', 'вечер'],
      ['Вечер', 'вечер'], ['09:00', 'утро'], ['17:30', 'вечер'], [null, null], ['None', null],
    ];
    for (const [raw, slot] of expected) expect(parseGroupWhen(null, raw).slot, String(raw)).toBe(slot);
  });

  test('значения возраста групп', () => {
    const expected: [string, [number, number] | null][] = [
      ['35-50', [35, 50]], ['25-35', [25, 35]], ['65+', [65, 120]], ['25-40', [25, 40]], ['', null],
      ['50-60', [50, 60]], ['16-25', [16, 25]], ['любой', null], ['Любой', null], ['18-25', [18, 25]],
      ['35-45 лет', [35, 45]], ['35-45', [35, 45]],
    ];
    for (const [raw, range] of expected) expect(parseAgeRange(raw), raw).toEqual(range);
  });

  test('значения возраста заявок, включая числа с «.0» и мусор', () => {
    const expected: [string, [number, number] | null][] = [
      ['35-45 лет', [35, 45]], ['45-55 лет', [45, 55]], ['25-35 лет', [25, 35]], ['18-25 лет', [18, 25]],
      ['55-65 лет', [55, 65]], ['16-18 лет', [16, 18]], ['40.0', [40, 40]], ['37 лет', [37, 37]],
      ['20+', [20, 120]], ['40+', [40, 120]], ['35+', [35, 120]], ['30-35', [30, 35]], ['?', null],
      ['???', null], ['55', [55, 55]], ['20 лет', [20, 20]],
    ];
    for (const [raw, range] of expected) expect(parseAgeRange(raw), raw).toEqual(range);
  });
});

describe('formatWhen', () => {
  test('собирает «дни — время суток», а при пропуске показывает то, что есть', () => {
    expect(formatWhen(['Вт'], 'вечер')).toBe('Вт — вечер');
    expect(formatWhen(['Вт'], null)).toBe('Вт');
    expect(formatWhen([], 'вечер')).toBe('вечер');
    expect(formatWhen([], null)).toBeNull();
  });

  test('записанное время показывается как записано: «Вт, Чт — 19:00», а не «вечер»', () => {
    expect(formatWhen(['Вт', 'Чт'], 'вечер', '19:00')).toBe('Вт, Чт — 19:00');
    expect(formatWhen(['Ср'], 'вечер', '19.30')).toBe('Ср — 19:30');
    expect(formatWhen(['Ср'], 'вечер', ' 9:00 ')).toBe('Ср — 09:00');
    expect(formatWhen([], 'вечер', '18:30')).toBe('18:30');
  });

  test('время словом или неразборчивое показывается временем суток', () => {
    expect(formatWhen(['Пт'], 'вечер', 'Вечер')).toBe('Пт — вечер');
    expect(formatWhen(['Пт'], 'вечер', 'после работы вечером')).toBe('Пт — вечер');
    expect(formatWhen(['Пт'], null, 'None')).toBe('Пт');
  });
});

describe('категории возраста группы', () => {
  test('каноничная запись формы — набор категорий анкеты в их порядке', () => {
    expect(groupAgeCategories('40-55, 25-40')).toEqual(['25-40', '40-55']);
    expect(groupAgeCategories('подростки (до 18 лет), 65+')).toEqual(['подростки (до 18 лет)', '65+']);
    expect(groupAgeCategories('18-25')).toEqual(['18-25']);
  });

  test('старый диапазон из таблицы — все категории, которые он задевает: «35-50» → «25-40» и «40-55»', () => {
    expect(groupAgeCategories('35-50')).toEqual(['25-40', '40-55']);
    expect(groupAgeCategories('50-60')).toEqual(['40-55', '55-65']);
    expect(groupAgeCategories('16-25')).toEqual(['подростки (до 18 лет)', '18-25']);
    expect(groupAgeCategories('25-35')).toEqual(['25-40']);
    expect(groupAgeCategories('35-45 лет')).toEqual(['25-40', '40-55']);
    expect(groupAgeCategories('65+')).toEqual(['65+']);
  });

  test('касание в одной цифре категорией не считается: «40-55» — только «40-55»', () => {
    expect(groupAgeCategories('40-55')).toEqual(['40-55']);
    expect(groupAgeCategories('25-40')).toEqual(['25-40']);
  });

  test('«любой», пусто и мусор — категорий нет (возраст группы неизвестен)', () => {
    for (const raw of [null, '', 'любой', 'Любой', '???']) expect(groupAgeCategories(raw), String(raw)).toEqual([]);
  });

  test('диапазоны для подбора: у каждой категории свой, а неизвестный возраст — пустой список', () => {
    expect(parseGroupAgeRanges('25-40, 55-65')).toEqual([[25, 40], [55, 65]]);
    expect(parseGroupAgeRanges('35-50')).toEqual([[25, 40], [40, 55]]);
    expect(parseGroupAgeRanges('любой')).toEqual([]);
    expect(parseGroupAgeRanges(null)).toEqual([]);
  });

  test('каждое значение возраста групп из реальной таблицы раскладывается в категории без исключений', () => {
    for (const g of table.groups) for (const c of groupAgeCategories(g.age)) expect(AGE_GROUPS, String(g.age)).toContain(c);
  });
});

describe('колонки возраста', () => {
  test('колонки — те же возрастные категории, что и в кампании, в порядке возрастания и без дыр', () => {
    expect([...AGE_COLUMNS]).toEqual(['до 18', '18–25', '25–40', '40–55', '55–65', '65+']);
    expect(AGE_COLUMN_RANGES).toHaveLength(AGE_COLUMNS.length);
    for (let i = 1; i < AGE_COLUMN_RANGES.length; i++) {
      expect(AGE_COLUMN_RANGES[i]![0]).toBe(AGE_COLUMN_RANGES[i - 1]![1] + 1);
    }
  });

  test('каждая категория анкеты бота попадает в свою колонку', () => {
    // Иначе спрос от ответов бота окажется не в той колонке, что подписана так же.
    const expected = ['до 18', '18–25', '25–40', '40–55', '55–65', '65+'];
    AGE_GROUPS.forEach((label, i) => expect(ageColumnOf(parseAgeRange(label)), label).toBe(expected[i]));
  });

  test('колонка определяется по середине диапазона', () => {
    expect(ageColumnOf([12, 17])).toBe('до 18');
    expect(ageColumnOf([18, 25])).toBe('18–25');
    expect(ageColumnOf([25, 40])).toBe('25–40');
    expect(ageColumnOf([35, 45])).toBe('25–40');
    expect(ageColumnOf([40, 55])).toBe('40–55');
    expect(ageColumnOf([55, 65])).toBe('55–65');
    expect(ageColumnOf([65, 120])).toBe('65+');
    expect(ageColumnOf([47, 47])).toBe('40–55');
  });

  test('возраст ровно на границе относится к нижней колонке', () => {
    expect(ageColumnOf([25, 25])).toBe('18–25');
    expect(ageColumnOf([26, 26])).toBe('25–40');
    expect(ageColumnOf([40, 40])).toBe('25–40');
    expect(ageColumnOf([41, 41])).toBe('40–55');
    expect(ageColumnOf([65, 65])).toBe('55–65');
    expect(ageColumnOf([66, 66])).toBe('65+');
    // [17, 34]: середина 25,5 — ещё «18–25»; иначе человек перескакивал бы колонку из-за округления.
    expect(ageColumnOf([17, 34])).toBe('18–25');
  });

  test('неизвестный возраст не попадает ни в одну колонку', () => {
    expect(ageColumnOf(null)).toBeNull();
  });

  test('диапазон группы пересекает все колонки, которые он задевает; неизвестный — все', () => {
    expect(ageColumnsOverlapping([35, 50])).toEqual(['25–40', '40–55']);
    expect(ageColumnsOverlapping([16, 25])).toEqual(['до 18', '18–25']);
    expect(ageColumnsOverlapping([65, 120])).toEqual(['65+']);
    expect(ageColumnsOverlapping(null)).toEqual([...AGE_COLUMNS]);
  });

  test('группа, подписанная границами категории, не заходит в соседнюю колонку', () => {
    // «40-55» в таблице церкви — это колонка «40–55»; общая цифра 40 не должна давать места ещё и в «25–40».
    AGE_GROUPS.forEach((label, i) => {
      expect(ageColumnsOverlapping(parseAgeRange(label)), label).toEqual([AGE_COLUMNS[i]]);
    });
  });

  test('группа на одну цифру (например «40») относится к одной колонке', () => {
    expect(ageColumnsOverlapping([40, 40])).toEqual(['25–40']);
    expect(ageColumnsOverlapping([41, 41])).toEqual(['40–55']);
  });
});
