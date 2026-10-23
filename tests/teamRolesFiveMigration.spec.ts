import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 051 сводит роли команды к пяти. Тестовая база уже перенесена, поэтому в транзакции возвращаем прежние
 * названия (как на боевой базе после 049), гоняем SQL миграции ещё раз и откатываем всё назад.
 */
const sql = readFileSync(new URL('../migrations/051_five_team_roles.sql', import.meta.url), 'utf8');
let db: Pool;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function inRolledBack(run: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    // Как после 049: «Координатор малых групп», у катализатора нет смысла, старшего распределителя нет.
    await c.query(`DELETE FROM team_roles WHERE name = 'Старший распределитель'`);
    await c.query(`UPDATE team_roles SET name = 'Координатор малых групп' WHERE name = 'Координатор'`);
    await c.query(`UPDATE team_roles SET kind = NULL WHERE name = 'Катализатор'`);
    await run(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

const rolesOf = async (c: PoolClient) =>
  (await c.query<{ name: string; roles: string }>(
    `SELECT c.name, string_agg(r.name, ', ' ORDER BY r.name) AS roles FROM coordinators c
       JOIN coordinator_roles cr ON cr.coordinator_id = c.id JOIN team_roles r ON r.id = cr.role_id
      GROUP BY c.id, c.name ORDER BY c.id`,
  )).rows;

describe('миграция 051: пять ролей команды', () => {
  test('остаются пять ролей со своим смыслом, лишние переносятся по смыслу и удаляются', async () => {
    await inRolledBack(async (c) => {
      await c.query(`INSERT INTO team_roles (name, kind) VALUES ('Молодёжный координатор', 'coordinator'), ('Пастор', NULL), ('Главный распределитель', 'distributor')`);
      await c.query(`INSERT INTO coordinators (name) VALUES ('Антипова'), ('Молодёжная Анна'), ('Пастор Пётр'), ('Двойная Роль'), ('Главная')`);
      await c.query(`INSERT INTO coordinator_roles (coordinator_id, role_id)
        SELECT c.id, r.id FROM (VALUES ('Антипова', 'Координатор малых групп'), ('Молодёжная Анна', 'Молодёжный координатор'),
          ('Пастор Пётр', 'Пастор'), ('Двойная Роль', 'Координатор малых групп'), ('Двойная Роль', 'Молодёжный координатор'),
          ('Главная', 'Главный распределитель')) AS v(person, role)
        JOIN coordinators c ON c.name = v.person JOIN team_roles r ON r.name = v.role`);
      await c.query(sql);

      const roles = await c.query('SELECT name, kind FROM team_roles ORDER BY name');
      expect(roles.rows).toEqual([
        { name: 'Катализатор', kind: 'catalyst' },
        { name: 'Координатор', kind: 'coordinator' },
        { name: 'Распределитель', kind: 'distributor' },
        { name: 'Старший координатор', kind: 'senior' },
        { name: 'Старший распределитель', kind: 'senior_distributor' },
      ]);
      expect(await rolesOf(c)).toEqual([
        { name: 'Антипова', roles: 'Координатор' },
        { name: 'Молодёжная Анна', roles: 'Координатор' },
        // Роль без смысла и без подсказки в названии — «Координатор»: так записаны почти все в таблице церкви.
        { name: 'Пастор Пётр', roles: 'Координатор' },
        // Две роли, ставшие одной, — одна связь, а не ошибка повтора.
        { name: 'Двойная Роль', roles: 'Координатор' },
        { name: 'Главная', roles: 'Распределитель' },
      ]);
    });
  });

  test('незнакомое название из таблицы церкви не заводит шестую роль, а ложится на одну из пяти', async () => {
    await inRolledBack(async (c) => {
      await c.query(sql);
      const ids = await c.query<{ name: string }>(
        `SELECT r.name FROM unnest(ARRAY['Молодёжный координатор', 'Старший распределитель служения', 'Катализатор служения', 'Кто-то ещё']) AS v(n)
           JOIN team_roles r ON r.id = team_role_id(v.n)`,
      );
      expect(ids.rows.map((r) => r.name)).toEqual(['Координатор', 'Старший распределитель', 'Катализатор', 'Координатор']);
      expect((await c.query('SELECT count(*)::int AS n FROM team_roles')).rows[0].n).toBe(5);
    });
  });
});
