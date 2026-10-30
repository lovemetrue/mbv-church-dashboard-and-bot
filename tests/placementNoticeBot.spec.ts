import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { PlacementNoticeSender } from '../src/broadcast/placementNotices.js';
import { Router } from '../src/core/router.js';
import { noticeMessage, parseNoticeButton, type NoticeData } from '../src/core/placementNotice.js';
import { SendError, type IncomingUpdate, type Platform, type PlatformName } from '../src/core/platform.js';
import { createDeps, type Deps } from '../src/deps.js';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { SETTING_NOTIFY } from '../src/db/repos/placementNotices.repo.js';
import { logger } from '../src/logger.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

const base: NoticeData = {
  id: 7, recipient: 'person', groupCode: 'ДГ-0088', leader: 'Осипова Наталья Евгеньевна', leaderPhone: '+79001112233',
  day: 'Вс', time: '19:00', fio: 'Никандрова Нина Ивановна', personPhone: '+79005556677',
  personAge: '25-40',
  personSchedule: 'будни вечером',
};

describe('текст сообщений', () => {
  test('человеку: ведущий, его телефон и расписание, без адреса; кнопки «Жду звонка» и «Группа не подходит»', () => {
    const m = noticeMessage(base);
    expect(m.text).toContain('Нина, здравствуйте! Мы подобрали для Вас домашнюю группу.');
    expect(m.text).toContain('Ведущий: Осипова Наталья Евгеньевна');
    expect(m.text).toContain('Телефон ведущего: +7 900 111-22-33');
    expect(m.text).toContain('Время встреч: Вс, 19:00');
    expect(m.text).not.toMatch(/адрес|улиц/i);
    expect(m.buttons).toEqual([
      [{ kind: 'callback', text: 'Жду звонка', data: 'pn:7:waiting' }],
      [{ kind: 'callback', text: 'Группа не подходит', data: 'pn:7:not_fit' }],
    ]);
  });

  test('ведущему: кого направили и телефон; кнопки «Позвоню в течение 24 часов» и «Нет времени»', () => {
    const m = noticeMessage({ ...base, recipient: 'leader' });
    expect(m.text).toContain('Наталья, здравствуйте! В Вашу группу ДГ-0088 направлен человек.');
    expect(m.text).toContain('Имя: Никандрова Нина Ивановна');
    expect(m.text).toContain('Телефон: +7 900 555-66-77');
    expect(m.text).toContain('Возраст: 25-40');
    expect(m.text).toContain('Удобное время: будни вечером');
    expect(m.buttons!.flat().map((b) => b.text)).toEqual(['Позвоню в течение 24 часов', 'Нет времени']);
  });

  test('удобное время не заполнено — строки нет', () => {
    expect(noticeMessage({ ...base, recipient: 'leader', personSchedule: null }).text).not.toContain('Удобное время');
  });

  test('имя с разметкой экранируется: сообщение уходит как HTML', () => {
    expect(noticeMessage({ ...base, recipient: 'leader', fio: 'Иванов <b>Пётр</b>' }).text).toContain('Иванов &lt;b&gt;Пётр&lt;/b&gt;');
  });

  test('чужие данные кнопки не разбираются как ответ', () => {
    expect(parseNoticeButton('pn:7:waiting')).toEqual({ noticeId: 7, answer: 'waiting' });
    for (const d of ['pn:7:drop', 'pn:x:waiting', 'admin:pn:7:waiting', 'pn:7:waiting:1']) expect(parseNoticeButton(d)).toBeNull();
  });
});

describe('очередь в боте: отправка и ответы', () => {
  let db: Pool;
  let max: FakePlatform;
  let deps: Deps;
  let router: Router;
  let sender: PlacementNoticeSender;

  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => {
    await truncateAll(db);
    max = new FakePlatform('max');
    deps = createDeps({
      db, platforms: new Map<PlatformName, Platform>([['max', max]]), admins: new Map([['max', []]]),
      schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' }, broadcastRate: 1000,
    });
    router = new Router(deps);
    sender = new PlacementNoticeSender({ notices: deps.notices, platforms: deps.platforms, logger });
    await db.query(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1, 'true'::jsonb, 't')`, [SETTING_NOTIFY]);
  });

  /** Человек и ведущий — регистрации в MAX: id человека и id чата в MAX разные, как в жизни. */
  async function approved(): Promise<{ requestId: number }> {
    const u = async (pid: string) => Number((await db.query<{ id: number }>(
      `INSERT INTO users (platform, platform_user_id, chat_id, registered_at) VALUES ('max', $1, 'chat' || $1, now()) RETURNING id`, [pid])).rows[0]!.id);
    const person = await u('100');
    const leader = await u('200');
    const g = Number((await db.query<{ id: number }>(
      `INSERT INTO groups (leader, district, direction_id, status, people, source, leader_user_id, phones, day, time)
       VALUES ('Осипова Наталья Евгеньевна', 'Центральный', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui', $1, '{+79001112233}', 'Вс', '19:00') RETURNING id`,
      [leader])).rows[0]!.id);
    const r = Number((await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, origin, user_id, phone, responsible) VALUES ('join_group', 'Новая', 'Никандрова Нина', 'бот', $1, '+79005556677', 'Анна') RETURNING id`,
      [person])).rows[0]!.id);
    expect(await new PlacementRepo(db).approve(r, g, 'a', { force: false, defaultCapacity: 10 })).toEqual({ ok: true });
    return { requestId: r };
  }
  const statuses = async () => (await db.query(`SELECT recipient, status, error, answer FROM placement_notices ORDER BY id`)).rows;
  const tap = (pid: string, data: string): IncomingUpdate => ({ kind: 'callback', ctx: { platform: 'max', platformUserId: pid, chatId: `chat${pid}` }, data, callbackId: 'cb' });

  test('бот отправляет оба сообщения в чаты MAX и отмечает «дошло»', async () => {
    await approved();
    await sender.tick();
    expect(max.sent.map((m) => m.chatId)).toEqual(['chat100', 'chat200']);
    expect(await statuses()).toMatchObject([{ recipient: 'person', status: 'sent' }, { recipient: 'leader', status: 'sent' }]);
    await sender.tick();
    expect(max.sent).toHaveLength(2);
  });

  test('заблокировавший бота — «не дошло» сразу; сбой сети — повтор позже, а не потеря', async () => {
    await approved();
    max.program('chat100', new SendError('blocked', 'нет'));
    max.program('chat200', new SendError('other', 'сеть'));
    await sender.tick();
    expect(await statuses()).toMatchObject([{ status: 'failed', error: 'blocked' }, { status: 'queued', error: 'other' }]);
  });

  test('нажатия человека и ведущего записываются в заявку, бот отвечает каждому', async () => {
    await approved();
    await sender.tick();
    const [toPerson, toLeader] = max.sent;
    await router.handle(tap('100', (toPerson!.buttons![1]![0] as { data: string }).data));
    await router.handle(tap('200', (toLeader!.buttons![0]![0] as { data: string }).data));
    expect((await statuses()).map((x) => x.answer)).toEqual(['not_fit', 'will_call']);
    expect(max.toasts).toEqual(['Ответ принят ✓', 'Ответ принят ✓']);
    expect(max.textsTo('chat100').at(-1)).toContain('подберут другую группу');
    expect(max.textsTo('chat200').at(-1)).toContain('Вы позвоните');
  });

  test('чужое нажатие (кнопка из сообщения ведущему, нажатая человеком) не засчитывается', async () => {
    await approved();
    await sender.tick();
    const leaderButton = (max.sent[1]!.buttons![0]![0] as { data: string }).data;
    await router.handle(tap('100', leaderButton));
    expect((await statuses()).map((x) => x.answer)).toEqual([null, null]);
    expect(max.textsTo('chat100').at(-1)).toBe('Эта кнопка уже не действует.');
  });
});
