import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { createBotSettings } from '../src/home-groups/botSettings.js';
import { createExtraInvites } from '../src/core/extraInvites.js';
import { createDeps } from '../src/deps.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { T } from '../src/core/texts.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const make = (env = 'off') => createBotSettings({ settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: env });
const stored = async () => (await db.query(`SELECT value FROM app_settings WHERE key = 'bot.extra_questions'`)).rows[0]?.value ?? null;

describe('настройка бота «новые вопросы анкеты»', () => {
  test('пока настройку не меняли, показывается значение из .env и сказано, откуда оно', async () => {
    expect((await make('off').view()).extraQuestions).toEqual({ mode: 'off', ids: '', source: 'env', envValue: 'off' });
    expect((await make('all').view()).extraQuestions).toMatchObject({ mode: 'all', source: 'env' });
    expect((await make('max:7, 5').view()).extraQuestions).toMatchObject({ mode: 'list', ids: 'max:7,5', source: 'env' });
  });

  test('сохранённое значение показывается и сразу меняет режим', async () => {
    const s = make('off');
    expect(await s.setExtraQuestions({ mode: 'all' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('all');
    expect((await s.view()).extraQuestions).toMatchObject({ mode: 'all', source: 'settings', envValue: 'off' });
    expect(await s.setExtraQuestions({ mode: 'off' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('off');
  });

  test('список id нормализуется: пробелы, регистр, повторы убираются', async () => {
    const s = make();
    expect(await s.setExtraQuestions({ mode: 'list', ids: ' MAX:27637540 , 1763357182,max:27637540 ' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('max:27637540,1763357182');
  });

  test.each([
    [{ mode: 'list' }], [{ mode: 'list', ids: '' }], [{ mode: 'list', ids: 'сорок два' }], [{ mode: 'list', ids: 'vk:123' }],
    [{ mode: 'list', ids: '1,,' }], [{ mode: 'всем' }], [{}], [null], [{ mode: 'all', ids: 5 }],
  ])('неверное тело %j отклоняется, ничего не сохраняется', async (body) => {
    expect(await make().setExtraQuestions(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await stored()).toBeNull();
  });

  test('в журнале режим и число id, но не сами id', async () => {
    await make().setExtraQuestions({ mode: 'list', ids: '27637540,1763357182' }, 'boss');
    const [e] = (await db.query(`SELECT actor, action, after::text AS after FROM audit_log`)).rows;
    expect(e).toMatchObject({ actor: 'boss', action: 'settings.extra_questions' });
    expect(JSON.parse(e.after)).toEqual({ mode: 'list', count: 2 });
  });
});

describe('досылка новых вопросов из «Настроек»', () => {
  let tg: FakePlatform;
  /** Настоящая досылка на поддельной платформе; режим вопросов — как в `.env`, пока настройку не меняли. */
  const withInvites = (env = 'all') => {
    tg = new FakePlatform('telegram');
    const deps = createDeps({
      db, platforms: new Map<PlatformName, Platform>([['telegram', tg]]), admins: new Map(),
      schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
      broadcastRate: 1000, extraQuestions: env,
    });
    return createBotSettings({ settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: env, invites: createExtraInvites(deps) });
  };
  const audit = async () => (await db.query(`SELECT actor, action, after::text AS after FROM audit_log ORDER BY id`)).rows;

  test('в обзоре видно, сколько человек получит приглашение, и сами тексты', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'open' });
    expect((await withInvites().view()).invites).toEqual({
      available: true, join: 1, lead: 1, leaders: 0, total: 2, off: false,
      textJoin: T.followUpInviteJoin, textLead: T.followUpInviteLead, textLeader: T.followUpInviteLeader,
    });
  });

  test('досылка ведущим: своё число в обзоре и отправка только им', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'leader' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    const s = withInvites();
    expect((await s.view()).invites).toMatchObject({ leaders: 1, total: 1 });
    expect(await s.sendExtraInvites({ expectedTotal: 1, audience: 'leaders' }, 'boss')).toEqual({ ok: true, sent: 1, failed: 0, blocked: 0 });
    expect(tg.sent.map((m) => m.chatId)).toEqual(['1']);
    expect(JSON.parse((await audit())[0].after)).toMatchObject({ audience: 'leaders', leaders: 1 });
    expect(await s.sendExtraInvites({ expectedTotal: 1, audience: 'кто-то' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('без подключённых платформ досылка недоступна и отправить нечем', async () => {
    const s = make('all');
    expect((await s.view()).invites).toMatchObject({ available: false, total: 0 });
    expect(await s.sendExtraInvites({ expectedTotal: 1 }, 'boss')).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await s.sendCoordinatorContacts({ expectedTotal: 1 }, 'boss')).toMatchObject({ ok: false, error: 'unavailable' });
    expect((await s.view()).coordinatorContacts).toEqual({ available: false, total: 0, noChat: [], noCoordinator: [], noPhone: [] });
  });

  test('отправка шлёт приглашения подтверждённому числу людей, в журнал идут числа, а не люди', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'open' });
    const s = withInvites();
    expect(await s.sendExtraInvites({ expectedTotal: 2 }, 'boss')).toEqual({ ok: true, sent: 2, failed: 0, blocked: 0 });
    expect(tg.sent.map((m) => m.chatId).sort()).toEqual(['1', '2']);
    const [e] = await audit();
    expect(e).toMatchObject({ actor: 'boss', action: 'settings.extra_invites' });
    expect(JSON.parse(e.after)).toEqual({ audience: 'seekers', join: 1, lead: 1, leaders: 0, sent: 2, failed: 0, blocked: 0 });
    expect((await s.view()).invites).toMatchObject({ total: 0 });
  });

  test('число изменилось с момента показа — ничего не уходит и сказано, сколько стало', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    const r = await withInvites().sendExtraInvites({ expectedTotal: 1 }, 'boss');
    expect(r).toMatchObject({ ok: false, error: 'conflict' });
    expect((r as { message: string }).message).toContain('2');
    expect(tg.sent).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  test('когда вопросы выключены, отправка отказывает и объясняет почему', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    const r = await withInvites('off').sendExtraInvites({ expectedTotal: 0 }, 'boss');
    expect(r).toMatchObject({ ok: false, error: 'bad_request' });
    expect((r as { message: string }).message).toContain('выключены');
    expect(tg.sent).toEqual([]);
  });

  test('получателей нет — отказ без отправки', async () => {
    expect(await withInvites().sendExtraInvites({ expectedTotal: 0 }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test.each([[{}], [null], [{ expectedTotal: '2' }], [{ expectedTotal: -1 }], [{ expectedTotal: 1.5 }]])('неверное тело %j отклоняется', async (body) => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    expect(await withInvites().sendExtraInvites(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(tg.sent).toEqual([]);
  });
});

describe('контакты координаторов ведущим', () => {
  const withContacts = (send: () => Promise<unknown>) => createBotSettings({
    settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: 'off',
    coordinatorContacts: {
      preview: async () => ({ total: 2, noChat: ['ДГ-0005'], noCoordinator: ['ДГ-0007'], noPhone: [] }),
      send: send as never,
    },
  });

  test('предпросмотр — в виде «Настроек»: сколько уйдёт и коды групп, где не уйдёт', async () => {
    const s = withContacts(async () => ({ status: 'none' }));
    expect((await s.view()).coordinatorContacts).toEqual({ available: true, total: 2, noChat: ['ДГ-0005'], noCoordinator: ['ДГ-0007'], noPhone: [] });
  });

  test('число изменилось — конфликт с пояснением; некому — отказ; без подтверждённого числа — отказ', async () => {
    expect(await withContacts(async () => ({ status: 'changed', actual: 3 })).sendCoordinatorContacts({ expectedTotal: 2 }, 'boss'))
      .toMatchObject({ ok: false, error: 'conflict', message: expect.stringContaining('теперь ведущих 3') });
    expect(await withContacts(async () => ({ status: 'none' })).sendCoordinatorContacts({ expectedTotal: 0 }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await withContacts(async () => ({ status: 'none' })).sendCoordinatorContacts({}, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('отправлено — итог и запись в журнале только числами', async () => {
    const s = withContacts(async () => ({ status: 'sent', sent: 2, failed: 0, blocked: 0 }));
    expect(await s.sendCoordinatorContacts({ expectedTotal: 2 }, 'boss')).toEqual({ ok: true, sent: 2, failed: 0, blocked: 0 });
    const [row] = (await db.query(`SELECT actor, after FROM audit_log WHERE action = 'settings.coordinator_contacts'`)).rows;
    expect(row).toEqual({ actor: 'boss', after: { sent: 2, failed: 0, blocked: 0 } });
  });
});
