import { describe, expect, test } from 'vitest';
import { usersToCsv } from '../src/core/csv.js';
import type { UserRow } from '../src/db/repos/users.repo.ts';

const user = (patch: Partial<UserRow> = {}): UserRow => ({
  id: 1,
  platform: 'telegram',
  platform_user_id: '42',
  chat_id: '42',
  username: 'ivan',
  phone: '+79001234567',
  full_name: 'Иванов Иван Иванович',
  church: 'МБВ (Колизей)',
  mdg_status: 'member',
  location: null,
  age: null,
  companions: null,
  leader_name: null,
  consent_at: new Date('2026-09-01T04:00:00Z'),
  registration_no: 7,
  complete: true,
  registered_at: new Date('2026-09-01T04:30:00Z'), // 07:30 по Москве
  registered_by: null,
  preferred_contact: null,
  admin_comment: null,
  kit_issued_at: null,
  kit_issued_by: null,
  blocked_at: null,
  created_at: new Date('2026-09-01T04:00:00Z'),
  ...patch,
});

const lines = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('usersToCsv', () => {
  test('начинается с BOM, чтобы Excel не ломал кириллицу', () => {
    expect(usersToCsv([user()]).startsWith('﻿')).toBe(true);
  });

  test('первая строка — заголовки через точку с запятой', () => {
    const [header] = lines(usersToCsv([]));
    expect(header?.split(';')).toContain('Телефон');
    expect(header?.split(';').length).toBeGreaterThan(5);
  });

  test('выгружает ФИО, телефон и номер регистрации', () => {
    const [, row] = lines(usersToCsv([user()]));
    expect(row).toContain('Иванов Иван Иванович');
    expect(row).toContain('+79001234567');
    expect(row).toContain('7');
  });

  test('положение в малой группе выводится словами', () => {
    expect(lines(usersToCsv([user({ mdg_status: 'member' })]))[1]).toContain('состоит в группе');
    expect(lines(usersToCsv([user({ mdg_status: 'join' })]))[1]).toContain('ищет группу');
    expect(lines(usersToCsv([user({ mdg_status: 'leader' })]))[1]).toContain('ведёт группу');
  });

  test('видно, кто регистрировал и заполнена ли анкета', () => {
    expect(lines(usersToCsv([user()]))[1]).toContain('сам');
    const byMinister = lines(usersToCsv([user({ registered_by: '999', complete: false })]))[1];
    expect(byMinister).toContain('служитель 999');
  });

  test('выдача набора попадает в выгрузку датой', () => {
    const issued = lines(usersToCsv([user({ kit_issued_at: new Date('2026-11-01T09:00:00Z') })]))[1];
    expect(issued).toContain('01.11.2026');
  });

  test('дата регистрации выводится по московскому времени', () => {
    const [, row] = lines(usersToCsv([user()]));
    expect(row).toContain('01.09.2026 07:30');
  });

  test('точка с запятой внутри значения экранируется кавычками', () => {
    const [, row] = lines(usersToCsv([user({ location: 'Тверская; Пушкинская' })]));
    expect(row).toContain('"Тверская; Пушкинская"');
  });

  test('кавычки внутри значения удваиваются', () => {
    const [, row] = lines(usersToCsv([user({ location: 'район "Северный"' })]));
    expect(row).toContain('"район ""Северный"""');
  });

  test('перенос строки внутри значения не разрывает строку CSV', () => {
    const csv = usersToCsv([user({ location: 'Тверская\nПушкинская' })]);
    expect(lines(csv)).toHaveLength(2);
  });

  test('пустые поля остаются пустыми, а не превращаются в null', () => {
    const [, row] = lines(usersToCsv([user({ location: null, age: null, username: null })]));
    expect(row).not.toContain('null');
  });

  test('без участников остаётся только заголовок', () => {
    expect(lines(usersToCsv([]))).toHaveLength(1);
  });
});
