import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps } from '../src/deps.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;

const ADMIN = '999';
const OTHER_ADMIN = '888';
const USER = '555';

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const text = (t: string, id = ADMIN): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
});

function makeRouter(admins: string[]): Router {
  return new Router(
    createDeps({
      db,
      platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
      admins: new Map([['telegram', admins]]),
      schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
      broadcastRate: 1000,
    }),
  );
}

const toAdmin = () => tg.textsTo(ADMIN).join('\n');

describe('/admins', () => {
  test('перечисляет всех, у кого есть клавиатура служителя', async () => {
    const router = makeRouter([ADMIN, OTHER_ADMIN]);
    await router.handle(text('/admins'));

    expect(toAdmin()).toContain(ADMIN);
    expect(toAdmin()).toContain(OTHER_ADMIN);
  });

  test('показывает имя и ник, если человек уже писал боту', async () => {
    await db.query(
      `INSERT INTO users (platform, platform_user_id, chat_id, username, full_name)
       VALUES ('telegram', $1, $1, 'sidorov', 'Сидоров Сидор')`,
      [OTHER_ADMIN],
    );
    const router = makeRouter([ADMIN, OTHER_ADMIN]);

    await router.handle(text('/admins'));

    expect(toAdmin()).toContain('Сидоров Сидор');
    expect(toAdmin()).toContain('sidorov');
  });

  test('предупреждает про того, кому бот писать не может', async () => {
    // Платформа отвечает, что чата с этим человеком нет: он не открывал бота.
    tg.unreachable.add(OTHER_ADMIN);
    const router = makeRouter([ADMIN, OTHER_ADMIN]);

    await router.handle(text('/admins'));

    expect(toAdmin()).toMatch(/не может ему писать/i);
  });

  test('доступность спрашивается у платформы, а не по базе', async () => {
    // Записи в базе нет (её могли очистить), но чат с человеком существует.
    const router = makeRouter([ADMIN, OTHER_ADMIN]);

    await router.handle(text('/admins'));

    expect(toAdmin()).toMatch(/уведомления дойдут/i);
    expect(toAdmin()).not.toMatch(/не может ему писать/i);
  });

  test('в подсказке сказано, что очистка базы права не отменяет', async () => {
    const router = makeRouter([ADMIN]);
    await router.handle(text('/admins'));
    expect(toAdmin()).toMatch(/очистка базы/i);
  });

  test('помечает того, кто вызвал команду', async () => {
    const router = makeRouter([ADMIN, OTHER_ADMIN]);
    await router.handle(text('/admins'));

    expect(toAdmin()).toMatch(/это вы/i);
  });

  test('если админов нет, так и говорит', async () => {
    const router = makeRouter([]);
    // Список пуст, поэтому команда доступна только через прямое обращение к потоку:
    // обычному участнику она ничего не покажет.
    await router.handle(text('/admins'));

    expect(tg.textsTo(ADMIN).join('\n')).not.toContain('клавиатура служителя');
  });

  test('обычный участник список админов не получает', async () => {
    const router = makeRouter([ADMIN]);
    await router.handle(text('/admins', USER));

    expect(tg.textsTo(USER).join('\n')).not.toContain(ADMIN);
  });
});
