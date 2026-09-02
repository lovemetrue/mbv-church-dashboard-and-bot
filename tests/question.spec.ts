import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB } from '../src/core/texts.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll, seedUser } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;
let router: Router;

const ADMIN = '999';
const USER = '555';

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const text = (t: string, id = USER): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const tap = (data: string, id = USER): IncomingUpdate => ({ kind: 'callback', ctx: ctx(id), data, callbackId: 'cb' });

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
  router = new Router(deps);
  await seedUser(db, { id: USER, registered: true });
});

const rows = async () =>
  (await db.query<{ type: string; text: string | null; status: string }>(
    'SELECT type, text, status FROM requests ORDER BY id',
  )).rows;

describe('вопрос от участника доходит до служителя', () => {
  test('вопрос попадает в базу и уведомление уходит служителю', async () => {
    await router.handle(tap(CB.menuAsk));
    await router.handle(text('Можно ли прийти с ребёнком трёх лет?'));

    expect(await rows()).toEqual([
      { type: 'question', text: 'Можно ли прийти с ребёнком трёх лет?', status: 'Новая' },
    ]);
    const toAdmin = tg.textsTo(ADMIN).join('\n');
    expect(toAdmin).toContain('вопрос');
    expect(toAdmin).toContain('Можно ли прийти с ребёнком');
  });

  test('«Отмена» на шаге вопроса заявку не создаёт', async () => {
    await router.handle(tap(CB.menuAsk));
    await router.handle(tap(CB.cancelQuestion));
    expect(await rows()).toEqual([]);
  });

  test('короткий вопрос не создаёт заявку, но следующий проходит', async () => {
    await router.handle(tap(CB.menuAsk));
    await router.handle(text('??'));
    expect(await rows()).toEqual([]);

    await router.handle(text('А во сколько начало в воскресенье?'));
    expect((await rows())).toHaveLength(1);
  });

  test('три вопроса можно, четвёртый — нет, пока служитель не ответил', async () => {
    for (const q of ['Первый вопрос про группы', 'Второй вопрос про время', 'Третий вопрос про адрес']) {
      await router.handle(tap(CB.menuAsk));
      await router.handle(text(q));
    }
    expect(await rows()).toHaveLength(3);

    await router.handle(tap(CB.menuAsk));
    const said = tg.textsTo(USER).join('\n');
    expect(said).toContain('три вопроса');
    // Текст после отказа новой заявкой не становится.
    await router.handle(text('Четвёртый вопрос, который не должен пройти'));
    expect(await rows()).toHaveLength(3);
  });

  test('после закрытия заявки служителем вопросы снова принимаются', async () => {
    for (const q of ['Вопрос номер один', 'Вопрос номер два', 'Вопрос номер три']) {
      await router.handle(tap(CB.menuAsk));
      await router.handle(text(q));
    }
    await db.query("UPDATE requests SET status = 'Исполнена' WHERE id = (SELECT min(id) FROM requests)");

    await router.handle(tap(CB.menuAsk));
    await router.handle(text('Четвёртый вопрос, теперь место освободилось'));
    expect(await rows()).toHaveLength(4);
  });
});
