import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/** Миграция 043 запускается один раз при деплое; тут гоняем её SQL на готовых данных. */
const sql = readFileSync(new URL('../migrations/043_capacity_5_for_empty_groups.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function group(leader: string, status: string, people: number | null, extra = ''): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, people, source${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ($1, 'Приморский', 'Основная церковь', $2, $3, 'таблица'${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
    [leader, status, people],
  );
  return rows[0]!.id;
}
const capacities = async () =>
  Object.fromEntries((await db.query<{ leader: string; capacity: number | null; source: string }>(
    'SELECT leader, capacity, source FROM groups ORDER BY id',
  )).rows.map((r) => [r.leader, `${r.capacity ?? '—'}/${r.source}`]));

describe('вместимость 5 у групп без людей (миграция 043)', () => {
  test('потенциальным и пустым — 5, остальным — как было; правка закрепляет запись за интерфейсом', async () => {
    await group('потенциальная', 'Потенциальная', null);
    await group('потенциальная с людьми', 'Потенциальная', 4);
    await group('пустая', 'Функционирует', 0);
    await group('без числа', 'На паузе', null);
    await group('с людьми', 'Функционирует', 6);
    await group('закрытая', 'Закрыта', 0);
    await group('недвижимость', 'Недвижимость', null);
    await group('убранная', 'Функционирует', 0, 'archived_at=now()');
    await group('своя вместимость', 'Функционирует', 0, 'capacity=8');
    await db.query(sql);
    expect(await capacities()).toEqual({
      'потенциальная': '5/ui',
      // Потенциальная — по определению без людей: число от ведущего здесь ни при чём.
      'потенциальная с людьми': '5/ui',
      'пустая': '5/ui',
      'без числа': '5/ui',
      'с людьми': '—/таблица',
      'закрытая': '—/таблица',
      'недвижимость': '—/таблица',
      'убранная': '—/таблица',
      'своя вместимость': '8/таблица',
    });
  });

  test('люди в составе или утверждённые в группу через сервис делают её непустой', async () => {
    const withMember = await group('с участником в составе', 'Функционирует', null);
    const withPlaced = await group('с утверждённым', 'Функционирует', 0);
    const userId = await seedUser(db, { id: '1', complete: true });
    await db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [withMember, userId]);
    await db.query(`INSERT INTO requests (type, status, fio, group_id, origin) VALUES ('join_group', 'Исполнена', 'Мария', $1, 'ui')`, [withPlaced]);
    await db.query(sql);
    expect(await capacities()).toEqual({ 'с участником в составе': '—/таблица', 'с утверждённым': '—/таблица' });
  });

  test('повторный запуск ничего не меняет', async () => {
    await group('пустая', 'Функционирует', 0);
    await db.query(sql);
    await db.query(`UPDATE groups SET capacity = 7`);
    await db.query(sql);
    expect(await capacities()).toEqual({ 'пустая': '7/ui' });
  });
});
