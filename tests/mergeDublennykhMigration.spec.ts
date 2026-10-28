import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { seedCoordinator, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 064: все написания Дублённых Дмитрия в «В работе у» у заявок и «Координаторе» у групп («Дубленых Дмитрий»)
 * сливаются в имя из справочника команды. Остальных не трогает. Тестовая база уже перенесена — SQL гоняем ещё раз.
 */
const sql = readFileSync(new URL('../migrations/064_merge_dublennykh_responsible.sql', import.meta.url), 'utf8');
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function request(responsible: string | null): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, origin, responsible) VALUES ('lead_group', 'В работе', 'Андрианова Ольга', 'таблица', $1) RETURNING id::int AS id`,
    [responsible],
  )).rows[0]!.id;
}
async function group(coordinator: string | null): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, source, coordinator) VALUES ('Ведущий', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'таблица', $1) RETURNING id::int AS id`,
    [coordinator],
  )).rows[0]!.id;
}
const responsibleOf = async (id: number) => (await db.query<{ r: string | null }>('SELECT responsible AS r FROM requests WHERE id = $1', [id])).rows[0]!.r;
const coordinatorOf = async (id: number) => (await db.query<{ c: string | null }>('SELECT coordinator AS c FROM groups WHERE id = $1', [id])).rows[0]!.c;

describe('миграция 064: Дублённых Дмитрий — одним именем везде', () => {
  test('«Дубленых Дмитрий» у заявки и группы становится «Дублённых Дмитрий Владимирович» (ё, двойная буква, отчество)', async () => {
    await seedCoordinator(db, 'Дублённых Дмитрий Владимирович', ['Координатор']);
    const r = await request('Дубленых Дмитрий');
    const g = await group('дубленых  дмитрий');
    await db.query(sql);
    expect(await responsibleOf(r)).toBe('Дублённых Дмитрий Владимирович');
    expect(await coordinatorOf(g)).toBe('Дублённых Дмитрий Владимирович');
  });

  test('других людей не трогает, даже с тем же видом расхождения; повторный запуск безвреден', async () => {
    await seedCoordinator(db, 'Дублённых Дмитрий Владимирович', ['Координатор']);
    await seedCoordinator(db, 'Лебедева Анна Сергеевна', ['Координатор']);
    const other = await request('Лебедева Анна');
    const done = await request('Дубленых Дмитрий');
    await db.query(sql);
    await db.query(sql);
    expect(await responsibleOf(other)).toBe('Лебедева Анна');
    expect(await responsibleOf(done)).toBe('Дублённых Дмитрий Владимирович');
  });

  test('имени нет в справочнике или оно уже верное — ничего не меняется', async () => {
    await seedCoordinator(db, 'Иванов Пётр Сергеевич', ['Координатор']);
    await seedCoordinator(db, 'Лебедева Анна', ['Координатор']);
    const stranger = await request('Сидоров Олег');
    const exact = await request('Лебедева Анна');
    const nobody = await request(null);
    await db.query(sql);
    await db.query(sql);
    expect(await responsibleOf(stranger)).toBe('Сидоров Олег');
    expect(await responsibleOf(exact)).toBe('Лебедева Анна');
    expect(await responsibleOf(nobody)).toBeNull();
  });

  test('двое в справочнике с тем же ключом или он удалён из справочника — не переписываем', async () => {
    await seedCoordinator(db, 'Дубленых Дмитрий Иванович', ['Координатор']);
    await seedCoordinator(db, 'Дублённых Дмитрий Владимирович', ['Координатор']);
    const r = await request('Дубленых Дмитрий');
    await db.query(sql);
    expect(await responsibleOf(r)).toBe('Дубленых Дмитрий');
  });

  test('удалённый из справочника участник команды не считается: на него не переписываем', async () => {
    await seedCoordinator(db, 'Дублённых Дмитрий Владимирович', ['Координатор'], { archived: true });
    const r = await request('Дубленых Дмитрий');
    await db.query(sql);
    expect(await responsibleOf(r)).toBe('Дубленых Дмитрий');
  });
});
