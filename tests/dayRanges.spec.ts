import { describe, expect, test } from 'vitest';
import { formatDayRanges } from '../src/core/dayRanges.js';

describe('formatDayRanges', () => {
  test('подряд идущие дни сворачивает в диапазон', () => {
    expect(formatDayRanges([1, 2, 3, 4, 5])).toBe('1–5');
  });

  test('одиночные дни оставляет как есть', () => {
    expect(formatDayRanges([1, 3, 5])).toBe('1, 3, 5');
  });

  test('смесь диапазонов и одиночек', () => {
    expect(formatDayRanges([1, 2, 3, 5, 7, 8, 9])).toBe('1–3, 5, 7–9');
  });

  test('пара подряд не превращается в диапазон, так короче', () => {
    expect(formatDayRanges([4, 5])).toBe('4, 5');
  });

  test('порядок не важен, дубли не мешают', () => {
    expect(formatDayRanges([3, 1, 2, 2])).toBe('1–3');
  });

  test('пустой список даёт пустую строку', () => {
    expect(formatDayRanges([])).toBe('');
  });

  test('все сорок дней сворачиваются в одну запись', () => {
    expect(formatDayRanges(Array.from({ length: 40 }, (_, i) => i + 1))).toBe('1–40');
  });
});
