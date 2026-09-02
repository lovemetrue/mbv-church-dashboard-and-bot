import { Client, type Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';

const DEV_URL = process.env.TEST_DATABASE_URL ?? 'postgres://church:church@localhost:5433/church40';
const TEST_DB = 'church40_test';

/** Отдельная база для тестов, чтобы не затирать данные локальной разработки. */
export async function setupTestDb(): Promise<Pool> {
  const admin = new Client({ connectionString: DEV_URL });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (rows.length === 0) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const url = new URL(DEV_URL);
  url.pathname = `/${TEST_DB}`;
  const pool = createPool(url.toString());
  await runMigrations(pool);
  return pool;
}

export async function truncateAll(db: Pool): Promise<void> {
  await db.query(
    `TRUNCATE users, sessions, admin_sessions, requests, campaign_days, broadcasts, deliveries, groups, coordinators
     RESTART IDENTITY CASCADE`,
  );
  // Номера регистрации в тестах должны начинаться заново, иначе ожидания «№1» ломаются.
  await db.query('ALTER SEQUENCE registration_no_seq RESTART WITH 1');
}

/** Готовый участник кампании: телефон, ФИО и присвоенный номер регистрации. */
export async function seedUser(
  db: Pool,
  opts: {
    platform?: 'telegram' | 'max';
    id: string;
    registered?: boolean;
    blocked?: boolean;
    phone?: string;
    fio?: string;
    church?: string;
    mdgStatus?: 'open' | 'join' | 'member' | 'leader' | null;
    complete?: boolean;
    chatId?: string;
  },
): Promise<number> {
  const registered = opts.registered ?? true;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (platform, platform_user_id, chat_id, phone, full_name, church, mdg_status,
                        complete, registration_no, registered_at, blocked_at, consent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             CASE WHEN $9 THEN nextval('registration_no_seq')::int ELSE NULL END,
             CASE WHEN $9 THEN now() ELSE NULL END,
             CASE WHEN $10 THEN now() ELSE NULL END,
             now())
     RETURNING id`,
    [
      opts.platform ?? 'telegram',
      opts.id,
      opts.chatId ?? opts.id,
      opts.phone ?? `+7900000${opts.id.padStart(4, '0')}`,
      opts.fio ?? 'Иванов Иван Иванович',
      opts.church ?? 'МБВ (Колизей)',
      opts.mdgStatus === undefined ? 'member' : opts.mdgStatus,
      opts.complete ?? true,
      registered,
      opts.blocked ?? false,
    ],
  );
  return rows[0]!.id;
}
