import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { composeService, engine as realEngine } from '../src/home-groups/composition.js';
import { SETTING_NOTIFY } from '../src/db/repos/placementNotices.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

test('после «Утвердить» карточка заявки получает сообщения в MAX: сквозь сервис, как в бою', async () => {
  await db.query(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1, 'true'::jsonb, 't')`, [SETTING_NOTIFY]);
  const u = async (pid: string) => Number((await db.query<{ id: number }>(
    `INSERT INTO users (platform, platform_user_id, chat_id, full_name, registered_at) VALUES ('max', $1, 'c' || $1, 'Виктор Петров', now()) RETURNING id`, [pid])).rows[0]!.id);
  const person = await u('1');
  const leader = await u('2');
  const g = Number((await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, people, source, leader_user_id)
     VALUES ('Марина Иванова', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui', $1) RETURNING id`, [leader])).rows[0]!.id);
  const r = Number((await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, origin, user_id, responsible) VALUES ('join_group', 'Новая', 'бот', $1, 'Анна') RETURNING id`, [person])).rows[0]!.id);

  const s = composeService(db, realEngine, { defaultCapacity: 10, ttlMs: 0 });
  expect(await s.placement.approve(r, g, 'Анна', { force: false, defaultCapacity: 10 })).toEqual({ ok: true });
  s.views.invalidate();
  const item = (await s.views()).requests.items.find((i) => i.id === r)!;
  expect(item.bucket).toBe('done');
  expect(item.botNotices?.map((n) => [n.recipient, n.status])).toEqual([['person', 'queued'], ['leader', 'queued']]);
});
