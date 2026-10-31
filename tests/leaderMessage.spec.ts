import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { CoordinatorContactsRepo } from '../src/db/repos/coordinatorContacts.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { createDeps } from '../src/deps.js';
import { createLeaderMessage, LEADER_MESSAGE_MAX } from '../src/core/leaderMessage.js';
import { createBotSettings } from '../src/home-groups/botSettings.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const id = async (sql: string, args: unknown[] = []) => Number((await db.query<{ id: number }>(sql, args)).rows[0]!.id);
const user = (platform: string, chat: string, phone: string | null = null) =>
  id(`INSERT INTO users (platform, platform_user_id, chat_id, phone, registered_at)
      VALUES ($1, gen_random_uuid()::text, $2, $3, now()) RETURNING id`, [platform, chat, phone]);
const group = (o: { leaderUserId?: number | null; phones?: string[]; status?: string }) =>
  id(`INSERT INTO groups (leader, district, direction_id, status, people, source, leader_user_id, phones)
      VALUES ('Иванова Марина', 'Приморский', group_direction_id('Основная церковь'), $1, 3, 'ui', $2, $3) RETURNING id`,
  [o.status ?? 'Функционирует', o.leaderUserId ?? null, o.phones ?? []]);

const TEXT = 'Первое видео для малых домашних групп,\nУРОК 1 "Назначение молитвы"\n\nhttps://rutube.ru/video/private/4b871d891cfec6728ef939f7fd5defc4/?p=LGXH98a36a53DLzN5HsHXQ\n\nБлагословляем вас 🙏';

let max: FakePlatform;
const make = () => {
  max = new FakePlatform('max');
  const deps = createDeps({
    db, platforms: new Map<PlatformName, Platform>([['max', max]]), admins: new Map(),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000, extraQuestions: 'off',
  });
  const leaderMessage = createLeaderMessage({ ...deps, contacts: new CoordinatorContactsRepo(db) });
  return createBotSettings({ settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: 'off', leaderMessage });
};

describe('сообщение ведущим действующих групп', () => {
  test('уходит только ведущим групп «Функционирует»: на паузе и потенциальным — нет; ведущий двух групп получает одно', async () => {
    const a = await user('max', '100');
    await group({ leaderUserId: a });
    await group({ leaderUserId: a });
    await group({ phones: ['8 900 222-00-00'] });
    await user('max', '200', '+79002220000');
    await group({ leaderUserId: await user('max', '300'), status: 'На паузе' });
    await group({ leaderUserId: await user('max', '400'), status: 'Потенциальная' });
    const noChat = await group({});
    const s = make();
    expect((await s.view()).leaderMessage).toEqual({ available: true, total: 2, noChat: [`ДГ-${String(noChat).padStart(4, '0')}`], failures: [], maxLength: LEADER_MESSAGE_MAX });
    expect(await s.sendLeaderMessage({ text: TEXT, expectedTotal: 2 }, 'boss')).toEqual({ ok: true, sent: 2, failed: 0, blocked: 0, alreadySent: 0 });
    expect(max.sent.map((m) => m.chatId).sort()).toEqual(['100', '200']);
  });

  test('заведённый вручную (без чата с ботом) — «нет в боте», а не «не дошло»; настоящая регистрация с тем же телефоном важнее', async () => {
    const manual = (phone: string) =>
      id(`INSERT INTO users (platform, platform_user_id, chat_id, phone, registered_at)
          VALUES ('max', 'manual:' || gen_random_uuid()::text, '', $1, now()) RETURNING id`, [phone]);
    const onlyManual = await group({ leaderUserId: await manual('+79001110000') });
    await user('max', '200', '+79002220000');
    await manual('+79002220000');
    await group({ phones: ['+79002220000'] });
    const s = make();
    expect((await s.view()).leaderMessage).toMatchObject({ total: 1, noChat: [`ДГ-${String(onlyManual).padStart(4, '0')}`] });
    expect(await s.sendLeaderMessage({ text: TEXT, expectedTotal: 1 }, 'boss')).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(max.sent.map((m) => m.chatId)).toEqual(['200']);
  });

  test('текст доходит как набран: со ссылкой целиком, без разметки и без кнопок', async () => {
    await group({ leaderUserId: await user('max', '100') });
    const s = make();
    await s.sendLeaderMessage({ text: `  ${TEXT.replace(/\n/g, '\r\n')}  `, expectedTotal: 1 }, 'boss');
    expect(max.sent).toEqual([{ chatId: '100', text: TEXT, buttons: undefined }]);
  });

  test('тот же текст второй раз не уходит; другой — уходит', async () => {
    await group({ leaderUserId: await user('max', '100') });
    const s = make();
    await s.sendLeaderMessage({ text: TEXT, expectedTotal: 1 }, 'boss');
    expect(await s.sendLeaderMessage({ text: TEXT, expectedTotal: 1 }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await s.sendLeaderMessage({ text: 'Урок 2', expectedTotal: 1 }, 'boss')).toMatchObject({ ok: true, sent: 1 });
    expect(max.sent.map((m) => m.text)).toEqual([TEXT, 'Урок 2']);
  });

  test('число ведущих изменилось — конфликт и ничего не уходит; пустой и слишком длинный текст — отказ', async () => {
    await group({ leaderUserId: await user('max', '100') });
    const s = make();
    expect(await s.sendLeaderMessage({ text: TEXT, expectedTotal: 2 }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await s.sendLeaderMessage({ text: '   ', expectedTotal: 1 }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await s.sendLeaderMessage({ text: 'я'.repeat(LEADER_MESSAGE_MAX + 1), expectedTotal: 1 }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await s.sendLeaderMessage({ text: TEXT }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(max.sent).toEqual([]);
  });

  test('кому последнее сообщение не дошло — имя, группа и причина; дошло позже — из списка уходит', async () => {
    const failed = await user('max', '100');
    await db.query(`UPDATE users SET full_name = 'Петров Иван' WHERE id = $1`, [failed]);
    const g = await group({ leaderUserId: failed });
    const blocked = await user('max', '300');
    const manual = await id(`INSERT INTO users (platform, platform_user_id, chat_id, full_name, registered_at)
      VALUES ('max', 'manual:1', '', 'Сидорова Анна', now()) RETURNING id`);
    const put = async (key: string, body: string, userId: number, status: string, error: string | null) => {
      await db.query(`INSERT INTO broadcasts (key, body) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [key, body]);
      await db.query(`INSERT INTO deliveries (broadcast_key, user_id, status, last_error) VALUES ($1, $2, $3, $4)`, [key, userId, status, error]);
    };
    await put('leaders:старое', 'Старый текст', blocked, 'failed', 'x');
    await db.query(`UPDATE broadcasts SET created_at = now() - interval '1 day' WHERE key = 'leaders:старое'`);
    await put('leaders:1', TEXT, failed, 'failed', '500: Internal error');
    await put('leaders:1', TEXT, blocked, 'blocked', '403');
    await put('leaders:1', TEXT, manual, 'failed', 'chat_id пустой');
    const s = make();
    const failures = (await s.view()).leaderMessage!.failures;
    expect(failures).toEqual([
      { name: 'Петров Иван', groupCodes: [`ДГ-${String(g).padStart(4, '0')}`], reason: 'Ошибка при отправке: 500: Internal error' },
      { name: '', groupCodes: [], reason: expect.stringContaining('Заблокировал бота') },
      { name: 'Сидорова Анна', groupCodes: [], reason: expect.stringContaining('Записан вручную') },
    ]);
    // Повтор тем же текстом дошёл — человек из списка уходит.
    await put('leaders:2', TEXT, failed, 'sent', null);
    expect((await s.view()).leaderMessage!.failures!.map((f) => f.name)).toEqual(['', 'Сидорова Анна']);
  });

  test('в журнале — числа и длина, но не текст', async () => {
    await group({ leaderUserId: await user('max', '100') });
    await make().sendLeaderMessage({ text: TEXT, expectedTotal: 1 }, 'boss');
    const [row] = (await db.query(`SELECT actor, after FROM audit_log WHERE action = 'settings.leader_message'`)).rows;
    expect(row).toEqual({ actor: 'boss', after: { length: TEXT.length, sent: 1, failed: 0, blocked: 0, alreadySent: 0 } });
  });

  test('без подключённых ботов — недоступно', async () => {
    const s = createBotSettings({ settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: 'off' });
    expect((await s.view()).leaderMessage).toMatchObject({ available: false, total: 0 });
    expect(await s.sendLeaderMessage({ text: TEXT, expectedTotal: 0 }, 'boss')).toMatchObject({ ok: false, error: 'unavailable' });
  });
});
