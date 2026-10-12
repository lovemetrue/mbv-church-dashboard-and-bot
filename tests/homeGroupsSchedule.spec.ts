import { describe, expect, test } from 'vitest';
import { parseHumanSchedule } from '../src/home-groups/plan/parse.js';

/** Нежелательные дни и время суток разбираются в `homeGroupsDays.spec.ts`; здесь их нет. */
const NOTHING_AVOIDED = { avoidDays: [], avoidSlots: [] };

/**
 * Удобное время, как его пишут люди: «пн, ср — с 17 до 22 часов». Разбор нужен подбору, но он
 * честно отвечает «не знаю» (дни пусты, время null), когда текст неоднозначен.
 */
describe('удобные дни и время из свободного текста', () => {
  test.each([
    ['пн, ср - с 17 до 22 часов', ['Пн', 'Ср'], 'вечер'],
    ['Пн,Ср с 17:00 до 22:00', ['Пн', 'Ср'], 'вечер'],
    ['вторник вечером', ['Вт'], 'вечер'],
    ['по средам и четвергам утром', ['Ср', 'Чт'], 'утро'],
    ['в субботу днём', ['Сб'], 'день'],
    ['в субботу днем', ['Сб'], 'день'],
    ['воскресенье после 18', ['Вс'], 'вечер'],
    ['пятница с 10 до 18', ['Пт'], 'день'],
    ['чт 19:30', ['Чт'], 'вечер'],
    ['вечер', [], 'вечер'],
    ['по вечерам', [], 'вечер'],
    ['с 8 до 11', [], 'утро'],
  ])('«%s» → дни %j, время %s', (text, days, slot) => {
    expect(parseHumanSchedule(text)).toEqual({ days, slot, ...NOTHING_AVOIDED });
  });

  test.each([
    ['будни', ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']],
    ['по будням вечером', ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']],
    ['выходные', ['Сб', 'Вс']],
    ['в выходные', ['Сб', 'Вс']],
    ['пн-пт', ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']],
    ['с понедельника по среду', ['Пн', 'Вт', 'Ср']],
    ['сб-вс', ['Сб', 'Вс']],
    ['пт-пн', ['Пн', 'Пт', 'Сб', 'Вс']],
  ])('наборы дней: «%s»', (text, days) => {
    expect(parseHumanSchedule(text).days).toEqual(days);
  });

  test('дни называются в порядке недели и без повторов', () => {
    expect(parseHumanSchedule('ср, пн, среда, понедельник').days).toEqual(['Пн', 'Ср']);
  });

  test.each(['', '   ', 'любое', 'любой день', 'в любое время', 'как получится', 'не знаю'])('«%s» — ничего не известно', (text) => {
    expect(parseHumanSchedule(text)).toEqual({ days: [], slot: null, ...NOTHING_AVOIDED });
  });

  test('null и undefined не бросают', () => {
    expect(parseHumanSchedule(null)).toEqual({ days: [], slot: null, ...NOTHING_AVOIDED });
    expect(parseHumanSchedule(undefined)).toEqual({ days: [], slot: null, ...NOTHING_AVOIDED });
  });

  test('несколько разных времён суток — время неизвестно, а дни остаются', () => {
    expect(parseHumanSchedule('вторник утром или вечером')).toEqual({ days: ['Вт'], slot: null, ...NOTHING_AVOIDED });
  });

  test('«с 10 до 18»: середина диапазона — день; «с 17 до 22» — вечер; «с 9 до 21» — день', () => {
    expect(parseHumanSchedule('с 10 до 18').slot).toBe('день');
    expect(parseHumanSchedule('с 17 до 22').slot).toBe('вечер');
    expect(parseHumanSchedule('с 9 до 21').slot).toBe('день');
  });

  test('слова с «ср», «вс», «пт» внутри других слов дни не дают', () => {
    expect(parseHumanSchedule('средний вечер, всегда, пятно').days).toEqual([]);
  });

  test('числа вне часов (дом, этаж) время не определяют', () => {
    expect(parseHumanSchedule('дом 99').slot).toBeNull();
    expect(parseHumanSchedule('в 25 часов').slot).toBeNull();
  });
});
