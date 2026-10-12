import { describe, expect, test } from 'vitest';
import type { StrangeMark } from '@contracts';
import { countStrange, formatMarkDate, isStrangeHold, strangeText } from './strange';

// Полдень по UTC: в любом часовом поясе это тот же календарный день.
const mark = (patch: Partial<StrangeMark> = {}): StrangeMark => ({ by: 'Анна', at: '2026-10-09T12:00:00.000Z', note: null, ...patch });

describe('метка «Странный человек»: тексты', () => {
  test('дата метки в «ДД.ММ.ГГГГ»', () => {
    expect(formatMarkDate('2026-10-09T12:00:00.000Z')).toBe('09.10.2026');
  });

  test('непонятная дата не ломает текст: даты просто нет', () => {
    expect(formatMarkDate('не дата')).toBe('');
    expect(strangeText(mark({ at: 'не дата' }))).toBe('Странный человек. Отметка: Анна.');
  });

  test('подсказка без заметки: кто и когда, без указания пола', () => {
    expect(strangeText(mark())).toBe('Странный человек. Отметка: Анна, 09.10.2026.');
  });

  test('подсказка с заметкой дописывает её после даты', () => {
    expect(strangeText(mark({ note: 'Говорит о слежке.' }))).toBe('Странный человек. Отметка: Анна, 09.10.2026. Говорит о слежке.');
  });

  test('заявка с причиной «странный» удержана от подбора, остальные нет', () => {
    expect(isStrangeHold({ noPlan: { code: 'strange', reason: 'x' } })).toBe(true);
    expect(isStrangeHold({ noPlan: { code: 'taken', reason: 'x' } })).toBe(false);
    expect(isStrangeHold({ noPlan: null })).toBe(false);
  });

  test('число отмеченных считает только записи с меткой', () => {
    expect(countStrange([{ strange: mark() }, { strange: null }, { strange: mark() }])).toBe(2);
  });
});
