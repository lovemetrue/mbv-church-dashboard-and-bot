import { describe, expect, test } from 'vitest';
import { familyLabel, familyOptionLabels } from './family';

describe('подпись семейного положения по полу', () => {
  test('мужчине — «Холост» / «Женат», женщине — «Не замужем» / «Замужем»', () => {
    expect(familyLabel('single', 'м')).toBe('Холост');
    expect(familyLabel('married', 'м')).toBe('Женат');
    expect(familyLabel('single', 'ж')).toBe('Не замужем');
    expect(familyLabel('married', 'ж')).toBe('Замужем');
  });

  test('пол неизвестен — обе формы через «/»; варианта нет — «не указано»', () => {
    expect(familyLabel('single', null)).toBe('Холост / не замужем');
    expect(familyLabel('married', null)).toBe('Женат / замужем');
    expect(familyLabel(null, 'м')).toBe('не указано');
  });

  test('пункты выбора в форме — те же подписи', () => {
    expect(familyOptionLabels('ж')).toEqual({ single: 'Не замужем', married: 'Замужем' });
    expect(familyOptionLabels(null)).toEqual({ single: 'Холост / не замужем', married: 'Женат / замужем' });
  });
});
