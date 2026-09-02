import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { ADMIN_CB, adminMenu } from '../src/admin/menu.js';
import { CB } from '../src/core/texts.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;

const ADMIN = '999';
const USER = '555';
const RESET_LABEL = '🧹 Очистить базу';

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const text = (t: string, id = ADMIN): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const tap = (data: string, id = ADMIN): IncomingUpdate => ({ kind: 'callback', ctx: ctx(id), data, callbackId: 'cb' });

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

function makeRouter(allowDbReset: boolean): { router: Router; deps: Deps } {
  const deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
    admins: new Map([['telegram', [ADMIN]]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
    allowDbReset,
  });
  return { router: new Router(deps), deps };
}

const toAdmin = () => tg.textsTo(ADMIN).join('\n');
/** Считаем именно заведённого участника: у самого служителя тоже есть строка в users. */
const participantCount = async () =>
  (
    (await db.query('SELECT count(*)::int AS n FROM users WHERE platform_user_id = $1', [USER]))
      .rows[0] as { n: number }
  ).n;

describe('кнопка очистки базы', () => {
  test('при выключенном флаге кнопки в меню нет', () => {
    expect(adminMenu(false).flat().map((b) => b.label)).not.toContain(RESET_LABEL);
  });

  test('при включённом флаге кнопка появляется', () => {
    expect(adminMenu(true).flat().map((b) => b.label)).toContain(RESET_LABEL);
  });

  test('при выключенном флаге команда отказывает и данные целы', async () => {
    const { router } = makeRouter(false);
    await seedUser(db, { id: USER });

    await router.handle(text('/reset'));
    await router.handle(tap(`${ADMIN_CB}reset_confirm`));

    expect(await participantCount()).toBe(1);
    expect(toAdmin()).toMatch(/выключен/i);
  });

  test('перед очисткой бот показывает, что именно удалит', async () => {
    const { router } = makeRouter(true);
    await seedUser(db, { id: USER });

    await router.handle(text(RESET_LABEL));

    expect(toAdmin()).toContain('участник');
    // До подтверждения ничего не удаляется.
    expect(await participantCount()).toBe(1);
  });

  test('подтверждение чистит все таблицы', async () => {
    const { router, deps } = makeRouter(true);
    await seedUser(db, { id: USER });
    await deps.campaign.setDay(1, 'Слово дня');
    await deps.deliveries.open('day:1', 'Слово дня', ['telegram']);

    await router.handle(text(RESET_LABEL));
    await router.handle(tap(`${ADMIN_CB}reset_confirm`));

    for (const table of ['users', 'sessions', 'campaign_days', 'broadcasts', 'deliveries']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0], table).toMatchObject({ n: 0 });
    }
  });

  test('импортированное из таблицы церкви очистка не трогает', async () => {
    const { router, deps } = makeRouter(true);
    await seedUser(db, { id: USER });
    // Данные из выгрузки: группа и заявка, у заявки участника в боте нет.
    await deps.groups.create(
      { leader: 'Из Таблицы', district: 'Невский', format: 'Основная церковь', status: 'Функционирует' },
      'таблица',
    );
    await db.query(
      `INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', 'В работе', 'Пришёл из листа', 'таблица')`,
    );
    // И заявка бота — её очистка обязана убрать.
    await router.handle(tap(CB.menuAsk, USER));
    await router.handle(text('Вопрос от участника кампании', USER));

    await router.handle(text(RESET_LABEL));
    await router.handle(tap(`${ADMIN_CB}reset_confirm`));

    const groups = await db.query(`SELECT count(*)::int AS n FROM groups WHERE source = 'таблица'`);
    const fromSheet = await db.query(`SELECT count(*)::int AS n FROM requests WHERE origin = 'таблица'`);
    const fromBot = await db.query(`SELECT count(*)::int AS n FROM requests WHERE origin = 'бот'`);
    expect(groups.rows[0], 'группы из таблицы').toMatchObject({ n: 1 });
    expect(fromSheet.rows[0], 'заявки из таблицы').toMatchObject({ n: 1 });
    expect(fromBot.rows[0], 'заявки бота').toMatchObject({ n: 0 });
  });

  test('номера регистрации после очистки начинаются с единицы', async () => {
    const { router } = makeRouter(true);
    await seedUser(db, { id: USER });
    await seedUser(db, { id: '777' });

    await router.handle(text(RESET_LABEL));
    await router.handle(tap(`${ADMIN_CB}reset_confirm`));

    const fresh = await seedUser(db, { id: '888' });
    const { rows } = await db.query('SELECT registration_no FROM users WHERE id = $1', [fresh]);
    expect(rows[0]).toMatchObject({ registration_no: 1 });
  });

  test('отмена ничего не удаляет', async () => {
    const { router } = makeRouter(true);
    await seedUser(db, { id: USER });

    await router.handle(text(RESET_LABEL));
    await router.handle(tap(`${ADMIN_CB}cancel`));

    expect(await participantCount()).toBe(1);
  });

  test('подтверждение рассылки базу не чистит: у очистки своя кнопка', async () => {
    const { router } = makeRouter(true);
    await seedUser(db, { id: USER });

    await router.handle(text(RESET_LABEL));
    // Кнопка от другого диалога не должна сработать как согласие на очистку.
    await router.handle(tap(`${ADMIN_CB}confirm`));

    expect(await participantCount()).toBe(1);
  });

  test('обычный участник очистить базу не может', async () => {
    const { router } = makeRouter(true);
    await seedUser(db, { id: USER });

    await router.handle(text(RESET_LABEL, USER));
    await router.handle(tap(`${ADMIN_CB}reset_confirm`, USER));

    expect(await participantCount()).toBe(1);
  });
});
