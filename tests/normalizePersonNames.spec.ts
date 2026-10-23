import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/** Миграция 045 запускается один раз при деплое; тут гоняем её SQL на готовых данных. */
const sql = readFileSync(new URL('../migrations/045_normalize_person_names.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const coordinator = (name: string, archived = false) =>
  db.query(`INSERT INTO coordinators (name, role_id, archived_at) VALUES ($1, team_role_id('Координатор'), $2)`, [name, archived ? new Date() : null]);
const request = async (responsible: string | null) =>
  (await db.query<{ id: number }>(`INSERT INTO requests (type, fio, responsible) VALUES ('join_group', 'Заявитель', $1) RETURNING id`, [responsible])).rows[0]!.id;
const group = async (coordinatorName: string | null) =>
  (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, format, district, status, source, coordinator) VALUES ('Ведущий', 'Молодежная', 'Приморский', 'Функционирует', 'ui', $1) RETURNING id`,
    [coordinatorName],
  )).rows[0]!.id;
const responsibleOf = async (id: number) => (await db.query(`SELECT responsible, origin FROM requests WHERE id = $1`, [id])).rows[0];
const coordinatorOf = async (id: number) => (await db.query(`SELECT coordinator FROM groups WHERE id = $1`, [id])).rows[0].coordinator;

describe('приведение ФИО ответственных и координаторов к написанию из справочника', () => {
  test('«Имя Фамилия» в заявке и в группе становится «Фамилия Имя», как в справочнике координаторов', async () => {
    await coordinator('Родионов Давид');
    await coordinator('Артёмкин Константин');
    const r1 = await request('Давид Родионов');
    const r2 = await request('  давид   РОДИОНОВ ');
    const r3 = await request('Константин Артемкин');
    const g1 = await group('Давид Родионов');
    await db.query(sql);
    expect((await responsibleOf(r1)).responsible).toBe('Родионов Давид');
    expect((await responsibleOf(r2)).responsible).toBe('Родионов Давид');
    // «ё» и «е» в таблице церкви пишут вперемешку.
    expect((await responsibleOf(r3)).responsible).toBe('Артёмкин Константин');
    expect(await coordinatorOf(g1)).toBe('Родионов Давид');
  });

  test('кого нет в справочнике, не трогаем: по одному имени фамилию не угадать', async () => {
    await coordinator('Родионов Давид');
    const other = await request('Юлия Комарская');
    const partial = await request('Давид');
    const longer = await request('Давид Родионов Координатор распределения');
    const none = await request(null);
    await db.query(sql);
    expect((await responsibleOf(other)).responsible).toBe('Юлия Комарская');
    expect((await responsibleOf(partial)).responsible).toBe('Давид');
    expect((await responsibleOf(longer)).responsible).toBe('Давид Родионов Координатор распределения');
    expect((await responsibleOf(none)).responsible).toBeNull();
  });

  test('два разных написания одного человека в справочнике — неясно, какое верное, имя не меняем', async () => {
    await coordinator('Родионов Давид');
    await coordinator('Давид Родионов');
    const r = await request('давид родионов');
    await db.query(sql);
    expect((await responsibleOf(r)).responsible).toBe('давид родионов');
  });

  test('удалённые из справочника координаторы образцом не служат', async () => {
    await coordinator('Родионов Давид', true);
    const r = await request('Давид Родионов');
    await db.query(sql);
    expect((await responsibleOf(r)).responsible).toBe('Давид Родионов');
  });

  test('происхождение записи не меняется, а повторный запуск ничего не трогает', async () => {
    await coordinator('Родионов Давид');
    const r = await request('Давид Родионов');
    await db.query(`UPDATE requests SET origin = 'таблица' WHERE id = $1`, [r]);
    await db.query(sql);
    await db.query(sql);
    expect(await responsibleOf(r)).toEqual({ responsible: 'Родионов Давид', origin: 'таблица' });
  });

  test('функция возвращает, сколько записей поправлено, — её же вызывает перенос таблицы церкви', async () => {
    await db.query(sql);
    await coordinator('Родионов Давид');
    await request('Давид Родионов');
    await group('Давид Родионов');
    await group('Родионов Давид');
    expect((await db.query(`SELECT normalize_person_names() AS n`)).rows[0].n).toBe(2);
    expect((await db.query(`SELECT normalize_person_names() AS n`)).rows[0].n).toBe(0);
  });
});
