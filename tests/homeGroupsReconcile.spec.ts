import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService } from '../src/home-groups/composition.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Разбор «других обращений» целиком, на настоящей базе: от списка с подсказками до записи в состав группы и ссылки
 * «группа — ведущий». Движок поддельный, всё остальное боевое.
 */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const service = () => composeService(db, createFakeEngine().engine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' });

async function group(leader: string, phone: string | null = null): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, phone, phones, district, direction_id, status, source) VALUES ($1, $2, $3, 'Приморский', group_direction_id('очно'), 'Функционирует', 'таблица') RETURNING id`,
    [leader, phone, phone ? [phone] : []],
  );
  return rows[0]!.id;
}

async function person(uid: string, type: 'already_member' | 'already_leader', opts: { fio?: string; leader?: string; phone?: string } = {}): Promise<{ requestId: number; userId: number }> {
  const userId = await seedUser(db, { id: uid, mdgStatus: type === 'already_member' ? 'member' : 'leader', ...(opts.fio ? { fio: opts.fio } : {}), ...(opts.phone ? { phone: opts.phone } : {}) });
  if (opts.leader) await db.query('UPDATE users SET leader_name = $2 WHERE id = $1', [userId, opts.leader]);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, user_id, fio, status, origin) VALUES ($1, $2, $3, 'Новая', 'бот') RETURNING id`, [type, userId, opts.fio ?? 'Из заявки'],
  );
  return { requestId: rows[0]!.id, userId };
}

describe('«уже состою в группе»', () => {
  test('в списке подсказка по каждому, разбор вносит в состав, обращение уходит в закрытые, в ленте след', async () => {
    const g = await group('Малявин Павел');
    const a = await person('1', 'already_member', { fio: 'Доценко Артём', leader: 'Павел Малявин' });
    const s = service();

    const before = (await s.views()).requests.others.find((o) => o.id === a.requestId)!;
    expect(before).toMatchObject({ state: 'open', reconcile: { status: 'ready', candidates: [{ groupId: g }] } });
    expect(before.gist).toContain('Ведущий: Павел Малявин');

    expect(await s.reconciler.apply(a.requestId, { groupId: g }, 'boss')).toEqual({ ok: true, already: false });

    const after = await s.views();
    const done = after.requests.others.find((o) => o.id === a.requestId)!;
    expect(done).toMatchObject({ state: 'done', reconcile: null });
    expect(done.log.map((l) => l.text).join('\n')).toContain('внесён в состав группы');
    const card = after.groups.items.find((x) => x.id === g)!;
    expect(card.members.map((m) => m.fio)).toEqual(['Доценко Артём']);
    // Человек из справочника: в «Людях» у него появилась группа.
    expect(after.people.items.find((p) => p.key === `u${a.userId}`)!.groups).toHaveLength(1);
  });

  test('«разобрать всё готовое» берёт только однозначные, выбор и чужие группы не трогает, закрытое пропускает', async () => {
    const mal = await group('Малявин Павел');
    await group('Родионов Давид');
    await group('Родионов Давид');
    const ready = await person('1', 'already_member', { leader: 'Малявин Павел' });
    const choose = await person('2', 'already_member', { leader: 'Родионов Давид' });
    const none = await person('3', 'already_member', { leader: 'Неизвестный Человек' });
    const s = service();

    const out = await s.reconciler.applyReady({ ids: [ready.requestId, choose.requestId, none.requestId, 999999] }, 'boss');
    expect(out).toEqual({ ok: true, applied: 1, skipped: 3 });
    expect((await db.query('SELECT group_id::int AS g FROM group_members')).rows).toEqual([{ g: mal }]);

    // Повторный запуск ничего не меняет: первое обращение уже закрыто.
    expect(await s.reconciler.applyReady({ ids: [ready.requestId] }, 'boss')).toEqual({ ok: true, applied: 0, skipped: 1 });
  });

  test('в обращении без вида «разбирается» группу выбрать нельзя: вопрос и «хочет открыть» отклоняются', async () => {
    const g = await group('Малявин Павел');
    const userId = await seedUser(db, { id: '5', mdgStatus: 'open' });
    const { rows } = await db.query<{ id: number }>(`INSERT INTO requests (type, user_id, fio, status, origin) VALUES ('lead_group', $1, 'Хочет', 'Новая', 'бот') RETURNING id`, [userId]);
    expect(await service().reconciler.apply(rows[0]!.id, { groupId: g }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await service().reconciler.apply(999999, { groupId: g }, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test.each([[{}], [null], [{ groupId: 'x' }], [{ groupId: -1 }], [{ groupId: 1.5 }]])('неверное тело %j отклоняется', async (body) => {
    expect(await service().reconciler.apply(1, body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test.each([[{}], [{ ids: [] }], [{ ids: ['1'] }], [{ ids: [0] }], [null]])('неверный список %j отклоняется', async (body) => {
    expect(await service().reconciler.applyReady(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('«уже веду группу»', () => {
  test('по телефону находится группа, разбор связывает её с регистрацией ведущего, и это видно в карточке группы', async () => {
    const g = await group('Малявин Павел', '89001112233');
    const a = await person('7', 'already_leader', { fio: 'П. М.', phone: '+79001112233' });
    const s = service();
    expect((await s.views()).requests.others.find((o) => o.id === a.requestId)!.reconcile).toMatchObject({ kind: 'leader', status: 'ready', candidates: [{ groupId: g, by: 'phone' }] });

    expect(await s.reconciler.apply(a.requestId, { groupId: g }, 'boss')).toEqual({ ok: true, already: false });
    const card = (await s.views()).groups.items.find((x) => x.id === g)!;
    expect(card.leaderKey).toBe(`u${a.userId}`);
  });
});

describe('несколько групп сразу', () => {
  const membersOf = async (userId: number) =>
    (await db.query<{ g: number }>('SELECT group_id::int AS g FROM group_members WHERE user_id = $1 AND archived_at IS NULL ORDER BY group_id', [userId])).rows.map((r) => r.g);
  const statusOf = async (requestId: number) => (await db.query<{ status: string }>('SELECT status FROM requests WHERE id = $1', [requestId])).rows[0]!.status;

  test('«уже состою»: человек вносится в состав каждой отмеченной группы, обращение закрывается один раз', async () => {
    const a = await group('Малявин Павел');
    const b = await group('Родионов Давид');
    const p = await person('1', 'already_member', { leader: 'Павел Малявин' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [b, a] }, 'boss')).toEqual({ ok: true, already: false });
    expect(await membersOf(p.userId)).toEqual([a, b]);
    expect(await statusOf(p.requestId)).toBe('Исполнена');
    const entry = (await db.query<{ after: { group_id: number; group_ids: number[] } }>(`SELECT after FROM audit_log WHERE action = 'request.reconcile'`)).rows;
    expect(entry).toHaveLength(1);
    expect(entry[0]!.after).toMatchObject({ group_id: a, group_ids: [a, b] });
  });

  test('«уже состою»: «уже было» только когда человек уже был во всех отмеченных', async () => {
    const a = await group('Малявин Павел');
    const b = await group('Родионов Давид');
    const p = await person('1', 'already_member', { leader: 'Павел Малявин' });
    await db.query(`INSERT INTO group_members (group_id, user_id, created_by) VALUES ($1, $2, 'boss')`, [a, p.userId]);
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, b] }, 'boss')).toEqual({ ok: true, already: false });
    expect(await membersOf(p.userId)).toEqual([a, b]);
    const q = await person('2', 'already_member', { leader: 'Павел Малявин' });
    await db.query(`INSERT INTO group_members (group_id, user_id, created_by) VALUES ($1, $2, 'boss')`, [a, q.userId]);
    expect(await service().reconciler.apply(q.requestId, { groupIds: [a] }, 'boss')).toEqual({ ok: true, already: true });
  });

  test('«уже веду»: каждая отмеченная группа получает ссылку на ведущего', async () => {
    const a = await group('Артёмкин Константин');
    const b = await group('Артёмкин Константин');
    const p = await person('3', 'already_leader', { fio: 'Артёмкин Константин' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, b] }, 'boss')).toEqual({ ok: true, already: false });
    const rows = (await db.query<{ id: number; leader_user_id: number }>('SELECT id::int AS id, leader_user_id::int AS leader_user_id FROM groups ORDER BY id')).rows;
    expect(rows).toEqual([{ id: a, leader_user_id: p.userId }, { id: b, leader_user_id: p.userId }]);
  });

  test('«уже веду»: совпавший с соведущим встаёт соведущим, ведущий группы остаётся как был', async () => {
    const g = await group('Артёмкин Константин');
    await db.query(`UPDATE groups SET co_leader = 'Артёмкина Людмила' WHERE id = $1`, [g]);
    const p = await person('4', 'already_leader', { fio: 'Артёмкина Людмила' });
    const s = service();
    expect((await s.views()).requests.others.find((o) => o.id === p.requestId)!.reconcile).toMatchObject({ status: 'ready' });
    expect(await s.reconciler.applyReady({ ids: [p.requestId] }, 'boss')).toEqual({ ok: true, applied: 1, skipped: 0 });
    const row = (await db.query('SELECT leader_user_id::int AS lu, co_leader_user_id::int AS cu FROM groups WHERE id = $1', [g])).rows[0];
    expect(row).toEqual({ lu: null, cu: p.userId });
    expect((await s.views()).groups.items.find((x) => x.id === g)).toMatchObject({ leaderKey: null, coLeaderKey: `u${p.userId}` });
  });

  test('«уже веду»: совпавший по телефону соведущего встаёт соведущим', async () => {
    const g = await group('Артёмкин Константин', '+79110000001');
    await db.query(`UPDATE groups SET co_leader = 'Людмила', co_leader_phone = '+79215550044' WHERE id = $1`, [g]);
    const p = await person('5', 'already_leader', { fio: 'Артёмкина Людмила', phone: '+79215550044' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [g] }, 'boss')).toEqual({ ok: true, already: false });
    expect((await db.query('SELECT leader_user_id::int AS lu, co_leader_user_id::int AS cu FROM groups WHERE id = $1', [g])).rows[0]).toEqual({ lu: null, cu: p.userId });
  });

  test('«уже веду»: место соведущего занято другим человеком из «Людей» — не записывается ничего', async () => {
    const g = await group('Артёмкин Константин');
    // На месте соведущего — карточка с тем же именем, но другим телефоном: однофамилица, записывать поверх нельзя.
    // (Та же карточка без телефона или с тем же номером — дубль этого человека, её разбор сливает: placementReconcile.spec.)
    const card = (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone) VALUES ('Артёмкина Людмила', '+79990001122') RETURNING id`)).rows[0]!.id;
    await db.query(`UPDATE groups SET co_leader = 'Артёмкина Людмила', co_leader_person_id = $2 WHERE id = $1`, [g, card]);
    const p = await person('6', 'already_leader', { fio: 'Артёмкина Людмила' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [g] }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await statusOf(p.requestId)).toBe('Новая');
  });

  test('«уже веду»: если у одной из групп уже другой ведущий, не записывается ничего и обращение остаётся открытым', async () => {
    const a = await group('Артёмкин Константин');
    const b = await group('Артёмкин Константин');
    const other = await seedUser(db, { id: '9', mdgStatus: 'leader' });
    await db.query('UPDATE groups SET leader_user_id = $2 WHERE id = $1', [b, other]);
    const p = await person('3', 'already_leader', { fio: 'Артёмкин Константин' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, b] }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect((await db.query('SELECT 1 FROM groups WHERE leader_user_id = $1', [p.userId])).rowCount).toBe(0);
    expect(await statusOf(p.requestId)).toBe('Новая');
  });

  test('одна из групп в архиве или не существует: не записывается ничего', async () => {
    const a = await group('Малявин Павел');
    const b = await group('Родионов Давид');
    await db.query('UPDATE groups SET archived_at = now() WHERE id = $1', [b]);
    const p = await person('1', 'already_member', { leader: 'Павел Малявин' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, b] }, 'boss')).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, 999999] }, 'boss')).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect(await membersOf(p.userId)).toEqual([]);
    expect(await statusOf(p.requestId)).toBe('Новая');
  });

  test('повторы в списке схлопываются, а старое тело {groupId} по-прежнему работает', async () => {
    const a = await group('Малявин Павел');
    const p = await person('1', 'already_member', { leader: 'Павел Малявин' });
    expect(await service().reconciler.apply(p.requestId, { groupIds: [a, a] }, 'boss')).toEqual({ ok: true, already: false });
    expect(await membersOf(p.userId)).toEqual([a]);
    const q = await person('2', 'already_member', { leader: 'Павел Малявин' });
    expect(await service().reconciler.apply(q.requestId, { groupId: a }, 'boss')).toEqual({ ok: true, already: false });
  });

  test.each([[{ groupIds: [] }], [{ groupIds: 'x' }], [{ groupIds: [1, 'x'] }], [{ groupIds: [0] }], [{ groupIds: Array.from({ length: 21 }, (_, i) => i + 1) }], [{ groupIds: [1], groupId: 1 }]])('неверный список групп %j отклоняется', async (body) => {
    expect(await service().reconciler.apply(1, body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('в ленте обращения и в журнале перечислены все группы', async () => {
    const a = await group('Малявин Павел');
    const b = await group('Родионов Давид');
    const p = await person('1', 'already_member', { leader: 'Павел Малявин' });
    const s = service();
    await s.reconciler.apply(p.requestId, { groupIds: [a, b] }, 'boss');
    const done = (await s.views()).requests.others.find((o) => o.id === p.requestId)!;
    expect(done.log.map((l) => l.text).join('\n')).toContain(`внесён в состав групп ДГ-${String(a).padStart(4, '0')}, ДГ-${String(b).padStart(4, '0')}`);
  });
});
