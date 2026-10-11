import { describe, expect, test } from 'vitest';
import { anyNeed, baseHash, needsOf, scrub } from '../src/home-groups/assistant/brief.js';

describe('что уходит помощнику', () => {
  test.each([
    ['Купчино, звоните 8 (911) 000-11-22', 'Купчино, звоните'],
    ['рядом с метро +7 911 000 11 22 вечером', 'рядом с метро вечером'],
    ['пишите ivan.petrov@mail.ru или @ivan_p', 'пишите или'],
    ['сайт https://vk.com/id12345 Невский', 'сайт Невский'],
    ['паспорт 4012345678 Приморский', 'паспорт Приморский'],
  ])('«%s» очищается от контактов', (raw, expected) => {
    expect(scrub(raw)).toBe(expected);
  });

  test('чистый текст не меняется, пустой и состоящий из контактов — null', () => {
    expect(scrub('м. Звёздная, вечером после 19')).toBe('м. Звёздная, вечером после 19');
    expect(scrub('')).toBeNull();
    expect(scrub(null)).toBeNull();
    expect(scrub('89110001122')).toBeNull();
  });

  test('слишком длинный текст обрезается', () => {
    expect(scrub('я'.repeat(500))!.length).toBe(120);
  });

  test('отпечаток не зависит от регистра и пробелов, но меняется вместе с записью', () => {
    const a = baseHash({ place: 'Купчино', age: '30', schedule: 'вечером' });
    expect(baseHash({ place: ' купчино ', age: '30', schedule: 'вечером' })).toBe(a);
    expect(baseHash({ place: 'Купчино', age: '31', schedule: 'вечером' })).not.toBe(a);
    expect(baseHash({ place: 'Купчино', age: '30', schedule: null })).not.toBe(a);
  });

  test('помощнику нужно только то, что скрипт не понял, при наличии текста', () => {
    const b = { place: 'около Купчино', age: 'за тридцать', schedule: 'вечером' };
    expect(needsOf(b, { district: null, ageKnown: false, whenKnown: false })).toEqual({ district: true, age: true, time: true });
    expect(needsOf(b, { district: 'Фрунзенский', ageKnown: true, whenKnown: false })).toEqual({ district: false, age: false, time: true });
    expect(needsOf({ place: null, age: null, schedule: null }, { district: null, ageKnown: false, whenKnown: false }))
      .toEqual({ district: false, age: false, time: false });
    expect(anyNeed({ district: false, age: false, time: false })).toBe(false);
    expect(anyNeed({ district: false, age: true, time: false })).toBe(true);
  });
});
