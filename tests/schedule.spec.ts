import { describe, expect, test } from 'vitest';
import { campaignDay, dueBroadcast, localDate, localTime } from '../src/broadcast/schedule.js';

const opts = {
  startDate: '2026-09-01',
  broadcastTime: '07:00',
  totalDays: 40,
  timezone: 'Europe/Moscow',
};

// Москва летом это UTC+3, поэтому 04:00Z = 07:00 МСК.
const utc = (iso: string) => new Date(iso);

describe('localDate и localTime', () => {
  test('дата берётся по московскому времени, а не по UTC', () => {
    // 22:30 UTC 31 августа это уже 01:30 первого сентября в Москве.
    expect(localDate(utc('2026-08-31T22:30:00Z'), 'Europe/Moscow')).toBe('2026-09-01');
  });

  test('время берётся по московскому времени', () => {
    expect(localTime(utc('2026-09-01T04:05:00Z'), 'Europe/Moscow')).toBe('07:05');
  });
});

describe('campaignDay', () => {
  test('в день старта это первый день', () => {
    expect(campaignDay(utc('2026-09-01T09:00:00Z'), opts)).toBe(1);
  });

  test('до старта кампании дней нет', () => {
    expect(campaignDay(utc('2026-08-30T09:00:00Z'), opts)).toBe(0);
  });

  test('на следующий день после старта это второй день', () => {
    expect(campaignDay(utc('2026-09-02T09:00:00Z'), opts)).toBe(2);
  });

  test('за минуту до московской полуночи день ещё не сменился', () => {
    expect(campaignDay(utc('2026-09-01T20:59:00Z'), opts)).toBe(1);
  });

  test('в московскую полночь начинается следующий день', () => {
    expect(campaignDay(utc('2026-09-01T21:00:00Z'), opts)).toBe(2);
  });

  test('сороковой день кампании считается', () => {
    expect(campaignDay(utc('2026-10-10T09:00:00Z'), opts)).toBe(40);
  });

  test('после кампании счёт продолжается за пределы сорока', () => {
    expect(campaignDay(utc('2026-10-11T09:00:00Z'), opts)).toBe(41);
  });
});

describe('dueBroadcast', () => {
  test('до времени рассылки ничего не отправляем', () => {
    expect(dueBroadcast(utc('2026-09-01T03:59:00Z'), opts)).toBeNull();
  });

  test('ровно во время рассылки отдаём день', () => {
    expect(dueBroadcast(utc('2026-09-01T04:00:00Z'), opts)).toBe(1);
  });

  test('позже в тот же день рассылка всё ещё считается сегодняшней', () => {
    expect(dueBroadcast(utc('2026-09-01T15:00:00Z'), opts)).toBe(1);
  });

  test('до начала кампании рассылки нет', () => {
    expect(dueBroadcast(utc('2026-08-25T09:00:00Z'), opts)).toBeNull();
  });

  test('после последнего дня рассылки нет', () => {
    expect(dueBroadcast(utc('2026-10-11T09:00:00Z'), opts)).toBeNull();
  });

  test('в последний день рассылка есть', () => {
    expect(dueBroadcast(utc('2026-10-10T09:00:00Z'), opts)).toBe(40);
  });

  test('зимой сдвиг Москвы к UTC тот же, расчёт не ломается', () => {
    const winter = { ...opts, startDate: '2027-01-10' };
    expect(dueBroadcast(utc('2027-01-10T03:59:00Z'), winter)).toBeNull();
    expect(dueBroadcast(utc('2027-01-10T04:00:00Z'), winter)).toBe(1);
  });
});
