import { describe, expect, test } from 'vitest';
import type { GroupItem } from '@contracts';
import { buildGroups } from '../../fixtures/build';
import { applyFilters, groupRows } from '../../shared/filters';
import { groupsConfig } from './config';

const base = buildGroups().items[0]!;
const item = (patch: Partial<GroupItem>): GroupItem => ({ ...base, ...patch });
const rowsOf = (items: GroupItem[]) => items.map(groupsConfig.toRow);

describe('таблица групп: несколько дней и категорий возраста', () => {
  const tueThu = item({ id: 1, code: 'ДГ-0001', days: ['Вт', 'Чт'], ages: ['25-40', '40-55'], ageText: '25-40, 40-55' });
  const fri = item({ id: 2, code: 'ДГ-0002', days: ['Пт'], ages: ['18-25'], ageText: '18-25' });
  const any = item({ id: 3, code: 'ДГ-0003', days: [], ages: [], ageText: 'любой' });
  const rows = rowsOf([tueThu, fri, any]);
  const codes = (rs: typeof rows) => rs.map((r) => r['Код']);

  test('колонка «День» — все дни группы через запятую; без дней — пусто', () => {
    expect(rows.map((r) => r['День'])).toEqual(['Вт, Чт', 'Пт', null]);
  });

  test('отбор «День = Чт» находит группу, что собирается во вторник и четверг', () => {
    expect(codes(applyFilters(rows, [{ field: 'День', op: 'in', value: 'Чт' }], groupsConfig.fields))).toEqual(['ДГ-0001']);
    expect(codes(applyFilters(rows, [{ field: 'День', op: 'in', value: 'Вт|Пт' }], groupsConfig.fields))).toEqual(['ДГ-0001', 'ДГ-0002']);
    // Сохранённый вид «Нет дня и времени» — по пустому дню.
    expect(codes(applyFilters(rows, [{ field: 'День', op: 'empty', value: '' }], groupsConfig.fields))).toEqual(['ДГ-0003']);
  });

  test('группировка по дню кладёт группу в каждый её день', () => {
    const groups = groupRows(rows, 'День', groupsConfig.fields);
    expect(groups.map((g) => [g.key, codes(g.rows)])).toEqual([['Вт', ['ДГ-0001']], ['Пт', ['ДГ-0002']], ['Чт', ['ДГ-0001']], ['', ['ДГ-0003']]]);
  });

  test('отбор по возрасту — по категориям; неразборчивый возраст показан как записан', () => {
    expect(codes(applyFilters(rows, [{ field: 'Возраст', op: 'in', value: '40-55' }], groupsConfig.fields))).toEqual(['ДГ-0001']);
    expect(rows[2]!['Возраст']).toBe('любой');
  });
});
