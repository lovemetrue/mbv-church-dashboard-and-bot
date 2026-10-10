import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  AGE_COLUMNS,
  AGE_COLUMN_RANGES,
  ageColumnOf,
  ageColumnsOverlapping,
  formatWhen,
  parseAgeRange,
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
    expect(parseGroupWhen('Четверг', null).day).toBe('Чт');
    expect(parseGroupWhen('Пятница', null).day).toBe('Пт');
    expect(parseGroupWhen('вторник', null).day).toBe('Вт');
    expect(parseGroupWhen('Воскресенье', null).day).toBe('Вс');
    expect(parseGroupWhen('Понедельник', null).day).toBe('Пн');
    expect(parseGroupWhen('Среда', null).day).toBe('Ср');
    expect(parseGroupWhen('Суббота', null).day).toBe('Сб');
  });

  test('несколько дней в одной ячейке дают day = null: точный день неизвестен, а не «первый из двух»', () => {
    expect(parseGroupWhen('Среда, Четверг', '19:00')).toEqual({ day: null, slot: 'вечер' });
  });

  test('«Плавающий», пусто и строка None — дня нет', () => {
    expect(parseGroupWhen('Плавающий', '19:00').day).toBeNull();
    expect(parseGroupWhen('', null).day).toBeNull();
    expect(parseGroupWhen(null, null).day).toBeNull();
    expect(parseGroupWhen('None', 'None')).toEqual({ day: null, slot: null });
  });

  test('одинаковый день, названный дважды, остаётся днём', () => {
    expect(parseGroupWhen('Четверг, четверг', null).day).toBe('Чт');
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
      expect(parsed).toHaveProperty('day');
      expect(parsed).toHaveProperty('slot');
    }
  });

  test('реальные строки таблицы церкви: «Четверг» + «19:00», «Плавающий» + «День», «Пятница» + «12:00»', () => {
    expect(parseGroupWhen('Четверг', '19:00')).toEqual({ day: 'Чт', slot: 'вечер' });
    expect(parseGroupWhen('Плавающий', 'День')).toEqual({ day: null, slot: 'день' });
    expect(parseGroupWhen('Пятница', '12:00')).toEqual({ day: 'Пт', slot: 'день' });
    expect(parseGroupWhen('Четверг', 'Вечер')).toEqual({ day: 'Чт', slot: 'вечер' });
  });
});

describe('реальные значения из таблицы церкви (dashboard/data.json)', () => {
  // Список снят с выгрузки: так записан день, время и возраст у групп и заявок. Если в таблице
  // появится новая запись, которой нет здесь, общие проверки выше всё равно прогонят её через разбор.
  test('значения колонки «день»', () => {
    const expected: [string, string | null][] = [
      ['Четверг', 'Чт'], ['Пятница', 'Пт'], ['Вторник', 'Вт'], ['Суббота', 'Сб'], ['Воскресенье', 'Вс'],
      ['Понедельник', 'Пн'], ['Среда', 'Ср'], ['Плавающий', null], ['Среда, Четверг', null], ['', null],
    ];
    for (const [raw, day] of expected) expect(parseGroupWhen(raw, null).day, raw).toBe(day);
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
  test('собирает «день, время суток», а при пропуске показывает то, что есть', () => {
    expect(formatWhen('Вт', 'вечер')).toBe('Вт, вечер');
    expect(formatWhen('Вт', null)).toBe('Вт');
    expect(formatWhen(null, 'вечер')).toBe('вечер');
    expect(formatWhen(null, null)).toBeNull();
  });
});

describe('колонки возраста', () => {
  test('колонки заданы в порядке возрастания и покрывают всё без дыр', () => {
    expect([...AGE_COLUMNS]).toEqual(['до 18', '18–25', '26–35', '36–45', '46+']);
    expect(AGE_COLUMN_RANGES).toHaveLength(AGE_COLUMNS.length);
    for (let i = 1; i < AGE_COLUMN_RANGES.length; i++) {
      expect(AGE_COLUMN_RANGES[i]![0]).toBe(AGE_COLUMN_RANGES[i - 1]![1] + 1);
    }
  });

  test('колонка определяется по середине диапазона', () => {
    expect(ageColumnOf([12, 17])).toBe('до 18');
    expect(ageColumnOf([18, 25])).toBe('18–25');
    expect(ageColumnOf([25, 35])).toBe('26–35');
    expect(ageColumnOf([35, 45])).toBe('36–45');
    expect(ageColumnOf([45, 55])).toBe('46+');
    expect(ageColumnOf([65, 120])).toBe('46+');
    expect(ageColumnOf([37, 37])).toBe('36–45');
  });

  test('середина ровно на границе колонок относится к нижней колонке', () => {
    // [17, 34]: середина 25,5 — ещё «18–25»; иначе человек перескакивал бы колонку из-за округления.
    expect(ageColumnOf([17, 34])).toBe('18–25');
    expect(ageColumnOf([26, 26])).toBe('26–35');
  });

  test('неизвестный возраст не попадает ни в одну колонку', () => {
    expect(ageColumnOf(null)).toBeNull();
  });

  test('диапазон группы пересекает все колонки, которые он задевает; неизвестный — все', () => {
    expect(ageColumnsOverlapping([35, 50])).toEqual(['26–35', '36–45', '46+']);
    expect(ageColumnsOverlapping([16, 25])).toEqual(['до 18', '18–25']);
    expect(ageColumnsOverlapping([65, 120])).toEqual(['46+']);
    expect(ageColumnsOverlapping(null)).toEqual([...AGE_COLUMNS]);
  });
});
