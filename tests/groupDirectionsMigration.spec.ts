import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 052 запускается один раз при деплое, на базе, где у группы ещё текстовый «формат». Тестовая база уже
 * перенесена, поэтому в транзакции возвращаем прежнее устройство, заводим группы как в боевой базе, гоняем SQL
 * миграции и откатываем всё назад.
 */
const sql = readFileSync(new URL('../migrations/052_group_directions_and_chamber.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function inRolledBack(run: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query('DROP VIEW assistant.groups');
    await c.query('ALTER TABLE groups DROP COLUMN direction_id, DROP COLUMN chamber');
    await c.query(`ALTER TABLE groups ADD COLUMN format text NOT NULL DEFAULT 'Основная церковь'`);
    await c.query('DROP FUNCTION group_direction_id(text)');
    await c.query('DROP FUNCTION group_direction_default()');
    await c.query('DROP TABLE group_directions');
    await run(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

describe('миграция 052: «Формат группы» → «Направление» и «Камерная группа»', () => {
  test('основная церковь и молодёжная становятся направлениями, приватная и служение — камерными основного направления', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO groups (leader, district, format, status, source) VALUES
        ('Основная', 'Приморский', 'Основная церковь', 'Функционирует', 'таблица'),
        ('Молодёжная', 'Приморский', 'Молодежная', 'Функционирует', 'таблица'),
        ('Приватная', 'Приморский', 'Приватная (Закрытая)', 'Функционирует', 'таблица'),
        ('Служение', 'Приморский', 'Служение', 'Функционирует', 'ui')`);
      await c.query(sql);
      const { rows } = await c.query(
        `SELECT g.leader, d.name AS direction, g.chamber FROM groups g JOIN group_directions d ON d.id = g.direction_id ORDER BY g.id`,
      );
      expect(rows).toEqual([
        { leader: 'Основная', direction: 'Основное служение', chamber: false },
        { leader: 'Молодёжная', direction: 'Молодёжное служение', chamber: false },
        { leader: 'Приватная', direction: 'Основное служение', chamber: true },
        { leader: 'Служение', direction: 'Основное служение', chamber: true },
      ]);
      const column = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'format'`);
      expect(column.rowCount).toBe(0);
    });
  });

  test('помощник видит направление, а адрес камерной группы — нет', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO groups (leader, district, format, status, address, source) VALUES
        ('Открытая', 'Приморский', 'Молодежная', 'Функционирует', 'ул. Открытая, 1', 'ui'),
        ('Камерная', 'Приморский', 'Служение', 'Функционирует', 'ул. Тайная, 2', 'ui')`);
      await c.query(sql);
      const { rows } = await c.query('SELECT format, address, chamber FROM assistant.groups ORDER BY id');
      expect(rows).toEqual([
        { format: 'Молодёжное служение', address: 'ул. Открытая, 1', chamber: false },
        { format: 'Основное служение', address: null, chamber: true },
      ]);
    });
  });

  test('потенциальная группа из заявки «хочу открыть» заводится с основным направлением', async () => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, phone, place, origin) VALUES ('lead_group', 'Новая', 'Анна', '+79110001122', 'Невский', 'ui') RETURNING id`,
    );
    await db.query('SELECT ensure_potential_group($1)', [rows[0]!.id]);
    const g = await db.query(`SELECT d.name AS direction, g.chamber FROM groups g JOIN group_directions d ON d.id = g.direction_id`);
    expect(g.rows).toEqual([{ direction: 'Основное служение', chamber: false }]);
  });
});
