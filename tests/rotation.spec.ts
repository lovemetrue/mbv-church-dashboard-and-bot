import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { CampaignScheduler } from '../src/broadcast/scheduler.js';
import { createDeps, type Deps } from '../src/deps.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let deps: Deps;
let userId: number;

const schedule = { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' };

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', new FakePlatform('telegram')]]),
    admins: new Map([['telegram', ['999']]]),
    schedule,
    broadcastRate: 1000,
    requestsRetentionDays: 90,
  });
  userId = await seedUser(db, { id: '100' });
});

/** Заявка с заданным возрастом в днях. */
async function seedRequest(daysAgo: number, status: 'Новая' | 'Исполнена'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (user_id, type, status, created_at)
     VALUES ($1, 'join_group', $2, now() - ($3 || ' days')::interval)
     RETURNING id`,
    [userId, status, daysAgo],
  );
  return rows[0]!.id;
}

const requestIds = async (): Promise<number[]> =>
  (await db.query<{ id: number }>('SELECT id FROM requests ORDER BY id')).rows.map((r) => r.id);

describe('ротация истории заявок', () => {
  test('закрытые заявки старше срока удаляются', async () => {
    const old = await seedRequest(100, 'Исполнена');
    const removed = await deps.requests.deleteOldClosed(90);

    expect(removed).toBe(1);
    expect(await requestIds()).not.toContain(old);
  });

  test('закрытые заявки моложе срока остаются', async () => {
    const recent = await seedRequest(30, 'Исполнена');
    await deps.requests.deleteOldClosed(90);

    expect(await requestIds()).toContain(recent);
  });

  test('ровно на границе срока заявка ещё жива', async () => {
    const edge = await seedRequest(89, 'Исполнена');
    await deps.requests.deleteOldClosed(90);

    expect(await requestIds()).toContain(edge);
  });

  test('открытые заявки не удаляются, даже очень старые', async () => {
    const forgotten = await seedRequest(400, 'Новая');
    const removed = await deps.requests.deleteOldClosed(90);

    expect(removed).toBe(0);
    expect(await requestIds()).toContain(forgotten);
  });

  test('участники при ротации заявок не затрагиваются', async () => {
    await seedRequest(100, 'Исполнена');
    await deps.requests.deleteOldClosed(90);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0]).toMatchObject({ n: 1 });
  });
});

describe('ротация в планировщике', () => {
  const scheduler = (now: () => Date) => new CampaignScheduler(deps, now);

  test('запускается при тике, даже когда кампания ещё не началась', async () => {
    const old = await seedRequest(100, 'Исполнена');
    // До старта кампании рассылки нет, но чистка истории идти должна.
    await scheduler(() => new Date('2026-08-20T09:00:00Z')).tick();

    expect(await requestIds()).not.toContain(old);
  });

  test('за сутки выполняется один раз, а не на каждом тике', async () => {
    await seedRequest(100, 'Исполнена');
    let now = new Date('2026-08-20T09:00:00Z');
    const s = scheduler(() => now);

    await s.tick();
    // Новая старая заявка появилась в тот же день: до следующих суток её не тронут.
    const second = await seedRequest(100, 'Исполнена');
    await s.tick();
    expect(await requestIds()).toContain(second);

    // На следующий день чистка проходит снова.
    now = new Date('2026-08-21T09:00:00Z');
    await s.tick();
    expect(await requestIds()).not.toContain(second);
  });
});
