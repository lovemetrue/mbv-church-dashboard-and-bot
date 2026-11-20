import { describe, expect, test } from 'vitest';
import { FAMILY_CASES, familyKindOf } from '../src/core/family.js';

describe('семейное положение из свободного текста', () => {
  test.each(FAMILY_CASES)('«%s» → %s', (text, kind) => {
    expect(familyKindOf(text)).toBe(kind);
  });

  test('пустое и отсутствующее — «не указано»', () => {
    expect(familyKindOf(null)).toBeNull();
    expect(familyKindOf(undefined)).toBeNull();
    expect(familyKindOf('   ')).toBeNull();
  });

  test('«муж» внутри другого слова женатым не делает', () => {
    expect(familyKindOf('мужчина, 30 лет')).toBeNull();
    expect(familyKindOf('мужественный')).toBeNull();
  });
});
