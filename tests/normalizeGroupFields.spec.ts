import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/** Миграция 046 запускается один раз при деплое; тут гоняем её SQL на готовых данных. */
const sql = readFileSync(new URL('../migrations/046_group_composition_and_open_to_new.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const group = async (over: { composition?: string | null; openToNew?: string | null; doNotRefer?: boolean; source?: string }) =>
  (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, format, district, status, source, composition, open_to_new, do_not_refer)
     VALUES ('Ведущий', 'Молодежная', 'Приморский', 'Функционирует', $1, $2, $3, $4) RETURNING id`,
    [over.source ?? 'таблица', over.composition ?? null, over.openToNew ?? null, over.doNotRefer ?? false],
  )).rows[0]!.id;
const row = async (id: number) =>
  (await db.query(`SELECT composition, open_to_new, do_not_refer, source FROM groups WHERE id = $1`, [id])).rows[0];

describe('состав группы: «Семейная», «Служение», «Приватная» становятся «Смешанная»', () => {
  test.each([
    ['Семейная', 'Смешанная'],
    ['Служение', 'Смешанная'],
    ['приватная', 'Смешанная'],
    ['Женская, Семейная', 'Смешанная, Женская'],
    ['Семейная, Смешанная', 'Смешанная'],
    ['Служение,Приватная', 'Смешанная'],
    ['Мужская, Ментальная', 'Мужская, Ментальная'],
    ['Женская', 'Женская'],
  ])('«%s» → «%s»', async (before, after) => {
    const id = await group({ composition: before });
    await db.query(sql);
    expect((await row(id)).composition).toBe(after);
  });

  test('пустой состав не трогаем', async () => {
    const a = await group({ composition: null });
    const b = await group({ composition: '' });
    await db.query(sql);
    expect((await row(a)).composition).toBeNull();
    expect((await row(b)).composition).toBe('');
  });
});

describe('«Приём новых: НЕТ» становится отметкой «Не направлять»', () => {
  test('«НЕТ» в любом регистре — «Не направлять», а сам «Приём новых» очищается', async () => {
    const a = await group({ openToNew: 'НЕТ' });
    const b = await group({ openToNew: ' нет ' });
    const c = await group({ openToNew: 'Нет' });
    await db.query(sql);
    for (const id of [a, b, c]) expect(await row(id)).toMatchObject({ open_to_new: null, do_not_refer: true });
  });

  test('«ДА», «По требованию» и пустое остаются как были и в «Не направлять» не попадают', async () => {
    const yes = await group({ openToNew: 'ДА' });
    const onDemand = await group({ openToNew: 'По требованию' });
    const none = await group({ openToNew: null });
    await db.query(sql);
    expect(await row(yes)).toMatchObject({ open_to_new: 'ДА', do_not_refer: false });
    expect(await row(onDemand)).toMatchObject({ open_to_new: 'По требованию', do_not_refer: false });
    expect(await row(none)).toMatchObject({ open_to_new: null, do_not_refer: false });
  });
});

describe('общее', () => {
  test('происхождение записи не меняется, повторный запуск ничего не трогает', async () => {
    const id = await group({ composition: 'Женская, Семейная', openToNew: 'НЕТ' });
    await db.query(sql);
    await db.query(sql);
    expect(await row(id)).toEqual({ composition: 'Смешанная, Женская', open_to_new: null, do_not_refer: true, source: 'таблица' });
  });

  test('функция возвращает число поправленных групп — её же вызывает перенос таблицы церкви', async () => {
    await db.query(sql);
    await group({ composition: 'Семейная' });
    await group({ openToNew: 'НЕТ' });
    await group({ composition: 'Смешанная', openToNew: 'ДА' });
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(2);
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(0);
  });
});
