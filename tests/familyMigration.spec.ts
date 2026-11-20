import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { FAMILY_CASES } from '../src/core/family.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 070: семейное положение вариантом (`family_kind`) рядом с исходным текстом (`family_status`).
 * Тестовая база уже перенесена — для бэкфилла SQL гоняем ещё раз.
 */
const sql = readFileSync(new URL('../migrations/070_family_kind.sql', import.meta.url), 'utf8');
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const kindOfUser = async (id: number) =>
  (await db.query<{ k: string | null; t: string | null }>('SELECT family_kind AS k, family_status AS t FROM users WHERE id = $1', [id])).rows[0]!;
const card = async (family: string | null) =>
  (await db.query<{ id: number }>(`INSERT INTO persons (full_name, family_status, created_by) VALUES ('Петрова Анна', $1, 'тест') RETURNING id::int AS id`, [family])).rows[0]!.id;
const kindOfCard = async (id: number) => (await db.query<{ k: string | null }>('SELECT family_kind AS k FROM persons WHERE id = $1', [id])).rows[0]!.k;

describe('миграция 070: семейное положение вариантом', () => {
  test('база распознаёт текст так же, как код: одна таблица примеров', async () => {
    const { rows } = await db.query<{ t: string; k: string | null }>(
      'SELECT t, family_kind_of(t) AS k FROM unnest($1::text[]) AS t', [FAMILY_CASES.map(([t]) => t)],
    );
    expect(rows.map((r) => [r.t, r.k])).toEqual(FAMILY_CASES.map(([t, k]) => [t, k]));
  });

  test('новый ответ бота раскладывается сам, а исходный текст остаётся', async () => {
    const id = await seedUser(db, { id: '1' });
    await db.query(`UPDATE users SET family_status = 'Женат, двое детей' WHERE id = $1`, [id]);
    expect(await kindOfUser(id)).toEqual({ k: 'married', t: 'Женат, двое детей' });
    await db.query(`UPDATE users SET family_status = 'разведён' WHERE id = $1`, [id]);
    expect((await kindOfUser(id)).k).toBe('single');
  });

  test('выбор служителя не перетирается распознаванием', async () => {
    await db.query(sql);
    const id = await card('двое детей');
    expect(await kindOfCard(id)).toBeNull();
    await db.query(`UPDATE persons SET family_kind = 'married' WHERE id = $1`, [id]);
    await db.query(`UPDATE persons SET hobby = 'рыбалка' WHERE id = $1`, [id]);
    expect(await kindOfCard(id)).toBe('married');
    // Текст и выбор в одной правке: выбор главнее.
    const both = await card('двое детей');
    await db.query(`UPDATE persons SET family_status = 'холост', family_kind = 'married' WHERE id = $1`, [both]);
    expect(await kindOfCard(both)).toBe('married');
    // «Не указано» поверх понятного текста — тоже выбор.
    const other = await card('замужем');
    await db.query(`UPDATE persons SET family_kind = NULL WHERE id = $1`, [other]);
    expect(await kindOfCard(other)).toBeNull();
  });

  test('бэкфилл раскладывает старые ответы и не трогает выбранное; повторный прогон безвреден', async () => {
    const old = await card('Холост');
    const chosen = await card('женат');
    // Как до миграции: варианта нет ни у кого. Триггер на время отключаем, иначе он разложил бы текст сам.
    await db.query('ALTER TABLE persons DISABLE TRIGGER persons_family_kind');
    await db.query(`UPDATE persons SET family_kind = NULL WHERE id = $1`, [old]);
    await db.query(`UPDATE persons SET family_kind = 'single' WHERE id = $1`, [chosen]);
    await db.query('ALTER TABLE persons ENABLE TRIGGER persons_family_kind');
    await db.query(sql);
    await db.query(sql);
    expect(await kindOfCard(old)).toBe('single');
    expect(await kindOfCard(chosen)).toBe('single');
  });
});
