import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/** Миграция 016 запускается один раз при деплое; тут гоняем её SQL на готовых данных. */
const sql = readFileSync(new URL('../migrations/016_backfill_requests_for_registrations.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const types = async () =>
  (await db.query<{ fio: string | null; type: string; origin: string }>(
    `SELECT u.full_name AS fio, r.type, r.origin FROM requests r JOIN users u ON u.id = r.user_id ORDER BY u.id`,
  )).rows;

describe('дозаведение заявок для регистраций без заявки', () => {
  test('каждый ответ про малую группу получает свой тип заявки', async () => {
    for (const [i, s] of (['join', 'open', 'home', 'member', 'leader'] as const).entries()) {
      await seedUser(db, { id: String(i + 1), fio: s, mdgStatus: s, complete: true });
    }
    await db.query(sql);
    expect((await types()).map((r) => r.type)).toEqual(
      ['join_group', 'lead_group', 'lead_group', 'already_member', 'already_leader']);
    expect((await types()).every((r) => r.origin === 'ui')).toBe(true);
  });

  test('у кого заявка уже есть — вторую не заводит, повторный запуск тоже', async () => {
    const id = await seedUser(db, { id: '1', mdgStatus: 'join', complete: true });
    await db.query(`INSERT INTO requests (user_id, type) VALUES ($1, 'join_group')`, [id]);
    await seedUser(db, { id: '2', mdgStatus: 'member', complete: true });
    await db.query(sql);
    await db.query(sql);
    expect(await types()).toHaveLength(2);
  });

  test('недозаполненная анкета и участник без ответа про группу заявку не получают', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join', complete: false });
    await seedUser(db, { id: '2', mdgStatus: null, complete: true });
    await db.query(sql);
    expect(await types()).toHaveLength(0);
  });
});
