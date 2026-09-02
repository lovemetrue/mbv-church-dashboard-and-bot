import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { BroadcastSender } from '../src/broadcast/sender.js';
import { DeliveriesRepo } from '../src/db/repos/deliveries.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { SendError, type PlatformName, type Platform } from '../src/core/platform.js';
import { RateLimiter } from '../src/broadcast/throttle.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let deliveries: DeliveriesRepo;
let users: UsersRepo;

beforeAll(async () => {
  db = await setupTestDb();
  deliveries = new DeliveriesRepo(db);
  users = new UsersRepo(db);
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** Отправщик без реальных пауз: частота высокая, чтобы тесты не ждали. */
function makeSender(platforms: Map<PlatformName, Platform>) {
  const limiters = new Map<PlatformName, RateLimiter>();
  for (const name of platforms.keys()) limiters.set(name, new RateLimiter(1000));
  return new BroadcastSender({ deliveries, users, platforms, limiters, maxAttempts: 3 });
}

const single = (tg: FakePlatform) => new Map<PlatformName, Platform>([['telegram', tg]]);

describe('очередь рассылки', () => {
  test('в очередь попадают только участники с завершённой анкетой', async () => {
    await seedUser(db, { id: '1' });
    await seedUser(db, { id: '2' });
    await seedUser(db, { id: '3', registered: false });

    const { created, queued } = await deliveries.open('day:1', 'Слово дня', ['telegram']);

    expect(created).toBe(true);
    expect(queued).toBe(2);
  });

  test('заблокировавшие бота в очередь не попадают', async () => {
    await seedUser(db, { id: '1' });
    await seedUser(db, { id: '2', blocked: true });

    const { queued } = await deliveries.open('day:1', 'Слово дня', ['telegram']);
    expect(queued).toBe(1);
  });

  test('участники выключенной платформы не попадают в очередь', async () => {
    await seedUser(db, { id: '1', platform: 'telegram' });
    await seedUser(db, { id: '2', platform: 'max' });

    const { queued } = await deliveries.open('day:1', 'Слово дня', ['telegram']);
    expect(queued).toBe(1);
  });

  test('повторное открытие того же дня не создаёт вторую рассылку', async () => {
    await seedUser(db, { id: '1' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);

    const second = await deliveries.open('day:1', 'Слово дня', ['telegram']);

    expect(second.created).toBe(false);
    expect(second.queued).toBe(0);
  });

  test('новый участник получает следующую рассылку, но не предыдущую', async () => {
    await seedUser(db, { id: '1' });
    await deliveries.open('day:1', 'День 1', ['telegram']);
    await seedUser(db, { id: '2' });

    const again = await deliveries.open('day:1', 'День 1', ['telegram']);
    const next = await deliveries.open('day:2', 'День 2', ['telegram']);

    expect(again.queued).toBe(1); // догоняющая доставка тому, кто зарегистрировался позже
    expect(next.queued).toBe(2);
  });
});

describe('отправка рассылки', () => {
  test('сообщение доходит до всех участников очереди', async () => {
    await seedUser(db, { id: '100' });
    await seedUser(db, { id: '200' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    const tg = new FakePlatform();

    const result = await makeSender(single(tg)).run('day:1');

    expect(tg.sent.map((m) => m.chatId).sort()).toEqual(['100', '200']);
    expect(tg.sent[0]?.text).toBe('Слово дня');
    expect(result.sent).toBe(2);
  });

  test('после отправки всем рассылка помечается завершённой', async () => {
    await seedUser(db, { id: '100' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);

    await makeSender(single(new FakePlatform())).run('day:1');

    expect(await deliveries.unfinishedKeys()).toEqual([]);
  });

  test('повторный прогон завершённой рассылки никому ничего не отправляет', async () => {
    await seedUser(db, { id: '100' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    await makeSender(single(new FakePlatform())).run('day:1');

    const tg = new FakePlatform();
    await makeSender(single(tg)).run('day:1');

    expect(tg.sent).toEqual([]);
  });

  test('рестарт посреди рассылки досылает только недоставленных', async () => {
    await seedUser(db, { id: '100' });
    await seedUser(db, { id: '200' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);

    // Первый прогон: связь со вторым участником отвалилась насовсем.
    const crashing = new FakePlatform();
    const fatal = new SendError('other', 'сеть отвалилась');
    crashing.program('200', fatal, fatal, fatal);
    await makeSender(single(crashing)).run('day:1');
    expect(crashing.sent.map((m) => m.chatId)).toEqual(['100']);

    // Возвращаем в очередь упавшую доставку, как это делает админская команда «дослать».
    await db.query(`UPDATE deliveries SET status = 'pending', attempts = 0 WHERE status = 'failed'`);
    const retry = new FakePlatform();
    await makeSender(single(retry)).run('day:1');

    expect(retry.sent.map((m) => m.chatId)).toEqual(['200']);
  });

  test('«слишком часто» приводит к повторной попытке и доставке', async () => {
    await seedUser(db, { id: '100' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    const tg = new FakePlatform();
    tg.program('100', new SendError('rate_limited', 'too many requests', 5));

    const result = await makeSender(single(tg)).run('day:1');

    expect(tg.sent.map((m) => m.chatId)).toEqual(['100']);
    expect(result.sent).toBe(1);
  });

  test('заблокировавший бота помечается и выпадает из следующей рассылки', async () => {
    const userId = await seedUser(db, { id: '100' });
    await seedUser(db, { id: '200' });
    await deliveries.open('day:1', 'День 1', ['telegram']);
    const tg = new FakePlatform();
    tg.program('100', new SendError('blocked', 'bot was blocked by the user'));

    const result = await makeSender(single(tg)).run('day:1');

    expect(result.blocked).toBe(1);
    expect((await users.findById(userId))?.blocked_at).toBeInstanceOf(Date);
    const next = await deliveries.open('day:2', 'День 2', ['telegram']);
    expect(next.queued).toBe(1);
  });

  test('постоянная ошибка списывается после трёх попыток и не вешает рассылку', async () => {
    await seedUser(db, { id: '100' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    const tg = new FakePlatform();
    const err = new SendError('other', 'внутренняя ошибка платформы');
    tg.program('100', err, err, err, err, err);

    const result = await makeSender(single(tg)).run('day:1');

    expect(result.failed).toBe(1);
    expect(await deliveries.pendingCount('day:1')).toBe(0);
    expect((await deliveries.summary('day:1'))['failed']).toBe(1);
  });

  test('сбой у одного участника не мешает доставке остальным', async () => {
    await seedUser(db, { id: '100' });
    await seedUser(db, { id: '200' });
    await seedUser(db, { id: '300' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    const tg = new FakePlatform();
    const err = new SendError('other', 'сбой');
    tg.program('200', err, err, err);

    const result = await makeSender(single(tg)).run('day:1');

    expect(tg.sent.map((m) => m.chatId).sort()).toEqual(['100', '300']);
    expect(result).toMatchObject({ sent: 2, failed: 1 });
  });

  test('рассылка идёт в обе платформы одновременно', async () => {
    await seedUser(db, { id: '100', platform: 'telegram' });
    await seedUser(db, { id: '900', platform: 'max' });
    await deliveries.open('day:1', 'Слово дня', ['telegram', 'max']);
    const tg = new FakePlatform('telegram');
    const max = new FakePlatform('max');

    await makeSender(
      new Map<PlatformName, Platform>([
        ['telegram', tg],
        ['max', max],
      ]),
    ).run('day:1');

    expect(tg.sent.map((m) => m.chatId)).toEqual(['100']);
    expect(max.sent.map((m) => m.chatId)).toEqual(['900']);
  });

  test('незавершённые рассылки продолжаются после перезапуска процесса', async () => {
    await seedUser(db, { id: '100' });
    await deliveries.open('day:1', 'Слово дня', ['telegram']);
    const tg = new FakePlatform();

    const results = await makeSender(single(tg)).resumeUnfinished();

    expect(tg.sent.map((m) => m.chatId)).toEqual(['100']);
    expect(results).toHaveLength(1);
  });
});
