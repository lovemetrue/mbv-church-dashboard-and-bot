import { Client, type Pool } from 'pg';
import type { MdgStatus } from '../../src/core/fsm.js';
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
    `TRUNCATE users, sessions, admin_sessions, requests, campaign_days, broadcasts, deliveries, groups, coordinators,
       placement_proposals, request_hints, group_members, persons, strange_marks, person_genders, geocode_cache, assistant_chat_messages, audit_log, app_settings, system_errors, agent_prompts, staff, staff_tokens, team_roles, group_directions
     RESTART IDENTITY CASCADE`,
  );
  // Пять ролей заводят миграции 049 и 051; после очистки возвращаем их, как на свежей базе.
  await db.query(
    `INSERT INTO team_roles (name, kind) VALUES
       ('Катализатор', 'catalyst'), ('Старший распределитель', 'senior_distributor'), ('Распределитель', 'distributor'),
       ('Старший координатор', 'senior'), ('Координатор', 'coordinator')`,
  );
  // Направления групп заводит миграция 052 — тоже возвращаем; первое (основное) — направление по умолчанию.
  await db.query(
    `INSERT INTO group_directions (name, position) VALUES
       ('Основное служение', 1), ('Подростковое служение', 2), ('Молодёжное служение', 3), ('Филиал «Серебристый»', 4)`,
  );
  // Номера регистрации в тестах должны начинаться заново, иначе ожидания «№1» ломаются.
  await db.query('ALTER SEQUENCE registration_no_seq RESTART WITH 1');
}

/**
 * Человек в справочнике команды с ролями словами (как в таблице церкви): роль по названию находит `team_role_id`
 * (миграция 051: незнакомое название ложится на одну из пяти ролей). Возвращает его id.
 */
export async function seedCoordinator(
  db: Pool,
  name: string,
  roles: string[],
  opts: { source?: string; archived?: boolean } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO coordinators (name, source, archived_at) VALUES ($1, $2, $3) RETURNING id::int AS id`,
    [name, opts.source ?? 'ui', opts.archived ? new Date() : null],
  );
  const id = rows[0]!.id;
  await db.query('INSERT INTO coordinator_roles (coordinator_id, role_id) SELECT $1, team_role_id(r) FROM unnest($2::text[]) AS r', [id, roles]);
  return id;
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
    mdgStatus?: MdgStatus | null;
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
