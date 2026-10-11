import { describe, expect, test } from 'vitest';
import { requestsToCsv } from '../src/home-groups/export.js';
import type { RequestItem } from '../src/home-groups/contracts.js';

const item = (over: Partial<RequestItem>): RequestItem => ({
  id: 1, fio: 'Мария Иванова', phone: '+7 911 000-11-22', ageLabel: '26-35', place: 'Приморский', district: 'Приморский', days: [], slot: null,
  street: null, source: 'Бот', status: 'Новая', bucket: 'ready', callback: false, waitingDays: 3, dataFill: [true, true, false, false],
  proposal: null, noPlan: null, scheduleInfo: { source: null, text: null }, streetInfo: { source: null, text: null }, original: [],
  finalGroup: null, finalGroupText: null, responsible: 'Анна', note: null, log: [], ...over,
} as RequestItem);

describe('выгрузка заявок в CSV', () => {
  test('первая строка — заголовки, дальше по строке на заявку; разделитель «;» для Excel', () => {
    const [head, row] = requestsToCsv([item({})]).replace(/^﻿/, '').split('\r\n');
    expect(head!.split(';')[0]).toBe('№');
    expect(row).toContain('Мария Иванова');
    expect(row).toContain('+7 911 000-11-22');
    expect(row).toContain('Анна');
  });

  test('начинается с метки порядка байтов, иначе Excel портит кириллицу', () => {
    expect(requestsToCsv([]).startsWith('﻿')).toBe(true);
  });

  test('ячейки с «;», кавычками и переводами строк берутся в кавычки', () => {
    const csv = requestsToCsv([item({ fio: 'Иванова; "Маша"', note: 'строка\nвторая' })]);
    expect(csv).toContain('"Иванова; ""Маша"""');
    expect(csv).toContain(';строка вторая');
    expect(csv).not.toContain('строка\n');
  });

  test('значения, похожие на формулу, не исполняются в таблице', () => {
    const csv = requestsToCsv([item({ fio: '=HYPERLINK("http://x")', note: '+1+1', responsible: '@cmd' })]);
    expect(csv).not.toMatch(/;=HYPERLINK|;\+1|;@cmd/);
    expect(csv).toContain("'=HYPERLINK");
  });
});
