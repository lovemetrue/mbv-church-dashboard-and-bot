import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB, T } from '../src/core/texts.js';
import { ADMIN_CB, ADMIN_MENU, commandByLabel } from '../src/admin/menu.js';
import type { IncomingUpdate, Platform, PlatformName, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let mx: FakePlatform;
let deps: Deps;
let router: Router;

const ADMIN = '999';

const ctx = (id: string, platform: PlatformName = 'telegram'): UpdateCtx => ({ platform, platformUserId: id, chatId: id });
const text = (t: string, id = ADMIN): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const tap = (data: string, id = ADMIN, platform: PlatformName = 'telegram'): IncomingUpdate => ({
  kind: 'callback', ctx: ctx(id, platform), data, callbackId: 'cb-1',
});
const textAs = (t: string, id: string, platform: PlatformName): IncomingUpdate => ({ kind: 'text', ctx: ctx(id, platform), text: t });

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });

function build(extraQuestions = 'all'): void {
  tg = new FakePlatform('telegram');
  mx = new FakePlatform('max');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg], ['max', mx]]),
    admins: new Map([['telegram', [ADMIN]], ['max', []]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
    extraQuestions,
  });
  router = new Router(deps);
}

beforeEach(async () => {
  await truncateAll(db);
  build();
  await seedUser(db, { id: ADMIN, mdgStatus: null });
});

const toAdmin = () => tg.textsTo(ADMIN).join('\n');
const invitations = (p: FakePlatform, id: string) => p.sent.filter((m) => m.chatId === id && m.buttons);

describe('кнопка и команда служителя', () => {
  test('на клавиатуре служителя есть «Дослать вопросы», и она вызывает /extra', () => {
    const label = ADMIN_MENU.flat().find((b) => b.command === '/extra')?.label;
    expect(label).toBeDefined();
    expect(commandByLabel(label!)).toBe('/extra');
  });

  test('перед отправкой бот пишет, сколько человек получат приглашение, и просит подтвердить', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    await seedUser(db, { id: '3', mdgStatus: 'open' });
    await seedUser(db, { id: '4', mdgStatus: 'member' });

    await router.handle(text('/extra'));

    expect(toAdmin()).toContain('3 человека');
    expect(toAdmin()).toContain(T.followUpInviteJoin);
    expect(toAdmin()).toContain(T.followUpInviteLead);
    const ask = tg.sent.filter((m) => m.chatId === ADMIN).at(-1)!;
    expect(ask.buttons?.flat().map((b) => (b.kind === 'callback' ? b.data : ''))).toContain(`${ADMIN_CB}confirm`);
    // До подтверждения никому ничего не ушло.
    expect(invitations(tg, '1')).toEqual([]);
  });

  test('подтверждение рассылает приглашения с кнопками: ищущим и открывающим — каждому свой текст', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '3', mdgStatus: 'open' });
    await seedUser(db, { id: '4', mdgStatus: 'member' });

    await router.handle(text('/extra'));
    await router.handle(tap(`${ADMIN_CB}confirm`));

    expect(invitations(tg, '1').map((m) => m.text)).toEqual([T.followUpInviteJoin]);
    expect(invitations(tg, '3').map((m) => m.text)).toEqual([T.followUpInviteLead]);
    const kinds = invitations(tg, '1')[0]!.buttons!.flat().map((b) => (b.kind === 'callback' ? b.data : ''));
    expect(kinds).toEqual([CB.extraStart, CB.extraLater]);
    expect(tg.sent.filter((m) => m.chatId === '4')).toEqual([]);
    expect(toAdmin()).toContain('2');
  });

  test('приглашения идут и в MAX, не только в Telegram', async () => {
    await seedUser(db, { id: '10', mdgStatus: 'join', platform: 'max' });
    await router.handle(text('/extra'));
    await router.handle(tap(`${ADMIN_CB}confirm`));
    expect(invitations(mx, '10')).toHaveLength(1);
  });

  test('отмена ничего не рассылает', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await router.handle(text('/extra'));
    await router.handle(tap(`${ADMIN_CB}cancel`));
    expect(tg.sent.filter((m) => m.chatId === '1')).toEqual([]);
    expect((await deps.users.followUpCandidates(['telegram'])).length).toBe(1);
  });

  test('второй запуск не пишет тем, кому уже отправили', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await router.handle(text('/extra'));
    await router.handle(tap(`${ADMIN_CB}confirm`));
    tg.sent.length = 0;

    await router.handle(text('/extra'));

    expect(toAdmin()).toContain('Некому');
    await router.handle(tap(`${ADMIN_CB}confirm`));
    expect(tg.sent.filter((m) => m.chatId === '1')).toEqual([]);
  });

  test('«Отправить» без предварительного /extra ничего не рассылает', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await router.handle(tap(`${ADMIN_CB}confirm`));
    expect(tg.sent.filter((m) => m.chatId === '1')).toEqual([]);
  });

  test('обычный участник команду /extra не выполняет', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    await router.handle(textAs('/extra', '1', 'telegram'));
    expect(tg.sent.filter((m) => m.chatId === '2')).toEqual([]);
  });
});

describe('настройка EXTRA_QUESTIONS решает, кому писать', () => {
  beforeEach(async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
  });

  test('«off» — никому: бот прямо говорит почему', async () => {
    build('off');
    await router.handle(text('/extra'));
    expect(toAdmin()).toContain('EXTRA_QUESTIONS');
    expect(toAdmin()).toContain('Некому');
  });

  test('список id — только перечисленным, остальные остаются на потом', async () => {
    build('telegram:2');
    await router.handle(text('/extra'));
    expect(toAdmin()).toContain('1 человек');
    await router.handle(tap(`${ADMIN_CB}confirm`));
    expect(invitations(tg, '2')).toHaveLength(1);
    expect(invitations(tg, '1')).toEqual([]);
    expect((await deps.users.followUpCandidates(['telegram'])).map((c) => c.platform_user_id)).toEqual(['1']);
  });
});

describe('человек отвечает на приглашение', () => {
  test('«Ответить», два ответа — и они в его анкете; регистрация и заявка не меняются', async () => {
    const id = await seedUser(db, { id: '1', mdgStatus: 'join' });
    await db.query(`INSERT INTO requests (user_id, type, origin) VALUES ($1, 'join_group', 'бот')`, [id]);
    const before = (await db.query('SELECT registration_no FROM users WHERE id = $1', [id])).rows[0];

    await router.handle(tap(CB.extraStart, '1'));
    expect(tg.textsTo('1').at(-1)).toContain('Когда вам удобно');
    await router.handle(textAs('пн, ср - с 17 до 22 часов', '1', 'telegram'));
    expect(tg.textsTo('1').at(-1)).toContain('На какой улице');
    await router.handle(textAs('ул Рылеева 32', '1', 'telegram'));
    expect(tg.textsTo('1').at(-1)).toBe(T.followUpThanks);

    expect((await db.query('SELECT schedule_raw, address_raw FROM users WHERE id = $1', [id])).rows[0])
      .toEqual({ schedule_raw: 'пн, ср - с 17 до 22 часов', address_raw: 'ул Рылеева 32' });
    expect((await db.query('SELECT registration_no FROM users WHERE id = $1', [id])).rows[0]).toEqual(before);
    expect((await db.query('SELECT count(*)::int AS n FROM requests')).rows[0]).toEqual({ n: 1 });
  });

  test('ответ из MAX работает так же', async () => {
    await seedUser(db, { id: '10', mdgStatus: 'open', platform: 'max' });
    await router.handle(tap(CB.extraStart, '10', 'max'));
    await router.handle(textAs('пятница вечером', '10', 'max'));
    await router.handle(textAs('ул Рылеева 32', '10', 'max'));
    expect((await db.query(`SELECT schedule_raw, address_raw FROM users WHERE platform_user_id = '10'`)).rows[0])
      .toEqual({ schedule_raw: 'пятница вечером', address_raw: 'ул Рылеева 32' });
  });

  test('ответившему повторное приглашение не уйдёт', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await router.handle(tap(CB.extraStart, '1'));
    await router.handle(textAs('вечером', '1', 'telegram'));
    await router.handle(textAs('ул Рылеева 32', '1', 'telegram'));
    expect(await deps.users.followUpCandidates(['telegram'])).toEqual([]);
  });

  test('«Не сейчас»: ответ вежливый, в анкету ничего не пишется', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await router.handle(tap(CB.extraLater, '1'));
    expect(tg.textsTo('1').at(-1)).toBe(T.followUpLater);
    expect((await db.query(`SELECT schedule_raw FROM users WHERE platform_user_id = '1'`)).rows[0]).toEqual({ schedule_raw: null });
  });
});
