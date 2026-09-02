import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { CampaignScheduler } from '../src/broadcast/scheduler.js';
import { createDeps, type Deps } from '../src/deps.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;

const ADMIN = '999';
const schedule = { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' };

/** 07:00 МСК первого дня кампании. */
const day1Morning = new Date('2026-09-01T04:00:00Z');
const day1Night = new Date('2026-09-01T02:00:00Z');
const day2Morning = new Date('2026-09-02T04:00:00Z');

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
    admins: new Map([['telegram', [ADMIN]]]),
    schedule,
    broadcastRate: 1000,
  });
});

const scheduler = (now: () => Date) => new CampaignScheduler(deps, now);
const participantTexts = () => tg.sent.filter((m) => m.chatId !== ADMIN).map((m) => m.text);

describe('ежедневная рассылка', () => {
  test('до времени рассылки ничего не отправляется', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(1, 'Слово первого дня');

    await scheduler(() => day1Night).tick();

    expect(participantTexts()).toEqual([]);
  });

  test('в назначенное время материал дня уходит участникам', async () => {
    await seedUser(db, { id: '100' });
    await seedUser(db, { id: '200' });
    await deps.campaign.setDay(1, 'Слово первого дня');

    await scheduler(() => day1Morning).tick();

    expect(participantTexts()).toEqual(['Слово первого дня', 'Слово первого дня']);
  });

  test('повторный тик в тот же день не дублирует рассылку', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(1, 'Слово первого дня');
    const s = scheduler(() => day1Morning);

    await s.tick();
    await s.tick();
    await s.tick();

    expect(participantTexts()).toEqual(['Слово первого дня']);
  });

  test('следующий день отправляется как отдельная рассылка', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(1, 'День 1');
    await deps.campaign.setDay(2, 'День 2');

    let now = day1Morning;
    const s = scheduler(() => now);
    await s.tick();
    now = day2Morning;
    await s.tick();

    expect(participantTexts()).toEqual(['День 1', 'День 2']);
  });

  test('если материал дня не загружен, рассылки нет', async () => {
    await seedUser(db, { id: '100' });

    await scheduler(() => day1Morning).tick();

    expect(participantTexts()).toEqual([]);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM broadcasts');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('о незагруженном материале админа предупреждают один раз', async () => {
    await seedUser(db, { id: '100' });
    const s = scheduler(() => day1Morning);

    await s.tick();
    await s.tick();

    const warnings = tg.textsTo(ADMIN).filter((t) => t.includes('не загружен'));
    expect(warnings).toHaveLength(1);
  });

  test('человек, зарегистрировавшийся после рассылки, получает её при следующем тике', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(1, 'Слово первого дня');
    const s = scheduler(() => day1Morning);
    await s.tick();

    await seedUser(db, { id: '200' });
    await s.tick();

    expect(tg.sent.filter((m) => m.chatId === '200').map((m) => m.text)).toEqual(['Слово первого дня']);
  });

  test('до начала кампании тик ничего не делает', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(1, 'Слово первого дня');

    await scheduler(() => new Date('2026-08-20T09:00:00Z')).tick();

    expect(participantTexts()).toEqual([]);
  });

  test('после окончания кампании тик ничего не делает', async () => {
    await seedUser(db, { id: '100' });
    await deps.campaign.setDay(40, 'Последний день');

    await scheduler(() => new Date('2026-10-15T09:00:00Z')).tick();

    expect(participantTexts()).toEqual([]);
  });
});
