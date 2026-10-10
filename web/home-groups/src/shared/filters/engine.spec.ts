import { describe, expect, test } from 'vitest';
import {
  applyFilters,
  distinctValues,
  groupRows,
  matchesFilter,
  opsFor,
  sameFilters,
  searchRows,
  sortRows,
  type FieldDef,
  type Filter,
  type Row,
} from './index';

const defs: FieldDef[] = [
  { key: 'Район', groupable: true },
  { key: 'Возраст', multi: true },
  { key: 'Места', kind: 'number' },
  { key: 'Дата', kind: 'date' },
  { key: 'Ведущий' },
];

const rows: Row[] = [
  { Район: 'Приморский', Возраст: '18–25, 26–35', Места: 4, Дата: '2026-09-12', Ведущий: 'Ольга К.' },
  { Район: 'Невский', Возраст: '26–35', Места: 0, Дата: '2026-10-01', Ведущий: 'Павел Д.' },
  { Район: 'Приморский', Возраст: '46+', Места: 10, Дата: null, Ведущий: 'Анна С.' },
  { Район: null, Возраст: null, Места: null, Дата: '2026-08-30', Ведущий: '' },
];

const f = (field: string, op: Filter['op'], value = ''): Filter => ({ field, op, value });
const names = (rs: Row[]) => rs.map((r) => r['Ведущий']);

describe('движок отборов: условия', () => {
  test('«=» отбирает точное совпадение текста', () => {
    expect(names(applyFilters(rows, [f('Район', 'eq', 'Приморский')], defs))).toEqual(['Ольга К.', 'Анна С.']);
  });

  test('«≠» оставляет и строки с пустым значением', () => {
    expect(names(applyFilters(rows, [f('Район', 'ne', 'Приморский')], defs))).toEqual(['Павел Д.', '']);
  });

  test('«=» по полю-списку проверяет вхождение, а не равенство строки целиком', () => {
    expect(names(applyFilters(rows, [f('Возраст', 'eq', '26–35')], defs))).toEqual(['Ольга К.', 'Павел Д.']);
    expect(names(applyFilters(rows, [f('Возраст', 'ne', '26–35')], defs))).toEqual(['Анна С.', '']);
  });

  test('«≥» и «≤» сравнивают числа как числа, а не как строки', () => {
    expect(names(applyFilters(rows, [f('Места', 'ge', '10')], defs))).toEqual(['Анна С.']);
    expect(names(applyFilters(rows, [f('Места', 'le', '4')], defs))).toEqual(['Ольга К.', 'Павел Д.']);
  });

  test('пустое число не проходит «≥», «≤» и «=»: null не превращается в ноль', () => {
    expect(matchesFilter(rows[3]!, f('Места', 'le', '5'), defs)).toBe(false);
    expect(matchesFilter(rows[3]!, f('Места', 'eq', '0'), defs)).toBe(false);
    expect(matchesFilter(rows[1]!, f('Места', 'eq', '0'), defs)).toBe(true);
  });

  test('даты сравниваются как ISO-строки', () => {
    expect(names(applyFilters(rows, [f('Дата', 'ge', '2026-09-01')], defs))).toEqual(['Ольга К.', 'Павел Д.']);
    expect(names(applyFilters(rows, [f('Дата', 'le', '2026-09-01')], defs))).toEqual(['']);
  });

  test('«пусто» и «заполнено» понимают null и пустую строку', () => {
    expect(names(applyFilters(rows, [f('Ведущий', 'empty')], defs))).toEqual(['']);
    expect(names(applyFilters(rows, [f('Район', 'filled')], defs))).toEqual(['Ольга К.', 'Павел Д.', 'Анна С.']);
  });

  test('несколько отборов действуют вместе (И)', () => {
    const out = applyFilters(rows, [f('Район', 'eq', 'Приморский'), f('Места', 'ge', '5')], defs);
    expect(names(out)).toEqual(['Анна С.']);
  });

  test('без отборов возвращает все строки, но новый массив', () => {
    const out = applyFilters(rows, [], defs);
    expect(out).toHaveLength(4);
    expect(out).not.toBe(rows);
  });

  test('для текстовых полей нет «больше/меньше», для чисел и дат есть', () => {
    expect(opsFor(defs[0])).toEqual(['eq', 'ne', 'empty', 'filled']);
    expect(opsFor(defs[2])).toContain('ge');
    expect(opsFor(defs[3])).toContain('le');
  });
});

describe('движок отборов: поиск, сортировка, группировка', () => {
  test('быстрый поиск ищет подстроку в любой ячейке без учёта регистра', () => {
    expect(names(searchRows(rows, 'ПРИМОР'))).toEqual(['Ольга К.', 'Анна С.']);
    expect(names(searchRows(rows, '  '))).toHaveLength(4);
  });

  test('сортировка по числу идёт по значению, а пустые всегда внизу', () => {
    const asc = sortRows(rows, { field: 'Места', dir: 'asc' }, defs);
    expect(asc.map((r) => r['Места'])).toEqual([0, 4, 10, null]);
    const desc = sortRows(rows, { field: 'Места', dir: 'desc' }, defs);
    expect(desc.map((r) => r['Места'])).toEqual([10, 4, 0, null]);
  });

  test('сортировка текста учитывает русский алфавит', () => {
    const out = sortRows(rows, { field: 'Район', dir: 'asc' }, defs);
    expect(out.map((r) => r['Район'])).toEqual(['Невский', 'Приморский', 'Приморский', null]);
  });

  test('группировка сохраняет порядок внутри группы, пустая группа идёт последней', () => {
    const sorted = sortRows(rows, { field: 'Места', dir: 'desc' }, defs);
    const groups = groupRows(sorted, 'Район');
    expect(groups.map((g) => g.key)).toEqual(['Невский', 'Приморский', '']);
    expect(names(groups[1]!.rows)).toEqual(['Анна С.', 'Ольга К.']);
  });

  test('без поля группировки возвращается одна общая группа', () => {
    expect(groupRows(rows, null)).toHaveLength(1);
  });

  test('значения для выпадающего списка раскрывают поля-списки и не повторяются', () => {
    expect(distinctValues(rows, defs[1]!)).toEqual(['18–25', '26–35', '46+']);
    expect(distinctValues(rows, defs[0]!)).toEqual(['Невский', 'Приморский']);
  });

  test('одинаковые наборы отборов узнаются независимо от порядка', () => {
    expect(sameFilters([f('A', 'eq', '1'), f('B', 'empty')], [f('B', 'empty'), f('A', 'eq', '1')])).toBe(true);
    expect(sameFilters([f('A', 'eq', '1')], [f('A', 'eq', '2')])).toBe(false);
  });
});

describe('движок отборов: служебные ключи', () => {
  test('быстрый поиск не заглядывает в служебные ключи, начинающиеся с «_»', () => {
    const withKey: Row[] = [{ _key: 'u17', Ведущий: 'Анна' }, { _key: 'u2', Ведущий: 'Пётр' }];
    expect(searchRows(withKey, 'u17')).toEqual([]);
    expect(searchRows(withKey, 'анн')).toHaveLength(1);
  });
});
