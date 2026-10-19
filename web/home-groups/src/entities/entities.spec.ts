import { describe, expect, test } from 'vitest';
import { formatDateFull, formatDateShort, formatPhone, groupLabel, groupLine, healthTone, phoneDigits } from './format';
import { plural, pluralForm, FORMS } from './plural';
import { BUCKET_LABEL, isBucketFilter, openCount } from './buckets';

describe('склонение', () => {
  test.each([
    [1, 'заявка'],
    [2, 'заявки'],
    [4, 'заявки'],
    [5, 'заявок'],
    [11, 'заявок'],
    [12, 'заявок'],
    [21, 'заявка'],
    [22, 'заявки'],
    [100, 'заявок'],
    [111, 'заявок'],
    [0, 'заявок'],
  ])('%i → %s', (n, word) => {
    expect(pluralForm(n, FORMS.request)).toBe(word);
  });

  test('число вместе со словом', () => {
    expect(plural(3, FORMS.person)).toBe('3 человека');
  });
});

describe('форматы', () => {
  test('дата в «ДД.ММ» не зависит от часового пояса', () => {
    expect(formatDateShort('2026-10-09')).toBe('09.10');
    expect(formatDateShort('2026-10-09T23:30:00+03:00')).toBe('09.10');
    expect(formatDateShort(null)).toBe('');
    expect(formatDateShort('вчера')).toBe('');
    expect(formatDateFull('2026-10-09')).toBe('09.10.2026');
  });

  test('российский номер приводится к единому виду, маска и чужие номера остаются как есть', () => {
    expect(formatPhone('89111242418')).toBe('+7 911 124 24 18');
    expect(formatPhone('+7 (911) 124-24-18')).toBe('+7 911 124 24 18');
    expect(formatPhone('+7 911 ··· 24 18')).toBe('+7 911 ··· 24 18');
    expect(formatPhone('+375 29 123 45 67')).toBe('+375 29 123 45 67');
    expect(formatPhone(null)).toBe('');
  });

  test('цифры телефона для поиска', () => {
    expect(phoneDigits('+7 (911) 124-24-18')).toBe('79111242418');
  });

  test('группа подписывается кодом: номер строки из первоначальной таблицы — не номер группы', () => {
    expect(groupLabel({ code: 'ДГ-0012' })).toBe('ДГ-0012');
    expect(groupLine({ code: 'ДГ-0012', leader: 'Ольга К.', whenText: 'Вт, вечер' })).toBe('ДГ-0012 · Ольга К. · Вт, вечер');
    expect(groupLine({ code: 'ДГ-0012', leader: 'Ольга К.', whenText: null })).toBe('ДГ-0012 · Ольга К.');
  });

  test('здоровье окрашивается по порогам 80 и 60', () => {
    expect(healthTone(100)).toBe('ok');
    expect(healthTone(80)).toBe('ok');
    expect(healthTone(79)).toBe('warn');
    expect(healthTone(60)).toBe('warn');
    expect(healthTone(59)).toBe('crit');
  });
});

describe('корзины заявок', () => {
  test('у каждой корзины есть подпись', () => {
    expect(BUCKET_LABEL.ready).toBe('Готово к утверждению');
    expect(BUCKET_LABEL.human).toBe('Нужна помощь в сопоставлении');
    expect(BUCKET_LABEL.done).toBe('Утверждено');
  });

  test('открытые заявки — это готово, перезвонить и нужна помощь', () => {
    expect(openCount({ ready: 3, callback: 0, human: 2, done: 9, cancelled: 4 })).toBe(5);
  });

  test('значение фильтра из адреса проверяется', () => {
    expect(isBucketFilter('ready')).toBe(true);
    expect(isBucketFilter('all')).toBe(true);
    expect(isBucketFilter('cancelled')).toBe(false);
    expect(isBucketFilter(null)).toBe(false);
  });
});
