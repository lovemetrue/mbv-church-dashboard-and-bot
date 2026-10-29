import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { PlacementNoticesRepo, SETTING_NOTIFY } from '../src/db/repos/placementNotices.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let placement: PlacementRepo;
let notices: PlacementNoticesRepo;
const OPTS = { force: false, defaultCapacity: 10 };

beforeAll(async () => { db = await setupTestDb(); placement = new PlacementRepo(db); notices = new PlacementNoticesRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const notifyOn = () => db.query(`INSERT INTO app_settings (key, value, updated_by) VALUES ($1, 'true'::jsonb, 't')`, [SETTING_NOTIFY]);

async function user(over: { platform?: string; phone?: string | null; blocked?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (platform, platform_user_id, chat_id, phone, registered_at, blocked_at)
     VALUES ($1, gen_random_uuid()::text, 'chat-' || gen_random_uuid()::text, $2, now(), CASE WHEN $3 THEN now() END) RETURNING id`,
    [over.platform ?? 'max', over.phone ?? null, over.blocked ?? false],
  );
  return Number(rows[0]!.id);
}

async function group(over: { leaderUserId?: number | null; phones?: string[]; status?: string } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, people, source, leader_user_id, phones, day, time)
     VALUES ('Осипова Наталья Евгеньевна', 'Центральный', group_direction_id('Основная церковь'), $1, 3, 'ui', $2, $3, 'Вс', '19:00') RETURNING id`,
    [over.status ?? 'Функционирует', over.leaderUserId ?? null, over.phones ?? []],
  );
  return Number(rows[0]!.id);
}

async function request(over: { userId?: number | null; phone?: string | null } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, origin, user_id, phone, responsible) VALUES ('join_group', 'Новая', 'Никандрова Нина Ивановна', 'бот', $1, $2, 'Анна') RETURNING id`,
    [over.userId ?? null, over.phone ?? null],
  );
  return Number(rows[0]!.id);
}

const rows = async () =>
  (await db.query(`SELECT recipient, user_id, status, answer FROM placement_notices ORDER BY id`)).rows
    .map((r) => ({ ...r, user_id: r.user_id === null ? null : Number(r.user_id) }));

describe('сообщения после «Утвердить»', () => {
  test('пока выключатель не включён, утверждение никому не пишет', async () => {
    const r = await request({ userId: await user() });
    expect(await placement.approve(r, await group({ leaderUserId: await user() }), 'a', OPTS)).toEqual({ ok: true });
    expect(await rows()).toEqual([]);
  });

  test('включено: в очередь встают человек и ведущий по их регистрациям в MAX', async () => {
    await notifyOn();
    const person = await user();
    const leader = await user();
    const r = await request({ userId: person });
    await placement.approve(r, await group({ leaderUserId: leader }), 'a', OPTS);
    expect(await rows()).toEqual([
      { recipient: 'person', user_id: person, status: 'queued', answer: null },
      { recipient: 'leader', user_id: leader, status: 'queued', answer: null },
    ]);
  });

  test('ведущий без регистрации находится по телефону группы; Telegram и заблокировавшие не в счёт', async () => {
    await notifyOn();
    await user({ platform: 'telegram', phone: '+79001112233' });
    await user({ phone: '+79001112233', blocked: true });
    const leader = await user({ phone: '+79001112233' });
    const r = await request({ userId: await user({ platform: 'telegram' }) });
    await placement.approve(r, await group({ phones: ['8 (900) 111-22-33'] }), 'a', OPTS);
    expect(await rows()).toEqual([
      { recipient: 'person', user_id: null, status: 'no_chat', answer: null },
      { recipient: 'leader', user_id: leader, status: 'queued', answer: null },
    ]);
  });

  test('откат утверждения (группа недоступна) сообщений не оставляет', async () => {
    await notifyOn();
    const r = await request({ userId: await user() });
    const res = await placement.approve(r, await group({ status: 'Закрыта' }), 'a', OPTS);
    expect(res.ok).toBe(false);
    expect(await rows()).toEqual([]);
  });

  test('возврат в работу снимает неотправленное, а повторное утверждение пишет заново', async () => {
    await notifyOn();
    const r = await request({ userId: await user() });
    const g = await group({ leaderUserId: await user() });
    await placement.approve(r, g, 'a', OPTS);
    await placement.reopen(r, 'a');
    expect((await rows()).map((x) => x.status)).toEqual(['cancelled', 'cancelled']);
    await placement.approve(r, g, 'a', OPTS);
    expect((await rows()).map((x) => x.status)).toEqual(['cancelled', 'cancelled', 'queued', 'queued']);
  });

  test('бот берёт очередь с текстом: имя, телефоны, расписание; отправленное больше не берёт', async () => {
    await notifyOn();
    const r = await request({ userId: await user(), phone: '+79005556677' });
    await db.query(`UPDATE requests SET manual_schedule = 'выходные днём' WHERE id = $1`, [r]);
    await placement.approve(r, await group({ leaderUserId: await user(), phones: ['+79001112233'] }), 'a', OPTS);
    const due = await notices.due(10);
    expect(due).toHaveLength(2);
    expect(due[0]).toMatchObject({ recipient: 'person', leader: 'Осипова Наталья Евгеньевна', leaderPhone: '+79001112233', day: 'Вс', time: '19:00', platform: 'max' });
    expect(due[1]).toMatchObject({ recipient: 'leader', fio: 'Никандрова Нина Ивановна', personPhone: '+79005556677', personSchedule: 'выходные днём' });
    await notices.markSent(due[0]!.id);
    await notices.markFailed(due[1]!.id, 'blocked');
    expect(await notices.due(10)).toEqual([]);
    expect((await rows()).map((x) => x.status)).toEqual(['sent', 'failed']);
  });

  test('ответ кнопкой засчитывается только адресату и только кнопкой его стороны; пишется в журнал', async () => {
    await notifyOn();
    const person = await user();
    const leader = await user();
    const r = await request({ userId: person });
    await placement.approve(r, await group({ leaderUserId: leader }), 'a', OPTS);
    const [toPerson, toLeader] = await notices.due(10);
    await notices.markSent(toPerson!.id);
    await notices.markSent(toLeader!.id);

    expect(await notices.answer(toPerson!.id, leader, 'waiting')).toBeNull();
    expect(await notices.answer(toPerson!.id, person, 'will_call')).toBeNull();
    expect(await notices.answer(toPerson!.id, person, 'not_fit')).toEqual({ requestId: r });
    expect(await notices.answer(toLeader!.id, leader, 'will_call')).toEqual({ requestId: r });
    expect((await rows()).map((x) => x.answer)).toEqual(['not_fit', 'will_call']);

    const audit = (await db.query(`SELECT action, after FROM audit_log WHERE action = 'request.bot_answer' ORDER BY id`)).rows;
    expect(audit.map((x) => x.after)).toEqual([{ recipient: 'person', answer: 'not_fit' }, { recipient: 'leader', answer: 'will_call' }]);
    expect((await notices.traces()).map((t) => [t.recipient, t.status, t.answer])).toEqual([['person', 'sent', 'not_fit'], ['leader', 'sent', 'will_call']]);
  });

  test('на неотправленное сообщение кнопка не действует', async () => {
    await notifyOn();
    const person = await user();
    const r = await request({ userId: person });
    await placement.approve(r, await group(), 'a', OPTS);
    const [toPerson] = await notices.due(10);
    expect(await notices.answer(toPerson!.id, person, 'waiting')).toBeNull();
  });
});

describe('«Выбрать» в окне «Другая группа»', () => {
  const active = async () =>
    (await db.query(`SELECT request_id, group_id, source FROM placement_proposals WHERE status = 'proposed' ORDER BY request_id`)).rows
      .map((x) => ({ request_id: Number(x.request_id), group_id: Number(x.group_id), source: x.source }));

  test('выбранная группа становится действующим предложением координатора; утверждения нет', async () => {
    const r = await request();
    const g = await group();
    expect(await placement.choose(r, g, 'a')).toEqual({ ok: true });
    expect(await active()).toEqual([{ request_id: r, group_id: g, source: 'manual' }]);
    expect((await db.query('SELECT status FROM requests WHERE id = $1', [r])).rows[0].status).toBe('Новая');
  });

  test('закрытую группу выбрать нельзя — как и утвердить', async () => {
    const r = await request();
    expect(await placement.choose(r, await group({ status: 'Закрыта' }), 'a')).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect(await active()).toEqual([]);
  });

  test('автоподбор выбор координатора не заменяет и не снимает', async () => {
    const r = await request();
    const chosen = await group();
    const other = await group();
    await placement.choose(r, chosen, 'a');
    const res = await placement.syncProposals([{ requestId: r, groupId: other, confidence: 80, rationale: [] }], 'auto');
    expect(res).toEqual({ created: 0, replaced: 0, unchanged: 0 });
    expect(await placement.syncProposals([], 'auto')).toEqual({ created: 0, replaced: 0, unchanged: 0 });
    expect(await active()).toEqual([{ request_id: r, group_id: chosen, source: 'manual' }]);
  });

  test('«Подобрать заново» выбор снимает', async () => {
    const r = await request();
    await placement.choose(r, await group(), 'a');
    await placement.resetProposals(r, 'a');
    expect(await active()).toEqual([]);
  });
});
