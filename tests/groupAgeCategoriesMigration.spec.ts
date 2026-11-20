import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';
import { groupAgeCategories } from '../src/home-groups/plan/parse.js';

/**
 * Миграция 068 запускается один раз при деплое; тут гоняем её SQL на готовых данных. Сам SQL выполняем в каждом
 * тесте: другие спеки переопределяют `normalize_group_fields()` SQL-ом старых миграций (047), а база у тестов общая.
 */
const sql = readFileSync(new URL('../migrations/068_group_age_categories.sql', import.meta.url), 'utf8');
const table = JSON.parse(readFileSync(new URL('../dashboard/data.json', import.meta.url), 'utf8')) as { groups: { age: string | null }[] };
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const group = async (age: string | null, source = 'таблица') =>
  (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, direction_id, district, status, source, age)
     VALUES ('Ведущий', group_direction_id('Молодежная'), 'Приморский', 'Функционирует', $1, $2) RETURNING id`,
    [source, age],
  )).rows[0]!.id;
const row = async (id: number) => (await db.query(`SELECT age, source FROM groups WHERE id = $1`, [id])).rows[0];

describe('миграция 068: возраст группы — набор категорий анкеты', () => {
  test('старые диапазоны становятся категориями, которые задевают: «35-50» → «25-40, 40-55»', async () => {
    const cases: [string, string][] = [
      ['35-50', '25-40, 40-55'],
      ['50-60', '40-55, 55-65'],
      ['16-25', 'подростки (до 18 лет), 18-25'],
      ['25-35', '25-40'],
      ['35-45 лет', '25-40, 40-55'],
      ['40-55', '40-55'],
      ['65+', '65+'],
      ['40-55, 25-40', '25-40, 40-55'],
    ];
    const ids = await Promise.all(cases.map(([age]) => group(age)));
    await db.query(sql);
    for (const [i, [raw, want]] of cases.entries()) expect((await row(ids[i]!)).age, raw).toBe(want);
  });

  test('«любой», пусто и мусор не трогает; источник записи не меняет', async () => {
    const any = await group('любой');
    const none = await group(null);
    const junk = await group('???');
    const ui = await group('35-50', 'ui');
    await db.query(sql);
    expect(await row(any)).toEqual({ age: 'любой', source: 'таблица' });
    expect((await row(none)).age).toBeNull();
    expect((await row(junk)).age).toBe('???');
    expect(await row(ui)).toEqual({ age: '25-40, 40-55', source: 'ui' });
  });

  test('повторный запуск ничего не меняет', async () => {
    const id = await group('35-50');
    await db.query(sql);
    await db.query(sql);
    expect((await row(id)).age).toBe('25-40, 40-55');
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(0);
  });

  test('перенос таблицы снова приводит возраст к категориям: «35-50» из таблицы не возвращается', async () => {
    await db.query(sql);
    const id = await group('35-50');
    expect((await db.query(`SELECT normalize_group_fields() AS n`)).rows[0].n).toBe(1);
    expect((await row(id)).age).toBe('25-40, 40-55');
  });

  test('SQL раскладывает возраст так же, как разбор подбора (`groupAgeCategories`), на всех значениях таблицы церкви', async () => {
    await db.query(sql);
    const raws = new Set<string | null>([
      ...table.groups.map((g) => g.age),
      '25', '26', '40', '41', '18', '17', '200', '40.0', '20+', 'подростки', '18-25, 65+', '30-35', '45-55 лет',
    ]);
    for (const raw of raws) {
      const { rows } = await db.query<{ c: string | null }>(`SELECT group_age_categories($1) AS c`, [raw]);
      const js = groupAgeCategories(raw);
      expect(rows[0]!.c, String(raw)).toBe(js.length > 0 ? js.join(', ') : null);
    }
  });
});
