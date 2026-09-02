import { describe, expect, test } from 'vitest';
import { days, participants, plural, requests, toParticipants, years } from '../src/core/plural.js';

describe('years', () => {
  test('единица берёт «год»', () => {
    expect(years(1)).toBe('1 год');
    expect(years(21)).toBe('21 год');
    expect(years(101)).toBe('101 год');
  });

  test('два, три, четыре берут «года»', () => {
    expect(years(2)).toBe('2 года');
    expect(years(4)).toBe('4 года');
    expect(years(34)).toBe('34 года');
    expect(years(22)).toBe('22 года');
  });

  test('пять и больше берут «лет»', () => {
    expect(years(5)).toBe('5 лет');
    expect(years(47)).toBe('47 лет');
    expect(years(100)).toBe('100 лет');
  });

  test('подростковые числа особые: одиннадцать и дальше это «лет»', () => {
    expect(years(11)).toBe('11 лет');
    expect(years(12)).toBe('12 лет');
    expect(years(14)).toBe('14 лет');
    expect(years(111)).toBe('111 лет');
    expect(years(112)).toBe('112 лет');
  });
});

describe('plural на других словах', () => {
  test('участники', () => {
    expect(participants(1)).toBe('1 участник');
    expect(participants(3)).toBe('3 участника');
    expect(participants(12)).toBe('12 участников');
  });

  test('заявки', () => {
    expect(requests(0)).toBe('0 заявок');
    expect(requests(1)).toBe('1 заявка');
    expect(requests(2)).toBe('2 заявки');
    expect(requests(7)).toBe('7 заявок');
  });

  test('дни', () => {
    expect(days(1)).toBe('1 день');
    expect(days(2)).toBe('2 дня');
    expect(days(40)).toBe('40 дней');
  });

  test('дательный падеж для рассылки', () => {
    expect(toParticipants(1)).toBe('1 участнику');
    expect(toParticipants(5)).toBe('5 участникам');
  });

  test('форму можно выбрать и без числа в строке', () => {
    expect(plural(1, 'файл', 'файла', 'файлов')).toBe('файл');
    expect(plural(5, 'файл', 'файла', 'файлов')).toBe('файлов');
  });
});
