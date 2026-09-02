import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { campaignStats } from '../src/dashboard/campaignStats.js';
import { CampaignRepo } from '../src/db/repos/campaign.repo.js';
import { DeliveriesRepo } from '../src/db/repos/deliveries.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;

const SCHEDULE = { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' };

const collect = (now: Date) =>
  campaignStats(
    {
      users: new UsersRepo(db),
      requests: new RequestsRepo(db),
      campaign: new CampaignRepo(db),
      deliveries: new DeliveriesRepo(db),
    },
    SCHEDULE,
    now,
  );

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

describe('статистика кампании для дашборда', () => {
  test('пустая база: всё по нулям, а не ошибка', async () => {
    const s = await collect(new Date('2026-08-27T09:00:00Z'));
    expect(s.participants).toMatchObject({
      registered: 0, complete: 0, incomplete: 0, kitsIssued: 0, blocked: 0, unfinished: 0,
    });
    expect(s.byPlatform).toEqual([]);
    expect(s.newRequests).toBe(0);
    expect(s.days.loaded).toBe(0);
    expect(s.days.total).toBe(40);
  });

  test('цифры совпадают с тем, что в базе', async () => {
    await seedUser(db, { id: '1', registered: true });
    await seedUser(db, { id: '2', registered: true });
    await seedUser(db, { id: '3', registered: false });     // бросил анкету, номера нет
    await seedUser(db, { id: '4', registered: true, blocked: true });
    await db.query(`UPDATE users SET kit_issued_at = now() WHERE platform_user_id = '1'`);
    await db.query(`UPDATE users SET mdg_status = 'open' WHERE platform_user_id = '1'`);
    await db.query(`UPDATE users SET mdg_status = 'join' WHERE platform_user_id = '2'`);
    await db.query(
      `INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', 'Новая', 'Из листа', 'таблица')`,
    );

    const s = await collect(new Date('2026-08-27T09:00:00Z'));
    // Сверяем с прямым запросом: цифры должны быть одни и те же.
    const direct = await db.query<{ n: number }>(
      `SELECT count(*) FILTER (WHERE registration_no IS NOT NULL)::int AS n FROM users`,
    );
    expect(s.participants.registered).toBe(direct.rows[0]!.n);
    expect(s.participants.kitsIssued).toBe(1);
    expect(s.participants.blocked).toBe(1);
    expect(s.participants.unfinished).toBe(1);
    expect(s.mdg).toMatchObject({ open: 1, join: 1 });
    expect(s.newRequests).toBe(1);
  });

  test('разрез по платформам появляется, когда их больше одной', async () => {
    await seedUser(db, { id: '10', registered: true });
    await seedUser(db, { id: '20', platform: 'max', registered: true });
    const s = await collect(new Date('2026-08-27T09:00:00Z'));
    expect(s.byPlatform.map((p) => p.platform).sort()).toEqual(['max', 'telegram']);
    // Общая цифра — сумма по платформам, а не одна из них.
    expect(s.participants.registered).toBe(2);
  });

  test('дни кампании: видно, что загружено', async () => {
    const campaign = new CampaignRepo(db);
    await campaign.setDay(1, 'Слово первого дня');
    await campaign.setDay(2, 'Слово второго дня');
    await campaign.setDay(7, 'Слово седьмого дня');

    const s = await collect(new Date('2026-08-27T09:00:00Z'));
    expect(s.days.loaded).toBe(3);
    expect(s.days.ranges).toContain('1');
    expect(s.days.list.filter((d) => d.loaded).map((d) => d.day)).toEqual([1, 2, 7]);
    expect(s.days.list).toHaveLength(40);
    expect(s.days.list[0]).toMatchObject({ day: 1, loaded: true });
    expect(s.days.list[2]).toMatchObject({ day: 3, loaded: false });
  });

  test('день кампании считается по календарю', async () => {
    const before = await collect(new Date('2026-08-20T09:00:00Z'));
    expect(before.day.state).toBe('до старта');
    expect(before.day.startDate).toBe('2026-09-01');

    const during = await collect(new Date('2026-09-03T09:00:00Z'));
    expect(during.day.state).toBe('идёт');
    expect(during.day.number).toBe(3);

    const after = await collect(new Date('2026-12-01T09:00:00Z'));
    expect(after.day.state).toBe('завершена');
  });

  test('убранные заявки в счётчик новых не попадают', async () => {
    await db.query(
      `INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', 'Новая', 'Живая', 'ui')`,
    );
    await db.query(
      `INSERT INTO requests (type, status, fio, origin, archived_at)
       VALUES ('join_group', 'Новая', 'Убранная', 'ui', now())`,
    );
    const s = await collect(new Date('2026-08-27T09:00:00Z'));
    expect(s.newRequests).toBe(1);
  });

  test('доставка рассылок: последние сверху со сводкой', async () => {
    await seedUser(db, { id: '30', registered: true });
    const deliveries = new DeliveriesRepo(db);
    await deliveries.open('day:1', 'Слово дня', ['telegram']);

    const s = await collect(new Date('2026-09-02T09:00:00Z'));
    expect(s.broadcasts).toHaveLength(1);
    expect(s.broadcasts[0]).toMatchObject({ key: 'day:1', pending: 1, sent: 0 });
    expect(s.broadcasts[0]!.finished).toBe(false);
  });
});
