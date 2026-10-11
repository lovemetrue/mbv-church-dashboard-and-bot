import { describe, expect, test } from 'vitest';
import { inputSignature } from '../src/home-groups/plan/signature.js';

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
  ])('изменился %s — отпечаток другой', (_name, patch) => {
    expect(inputSignature({ ...base, ...patch })).not.toBe(inputSignature(base));
  });

  test('пустая улица и отсутствие улицы — одно и то же; неизвестное и известное — разное', () => {
    expect(inputSignature({ ...base, street: null })).toBe(inputSignature({ ...base, street: '   ' }));
    expect(inputSignature({ ...base, slot: null })).not.toBe(inputSignature(base));
    expect(inputSignature({ ...base, district: null, ageRange: null })).toMatch(/^[0-9a-f]{16}$/);
  });
});
