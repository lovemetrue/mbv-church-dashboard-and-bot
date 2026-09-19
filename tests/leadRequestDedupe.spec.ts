import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB, T } from '../src/core/texts.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Сверка телефона на заявке «хочу открыть домашнюю группу».
 *
 * Запрет на повтор до этого висел на user.id, а users у нас отдельные на каждую
 * платформу: один и тот же человек мог подать заявку и из Telegram, и из MAX, и
 * служители получали её дважды. Телефон — настоящий признак человека, поэтому
 * сверяем по нему: с открытыми заявками и с действующими группами реестра.
 */
const PHONE = '+79001234567';
const ADMIN = '999';

let db: Pool;
let tg: FakePlatform;
let max: FakePlatform;
let deps: Deps;
let router: Router;

const ctx = (id: string, platform: PlatformName = 'telegram'): UpdateCtx =>
  ({ platform, platformUserId: id, chatId: id });
const tapLead = (id: string, platform: PlatformName = 'telegram'): IncomingUpdate =>
  ({ kind: 'callback', ctx: ctx(id, platform), data: CB.menuLead, callbackId: 'cb-1' });

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
  max = new FakePlatform('max');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg], ['max', max]]),
    admins: new Map([['telegram', [ADMIN]]]),
    // Далеко в будущем: большинство тестов этого файла проверяют поведение вне
    // кампании. Тест на ослабление правила на время кампании ниже сам строит
    // свой Router с датой начала «сегодня».
    schedule: { startDate: '2099-01-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
  });
  router = new Router(deps);
});

const leadRequests = async () => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM requests WHERE type = 'lead_group'`,
  );
  return rows[0]!.n;
};

/** Группа реестра с этим номером у ведущего. */
const seedGroup = (status: string, phone = PHONE) =>
  db.query(
    `INSERT INTO groups (leader, district, format, status, phone, phones, source)
     VALUES ('Петров Пётр', 'Приморский', 'Молодежная', $1, $2, ARRAY[$2], 'таблица')`,
    [status, phone],
  );

describe('заявка на открытие группы: сверка телефона', () => {
  /*
   * Раньше открытая заявка по телефону блокировала повторную регистрацию с любого
   * аккаунта — но заявка могла остаться «В работе» в дашборде и после того, как
   * саму группу закрыли, и бот отказывал в регистрации человеку, которого по
   * дашборду «как будто и нет в ведущих». По правкам церкви эту сверку убрали:
   * теперь смотрим только на действующую группу реестра (ниже).
   */
  test('второй аккаунт с тем же номером тоже может подать заявку — сверка по заявке убрана', async () => {
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));
    expect(await leadRequests()).toBe(1);

    // Тот же человек из MAX: user другой, телефон тот же.
    await seedUser(db, { id: '222', platform: 'max', phone: PHONE });
    await router.handle(tapLead('222', 'max'));

    expect(await leadRequests()).toBe(2);
  });

  test('в анкете отказ приходит сразу на выборе, а не после района и возраста', async () => {
    // Так было: человек заполнял район и возраст и получал отказ вплотную
    // с «вы зарегистрированы» — два противоречащих сообщения подряд.
    await seedGroup('Функционирует');
    const userId = await seedUser(db, { id: '111', phone: PHONE, registered: false });
    // Сажаем человека ровно на вопрос про малую группу: обязательные ответы уже даны.
    await db.query(
      `INSERT INTO sessions (user_id, state, data) VALUES ($1, 'await_mdg', $2)
       ON CONFLICT (user_id) DO UPDATE SET state = 'await_mdg', data = $2`,
      [userId, JSON.stringify({ consent: true, fio: 'Тестов Тест', phone: PHONE, church: 'МБВ Колизей' })],
    );
    await router.handle({ kind: 'callback', ctx: ctx('111'), data: CB.mdgOpen, callbackId: 'c' });

    const said = tg.textsTo('111').join('\n');
    expect(said).toContain('уже записана действующая');
    expect(said).not.toContain('Напишите, пожалуйста, район');
  });

  test('другой номер заявку подать может: сверка не ловит лишних', async () => {
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));

    await seedUser(db, { id: '333', phone: '+79007654321' });
    await router.handle(tapLead('333'));

    expect(await leadRequests()).toBe(2);
  });

  test('ведущий действующей группы заявку не подаёт', async () => {
    await seedGroup('Функционирует');
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));

    expect(await leadRequests()).toBe(0);
    expect(tg.textsTo('111').join('\n')).toContain(T.leadPhoneIsLeader);
  });

  test('ведущий закрытой группы открыть новую может', async () => {
    // Закрытая и приостановленная группа не мешают: у человека сейчас группы нет.
    await seedGroup('Закрыта');
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));

    expect(await leadRequests()).toBe(1);
  });

  test('группа на паузе тоже не мешает', async () => {
    await seedGroup('На паузе');
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));

    expect(await leadRequests()).toBe(1);
  });

  test('свой повторный клик объясняет по-прежнему про уже принятую заявку', async () => {
    // Тут причина другая — заявка этого же аккаунта, — и текст должен остаться прежним.
    await seedUser(db, { id: '111', phone: PHONE });
    await router.handle(tapLead('111'));
    await router.handle(tapLead('111'));

    expect(await leadRequests()).toBe(1);
    expect(tg.textsTo('111').join('\n')).toContain(T.leadRequestPending);
  });

  test('на время кампании ведущий действующей группы может открыть ещё одну', async () => {
    // «Сегодня» — чтобы тест не зависел от календарной даты запуска.
    const today = new Date().toISOString().slice(0, 10);
    const campaignRouter = new Router(createDeps({
      ...deps.raw,
      schedule: { ...deps.raw.schedule, startDate: today },
    }));

    await seedGroup('Функционирует');
    await seedUser(db, { id: '111', phone: PHONE });
    await campaignRouter.handle(tapLead('111'));

    expect(await leadRequests()).toBe(1);
  });
});
