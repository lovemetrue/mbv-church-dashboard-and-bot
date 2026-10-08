import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps } from '../src/deps.js';
import { CB } from '../src/core/texts.js';
import { UpdateQueue } from '../src/core/updateQueue.js';
import type { IncomingUpdate, Platform, PlatformName, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Сто человек проходят анкету одновременно: у церкви в день старта кампании так и будет.
 * Проверяем не скорость, а целостность: ни одна анкета не потеряна, номера регистрации
 * не повторяются, у каждого есть своя заявка.
 */
const PEOPLE = 100;
const ADMIN = '999';

let db: Pool;
let tg: FakePlatform;
let router: Router;

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
  const deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
    admins: new Map([['telegram', [ADMIN]]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
  });
  router = new Router(deps);
});

/** Шаги анкеты ведущего МДГ: по одному апдейту, как их присылает платформа. */
const steps = (id: string, phone: string): IncomingUpdate[] => [
  { kind: 'start', ctx: ctx(id) },
  { kind: 'callback', ctx: ctx(id), data: CB.consentYes, callbackId: 'c' },
  { kind: 'text', ctx: ctx(id), text: `Тестов Тест ${'абвгдежзик'[Number(id) % 10]}${'лмнопрстуф'[Math.floor(Number(id) / 10) % 10]}ович` },
  { kind: 'contact', ctx: ctx(id), phone, isOwn: true },
  { kind: 'callback', ctx: ctx(id), data: 'church:0', callbackId: 'c' },
  { kind: 'callback', ctx: ctx(id), data: CB.mdgLeader, callbackId: 'c' },
  { kind: 'callback', ctx: ctx(id), data: CB.confirm, callbackId: 'c' },
];

describe('сто человек одновременно', () => {
  test('через очередь все анкеты доходят до конца, заявки и номера не теряются', async () => {
    const errors: unknown[] = [];
    const queue = new UpdateQueue(16, (e) => errors.push(e));

    // Шаги разных людей перемешаны, как в жизни: каждый по кругу делает следующий шаг.
    const all = Array.from({ length: PEOPLE }, (_, i) => steps(String(1000 + i), `+7900${String(1000000 + i)}`));
    for (let step = 0; step < all[0]!.length; step++) {
      for (const person of all) await queue.submit(person[0]!.ctx.platformUserId, () => router.handle(person[step]!));
    }
    await queue.idle();

    expect(errors).toEqual([]);
    const { rows } = await db.query<{ done: number; numbers: number; requests: number }>(
      `SELECT count(*) FILTER (WHERE complete)::int AS done,
              count(DISTINCT registration_no)::int AS numbers,
              (SELECT count(*)::int FROM requests WHERE type = 'already_leader') AS requests
         FROM users`,
    );
    expect(rows[0]).toEqual({ done: PEOPLE, numbers: PEOPLE, requests: PEOPLE });
  }, 60_000);

  test('двойное нажатие одной и той же кнопки не заводит вторую заявку даже при параллельной очереди', async () => {
    const queue = new UpdateQueue(16, () => {});
    const id = '2000';
    const s = steps(id, '+79001112233');
    for (const u of s.slice(0, -1)) await queue.submit(id, () => router.handle(u));
    // Подтверждение нажато дважды подряд: второе должно упереться в уже заведённую заявку.
    await queue.submit(id, () => router.handle(s.at(-1)!));
    await queue.submit(id, () => router.handle(s.at(-1)!));
    await queue.idle();

    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM requests`);
    expect(rows[0]!.n).toBe(1);
  });
});
