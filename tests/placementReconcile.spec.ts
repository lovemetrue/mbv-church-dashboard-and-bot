import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: PlacementRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new PlacementRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function group(leader = 'Малявин Павел', source = 'таблица'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, source) VALUES ($1, 'Приморский', 'очно', 'Функционирует', $2) RETURNING id`,
    [leader, source],
  );
  return rows[0]!.id;
}
/** Обращение из бота: человек зарегистрирован (user), тип — «уже состою» или «уже веду». */
async function other(type: 'already_member' | 'already_leader', opts: { uid?: string; status?: string } = {}): Promise<{ requestId: number; userId: number }> {
  const userId = await seedUser(db, { id: opts.uid ?? '501', mdgStatus: type === 'already_member' ? 'member' : 'leader' });
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, user_id, fio, status, origin) VALUES ($1, $2, 'Иванов Иван Иванович', $3, 'бот') RETURNING id`,
    [type, userId, opts.status ?? 'Новая'],
  );
  return { requestId: rows[0]!.id, userId };
}
const members = async (groupId: number) =>
  (await db.query('SELECT user_id::int AS user_id, created_by, source FROM group_members WHERE group_id = $1 AND archived_at IS NULL', [groupId])).rows;
const status = async (id: number) => (await db.query('SELECT status, handled_by FROM requests WHERE id = $1', [id])).rows[0];
const audits = async () => (await db.query(`SELECT actor, action, entity_type, entity_id::int AS entity_id, after FROM audit_log ORDER BY id`)).rows;

describe('разбор обращения «уже состою в группе»', () => {
  test('человек попадает в состав группы ссылкой на свою регистрацию, обращение закрывается как обработанное', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_member');
    expect(await repo.reconcile(requestId, 'member', [g], 'boss')).toEqual({ ok: true, already: false });
    expect(await members(g)).toEqual([{ user_id: userId, created_by: 'boss', source: 'ui' }]);
    expect(await status(requestId)).toEqual({ status: 'Исполнена', handled_by: 'boss' });
  });

  test('в журнал идут вид, группа и число, без имён и телефонов', async () => {
    const g = await group();
    const { requestId } = await other('already_member');
    await repo.reconcile(requestId, 'member', [g], 'boss');
    const [e] = await audits();
    expect(e).toMatchObject({ actor: 'boss', action: 'request.reconcile', entity_type: 'request', entity_id: requestId });
    expect(e.after).toEqual({ kind: 'member', group_id: g, group_ids: [g], already: false });
  });

  test('уже стоит в составе этой группы — второй записи не создаётся, обращение всё равно закрывается', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_member');
    await db.query('INSERT INTO group_members (group_id, user_id, created_by) VALUES ($1, $2, $3)', [g, userId, 'ранее']);
    expect(await repo.reconcile(requestId, 'member', [g], 'boss')).toEqual({ ok: true, already: true });
    expect(await members(g)).toHaveLength(1);
    expect((await status(requestId))!.status).toBe('Исполнена');
  });

  test('человек, которого утвердили в эту группу через сервис, второй раз в состав не вносится', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_member');
    await db.query(`INSERT INTO requests (type, user_id, fio, status, group_id, origin) VALUES ('join_group', $1, 'Иванов Иван', 'Исполнена', $2, 'бот')`, [userId, g]);
    expect(await repo.reconcile(requestId, 'member', [g], 'boss')).toEqual({ ok: true, already: true });
    expect(await members(g)).toEqual([]);
  });

  test('чужая группа допустима: человек состоит в нескольких группах', async () => {
    const g1 = await group('Один Иван');
    const g2 = await group('Два Пётр');
    const { requestId, userId } = await other('already_member');
    await db.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [g1, userId]);
    expect(await repo.reconcile(requestId, 'member', [g2], 'boss')).toEqual({ ok: true, already: false });
    expect(await members(g2)).toHaveLength(1);
  });

  test('закрытое обращение не разбирается повторно, и ничего не записывается', async () => {
    const g = await group();
    const { requestId } = await other('already_member', { status: 'Исполнена' });
    expect(await repo.reconcile(requestId, 'member', [g], 'boss')).toMatchObject({ ok: false, error: 'already_closed' });
    expect(await members(g)).toEqual([]);
  });

  test('группы нет или она в архиве — отказ без записи', async () => {
    const g = await group();
    await db.query('UPDATE groups SET archived_at = now() WHERE id = $1', [g]);
    const { requestId } = await other('already_member');
    expect(await repo.reconcile(requestId, 'member', [g], 'boss')).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect(await repo.reconcile(requestId, 'member', [999999], 'boss')).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect((await status(requestId))!.status).toBe('Новая');
  });

  test('обращение другого вида или без регистрации человека отклоняется', async () => {
    const g = await group();
    const lead = await other('already_leader', { uid: '502' });
    expect(await repo.reconcile(lead.requestId, 'member', [g], 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    const { rows } = await db.query<{ id: number }>(`INSERT INTO requests (type, fio, status, origin) VALUES ('already_member', 'Без регистрации', 'Новая', 'ui') RETURNING id`);
    expect(await repo.reconcile(rows[0]!.id, 'member', [g], 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await repo.reconcile(999999, 'member', [g], 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('разбор обращения «уже веду группу»', () => {
  test('группа получает ссылку на регистрацию ведущего, обращение закрывается', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_leader');
    expect(await repo.reconcile(requestId, 'leader', [g], 'boss')).toEqual({ ok: true, already: false });
    expect((await db.query('SELECT leader_user_id::int AS u FROM groups WHERE id = $1', [g])).rows[0]!.u).toBe(userId);
    expect((await status(requestId))!.status).toBe('Исполнена');
    expect((await audits())[0]!.after).toEqual({ kind: 'leader', group_id: g, group_ids: [g], already: false });
  });

  test('запись из таблицы после связывания считается правленной в интерфейсе, чтобы повторный перенос её не затёр', async () => {
    const g = await group('Малявин Павел', 'таблица');
    const { requestId } = await other('already_leader');
    await repo.reconcile(requestId, 'leader', [g], 'boss');
    expect((await db.query('SELECT source FROM groups WHERE id = $1', [g])).rows[0]!.source).toBe('ui');
  });

  test('у группы уже связан тот же человек — всё равно успех, ничего не меняется', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_leader');
    await db.query('UPDATE groups SET leader_user_id = $2 WHERE id = $1', [g, userId]);
    expect(await repo.reconcile(requestId, 'leader', [g], 'boss')).toEqual({ ok: true, already: true });
  });

  test('у группы уже связан другой ведущий — отказ: чужую связь молча не перезаписываем', async () => {
    const g = await group();
    const other1 = await seedUser(db, { id: '700', mdgStatus: 'leader' });
    await db.query('UPDATE groups SET leader_user_id = $2 WHERE id = $1', [g, other1]);
    const { requestId } = await other('already_leader');
    expect(await repo.reconcile(requestId, 'leader', [g], 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect((await status(requestId))!.status).toBe('Новая');
    expect((await db.query('SELECT leader_user_id::int AS u FROM groups WHERE id = $1', [g])).rows[0]!.u).toBe(other1);
  });

  test('удаление регистрации ведущего снимает ссылку, группа остаётся', async () => {
    const g = await group();
    const { requestId, userId } = await other('already_leader');
    await repo.reconcile(requestId, 'leader', [g], 'boss');
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    expect((await db.query('SELECT leader_user_id FROM groups WHERE id = $1', [g])).rows[0]!.leader_user_id).toBeNull();
  });
});
