import { describe, expect, test } from 'vitest';
import { diffSnapshots, inputSignature, inputSnapshot, parseSnapshot } from '../src/home-groups/plan/signature.js';

const base = { district: 'Приморский', ageRange: [25, 35] as [number, number], days: ['Пн' as const, 'Ср' as const], slot: 'вечер' as const, street: 'ул. Рылеева 32' };

describe('отпечаток данных заявки', () => {
  test('одни и те же данные дают один отпечаток, порядок дней и регистр улицы не важны', () => {
    expect(inputSignature(base)).toBe(inputSignature({ ...base, days: ['Ср', 'Пн'], street: '  УЛ. РЫЛЕЕВА 32 ' }));
  });

  test.each([
    ['район', { district: 'Невский' }],
    ['возраст', { ageRange: [36, 45] as [number, number] }],
    ['дни', { days: ['Пн' as const] }],
    ['время суток', { slot: 'утро' as const }],
    ['улица', { street: 'ул. Другая 1' }],
    ['неподходящий день', { avoidDays: ['Вс' as const] }],
    ['неподходящее время суток', { avoidSlots: ['утро' as const] }],
  ])('изменился %s — отпечаток другой', (_name, patch) => {
    expect(inputSignature({ ...base, ...patch })).not.toBe(inputSignature(base));
  });

  test('«не подходит» отпечаток не меняет, пока его нет: ранее сохранённые предложения не станут «данные изменились»', () => {
    // Значение отпечатка у заявки без «кроме…» зафиксировано: его менять нельзя, иначе после выкладки все предложения пометятся.
    expect(inputSignature(base)).toBe('16309d3dd4824688');
    expect(inputSignature({ ...base, avoidDays: [], avoidSlots: [] })).toBe(inputSignature(base));
    expect(inputSignature({ ...base, avoidDays: ['Вс', 'Сб'] })).toBe(inputSignature({ ...base, avoidDays: ['Сб', 'Вс'] }));
    expect(inputSignature({ ...base, avoidDays: ['Вс'] })).not.toBe(inputSignature({ ...base, avoidSlots: ['утро'] }));
  });

  test('пустая улица и отсутствие улицы — одно и то же; неизвестное и известное — разное', () => {
    expect(inputSignature({ ...base, street: null })).toBe(inputSignature({ ...base, street: '   ' }));
    expect(inputSignature({ ...base, slot: null })).not.toBe(inputSignature(base));
    expect(inputSignature({ ...base, district: null, ageRange: null })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('снимок данных для показа: что изменилось', () => {
  test('снимок — готовые к показу строки: район, возраст, дни по порядку, время суток, улица', () => {
    expect(inputSnapshot(base)).toEqual({ district: 'Приморский', age: '25–35', days: 'Пн, Ср', slot: 'вечер', street: 'ул. Рылеева 32', avoid: null });
    expect(inputSnapshot({ ...base, avoidDays: ['Вс', 'Сб'], avoidSlots: ['утро'] }).avoid).toBe('Сб, Вс, утро');
    expect(inputSnapshot({ ...base, days: ['Ср', 'Пн'], street: '  ' })).toMatchObject({ days: 'Пн, Ср', street: null });
    expect(inputSnapshot({ district: null, ageRange: [40, 40], days: [], slot: null, street: null }))
      .toEqual({ district: null, age: '40', days: null, slot: null, street: null, avoid: null });
  });

  test('различия — по каждому изменившемуся полю: было и стало, с русским названием поля', () => {
    const before = inputSnapshot(base);
    const after = inputSnapshot({ ...base, street: 'ул. Новая 5', slot: null });
    expect(diffSnapshots(before, after)).toEqual([
      { field: 'Время суток', before: 'вечер', after: null },
      { field: 'Улица', before: 'ул. Рылеева 32', after: 'ул. Новая 5' },
    ]);
  });

  test('одно и то же даёт пустой список; регистр и пробелы в улице не считаются изменением', () => {
    expect(diffSnapshots(inputSnapshot(base), inputSnapshot(base))).toEqual([]);
    expect(diffSnapshots(inputSnapshot(base), inputSnapshot({ ...base, street: ' УЛ. РЫЛЕЕВА 32 ' }))).toEqual([]);
  });

  test('снимок, сохранённый до появления «не подходит», читается: поля нет — значит, его не было', () => {
    const old = { district: 'Приморский', age: '25–35', days: 'Пн, Ср', slot: 'вечер', street: null };
    expect(parseSnapshot(old)).toEqual({ ...old, avoid: null });
    expect(diffSnapshots(parseSnapshot(old)!, inputSnapshot({ ...base, street: null, avoidDays: ['Вс'] })))
      .toEqual([{ field: 'Не подходит', before: null, after: 'Вс' }]);
    expect(diffSnapshots(parseSnapshot(old)!, inputSnapshot({ ...base, street: null }))).toEqual([]);
  });

  test('снимок из базы читается, а мусор вместо него — null, а не ошибка', () => {
    const snap = inputSnapshot(base);
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    for (const junk of [null, undefined, 5, 'x', [], { district: 5 }, { district: null, age: null }]) expect(parseSnapshot(junk), String(junk)).toBeNull();
  });
});
