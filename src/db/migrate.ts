import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { logger } from '../logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// В dev запускаемся из src/db, в контейнере из dist/db. Папка migrations лежит рядом с ними.
const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

/**
 * Применяет неприменённые файлы migrations/*.sql по порядку имени.
 * Каждая миграция идёт в своей транзакции вместе с отметкой в schema_migrations,
 * поэтому упавшая миграция не оставляет схему в полусостоянии.
 */
export async function runMigrations(db: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );

  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      executed.push(file);
      logger.info({ migration: file }, 'миграция применена');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Миграция ${file} не применилась: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return executed;
}
