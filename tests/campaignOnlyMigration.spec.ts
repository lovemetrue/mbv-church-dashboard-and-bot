import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/** Миграция 047 запускается один раз при деплое; тут гоняем её SQL (без ALTER: колонка уже есть) на готовых данных. */
const sql = readFileSync(new URL('../migrations/047_campaign_only_and_potential_40_days.sql', import.meta.url), 'utf8')
  .replace(/ALTER TABLE groups ADD COLUMN campaign_only[^;]*;/, '');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const group = async (status: string, over: { source?: string; registered?: boolean; archived?: boolean } = {}) =>
  (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, format, district, status, source, campaign_registered, archived_at)
     VALUES ('Ведущий', 'Молодежная', 'Приморский', $1, $2, $3, $4) RETURNING id`,
    [status, over.source ?? 'таблица', over.registered ?? false, over.archived ? new Date() : null],
  )).rows[0]!.id;
const row = async (id: number) =>
  (await db.query(`SELECT status, campaign_only, campaign_registered, source FROM groups WHERE id = $1`, [id])).rows[0];

describe('статус «Кампания» становится отметкой «Работает только в кампанию»', () => {
  test('«Кампания» → «Функционирует» с отметкой; другие статусы не трогаем', async () => {
    const camp = await group('Кампания');
    const live = await group('Функционирует');
    await db.query(sql);
    expect(await row(camp)).toMatchObject({ status: 'Функционирует', campaign_only: true, source: 'таблица' });
    expect(await row(live)).toMatchObject({ status: 'Функционирует', campaign_only: false });
  });
});

describe('у потенциальных групп «40 дней» включено по умолчанию', () => {
  test('миграция включает «40 дней» всем текущим потенциальным, и правленым в интерфейсе тоже', async () => {
    const fromTable = await group('Потенциальная');
    const fromUi = await group('Потенциальная', { source: 'ui' });
    const live = await group('Функционирует');
    const removed = await group('Потенциальная', { archived: true });
    await db.query(sql);
    expect((await row(fromTable)).campaign_registered).toBe(true);
    expect((await row(fromUi)).campaign_registered).toBe(true);
    expect((await row(live)).campaign_registered).toBe(false);
    expect((await row(removed)).campaign_registered).toBe(false);
  });

  test('перенос таблицы церкви ставит «40 дней» только перенесённым: снятую служителем галочку не возвращает', async () => {
    await db.query(sql);
    const fromTable = await group('Потенциальная');
    const unchecked = await group('Потенциальная', { source: 'ui' });
    const camp = await group('Кампания');
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(2);
    expect((await row(fromTable)).campaign_registered).toBe(true);
    expect((await row(unchecked)).campaign_registered).toBe(false);
    expect((await row(camp)).campaign_only).toBe(true);
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(0);
  });
});
