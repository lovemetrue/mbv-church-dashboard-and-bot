import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 049 запускается один раз при деплое, на базе, где роль ещё текстом. Тестовая база уже мигрирована,
 * поэтому в транзакции возвращаем прежнее устройство (текстовая колонка, без справочника), заводим координаторов
 * как в боевой базе, гоняем SQL миграции и откатываем всё назад.
 */
const sql = readFileSync(new URL('../migrations/049_team_roles.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function asBefore049(c: PoolClient): Promise<void> {
  await c.query('ALTER TABLE coordinators ADD COLUMN role text');
  await c.query(`CREATE OR REPLACE VIEW assistant.coordinators AS
    SELECT c.id, assistant.name_ref('Координатор', c.name) AS coordinator, c.role FROM coordinators c WHERE c.archived_at IS NULL`);
  await c.query('ALTER TABLE coordinators DROP COLUMN role_id');
  await c.query('DROP TABLE team_roles');
  await c.query('DROP FUNCTION team_role_id(text)');
  await c.query('DROP FUNCTION team_role_kind_guess(text)');
}

async function inRolledBack(run: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await asBefore049(c);
    await run(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

describe('миграция 049: роли команды из текста в справочник', () => {
  test('каждое название становится одной ролью, у координаторов — ссылка; текстовой колонки больше нет', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO coordinators (name, role, archived_at) VALUES
        ('Антипова Ольга', 'Координатор малых групп', NULL),
        ('Клименко Павел', 'координатор малых групп ', NULL),
        ('Молодёжная Анна', 'Молодёжный координатор', NULL),
        ('Родионов Давид', 'Распределитель', NULL),
        ('Старшая Лена', 'Старший координатор', NULL),
        ('Пастор Пётр', 'Пастор', NULL),
        ('Ушедший', 'Бывшая роль', now())`);
      await c.query(sql);
      const { rows } = await c.query(
        `SELECT c.name, r.name AS role, r.kind FROM coordinators c JOIN team_roles r ON r.id = c.role_id ORDER BY c.id`,
      );
      expect(rows).toEqual([
        { name: 'Антипова Ольга', role: 'Координатор малых групп', kind: 'coordinator' },
        // Тот же текст в другом регистре и с пробелом — та же роль, а не вторая.
        { name: 'Клименко Павел', role: 'Координатор малых групп', kind: 'coordinator' },
        { name: 'Молодёжная Анна', role: 'Молодёжный координатор', kind: 'coordinator' },
        { name: 'Родионов Давид', role: 'Распределитель', kind: 'distributor' },
        { name: 'Старшая Лена', role: 'Старший координатор', kind: 'senior' },
        { name: 'Пастор Пётр', role: 'Пастор', kind: null },
        // Удалённым из справочника ссылка тоже нужна: их строки остаются в базе.
        { name: 'Ушедший', role: 'Бывшая роль', kind: null },
      ]);
      const roles = await c.query('SELECT count(*)::int AS n FROM team_roles');
      expect(roles.rows[0].n).toBe(6);
      const column = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coordinators' AND column_name = 'role'`);
      expect(column.rowCount).toBe(0);
    });
  });

  test('помощник по-прежнему видит роль словами', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO coordinators (name, role) VALUES ('Родионов Давид', 'Распределитель')`);
      await c.query(sql);
      const { rows } = await c.query('SELECT role FROM assistant.coordinators');
      expect(rows).toEqual([{ role: 'Распределитель' }]);
    });
  });

  test('пустая роль не ломает миграцию: человек получает роль «Без роли»', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO coordinators (name, role) VALUES ('Без Роли', '  ')`);
      await c.query(sql);
      const { rows } = await c.query('SELECT r.name FROM coordinators c JOIN team_roles r ON r.id = c.role_id');
      expect(rows).toEqual([{ name: 'Без роли' }]);
    });
  });
});
