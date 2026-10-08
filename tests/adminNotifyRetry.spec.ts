import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { AdminNotifier } from '../src/admin/notify.js';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB } from '../src/core/texts.js';
import { SendError, type IncomingUpdate, type Platform, type PlatformName, type UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Когда много людей заканчивают анкету разом, служителю летит пачка уведомлений, и
 * Telegram отвечает «слишком часто» (429). Раньше такое уведомление просто терялось
 * (в логе только предупреждение), и о человеке служитель узнавал лишь из дашборда.
 */
const ADMIN = '999';
let db: Pool;
let tg: FakePlatform;
let deps: Deps;

const tooOften = () => new SendError('rate_limited', 'Too Many Requests', 5);

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
    admins: new Map([['telegram', [ADMIN]]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
  });
});

describe('уведомление служителя при «слишком часто»', () => {
  test('после 429 ждёт и повторяет, пока не дойдёт', async () => {
    tg.program(ADMIN, tooOften(), tooOften());
    await new AdminNotifier(deps).broadcast('Новая заявка');
    expect(tg.textsTo(ADMIN)).toEqual(['Новая заявка']);
  });

  test('если платформа так и не пускает, сдаётся и пишет в лог, а не зависает', async () => {
    tg.program(ADMIN, ...Array.from({ length: 10 }, tooOften));
    await new AdminNotifier(deps).broadcast('Новая заявка');
    expect(tg.textsTo(ADMIN)).toEqual([]);
  });

  test('блокировка бота не повторяется: толку ждать нет', async () => {
    tg.program(ADMIN, new SendError('blocked', 'bot was blocked'));
    await new AdminNotifier(deps).broadcast('Новая заявка');
    // Один вызов потрачен на блокировку, второго не было: очередь программы осталась пустой.
    expect(tg.textsTo(ADMIN)).toEqual([]);
  });
});

describe('уведомления не держат место в очереди апдейтов', () => {
  const ctx: UpdateCtx = { platform: 'telegram', platformUserId: '555', chatId: '555' };
  const finishLeader = async (router: Router): Promise<void> => {
    const steps: IncomingUpdate[] = [
      { kind: 'start', ctx },
      { kind: 'callback', ctx, data: CB.consentYes, callbackId: 'c' },
      { kind: 'text', ctx, text: 'Иванов Иван Иванович' },
      { kind: 'contact', ctx, phone: '79001234567', isOwn: true },
      { kind: 'callback', ctx, data: 'church:0', callbackId: 'c' },
      { kind: 'callback', ctx, data: CB.mdgLeader, callbackId: 'c' },
    ];
    for (const s of steps) await router.handle(s);
    await router.handle({ kind: 'callback', ctx, data: CB.confirm, callbackId: 'c' });
  };

  test('в фоновом режиме handle возвращается, не дожидаясь отправки служителю; drain её дожидается', async () => {
    const router = new Router(deps, { backgroundNotify: true });
    // Служитель недоступен какое-то время: два 429 подряд, каждый с паузой.
    tg.program(ADMIN, new SendError('rate_limited', 'x', 200), new SendError('rate_limited', 'x', 200));
    await finishLeader(router);
    expect(tg.textsTo(ADMIN)).toEqual([]);
    await router.drain();
    expect(tg.textsTo(ADMIN).join('\n')).toContain('Заявка №');
  });

  test('без фонового режима всё как раньше: уведомление ушло к моменту возврата', async () => {
    const router = new Router(deps);
    await finishLeader(router);
    expect(tg.textsTo(ADMIN).join('\n')).toContain('Заявка №');
  });
});
