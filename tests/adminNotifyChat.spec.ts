import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { AdminNotifier } from '../src/admin/notify.js';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import type { IncomingUpdate, PlatformName, Platform } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/*
 * В MAX id чата не равен id человека: бот отвечает участнику в чат 428149719,
 * а сам человек — 27637540. Уведомления служителям уходили на id человека и
 * падали «404: Chat not found», хотя переписка с ботом у служителей была.
 */
let db: Pool;
let max: FakePlatform;
let deps: Deps;

const ADMIN = '27637540';
const ADMIN_CHAT = '428149719';

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  max = new FakePlatform('max');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['max', max]]),
    admins: new Map([['max', [ADMIN]]]),
    schedule: { startDate: '2026-11-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
  });
});

describe('куда бот пишет служителю', () => {
  test('в MAX уведомление уходит в запомненный чат, а не на id человека', async () => {
    await seedUser(db, { platform: 'max', id: ADMIN, chatId: ADMIN_CHAT });

    await new AdminNotifier(deps).broadcast('Материал дня 1 не загружен.');

    expect(max.sent.map((s) => s.chatId)).toEqual([ADMIN_CHAT]);
  });

  test('пока служитель боту не написал, чата мы не знаем — пишем на его id, как раньше', async () => {
    await new AdminNotifier(deps).broadcast('Материал дня 1 не загружен.');

    expect(max.sent.map((s) => s.chatId)).toEqual([ADMIN]);
  });

  test('«/admins» спрашивает доступность про чат: иначе он врёт, что писать нельзя', async () => {
    await seedUser(db, { platform: 'max', id: ADMIN, chatId: ADMIN_CHAT });
    // Про id человека MAX отвечает «чат не найден» — на этом /admins и обманывался.
    max.unreachable.add(ADMIN);
    const cmd: IncomingUpdate = {
      kind: 'text',
      ctx: { platform: 'max', platformUserId: ADMIN, chatId: ADMIN_CHAT },
      text: '/admins',
    };

    await new Router(deps).handle(cmd);

    expect(max.textsTo(ADMIN_CHAT).join('\n')).toContain('уведомления дойдут');
  });
});
