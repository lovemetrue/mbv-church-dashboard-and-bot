import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { MaintenanceRepo } from '../src/db/repos/maintenance.repo.js';
import { StrangeRepo } from '../src/db/repos/strange.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: StrangeRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new StrangeRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function request(opts: { userId?: number | null; status?: string } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, user_id, fio, status, origin) VALUES ('join_group', $1, 'Человек', $2, 'ui') RETURNING id`,
    [opts.userId ?? null, opts.status ?? 'Новая'],
  );
  return rows[0]!.id;
}
const proposal = async (requestId: number) => {
  const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Ведущий', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
  await db.query(`INSERT INTO placement_proposals (request_id, group_id, source, confidence, rationale) VALUES ($1, $2, 'script', 80, '[]'::jsonb)`, [requestId, g]);
};
const proposalStatus = async (requestId: number) => (await db.query('SELECT status FROM placement_proposals WHERE request_id = $1', [requestId])).rows.map((r) => r.status);
const audits = async () => (await db.query(`SELECT actor, action, entity_type, entity_id::int AS entity_id, after, note FROM audit_log ORDER BY id`)).rows;

describe('метка «Странный человек»', () => {
  test('у заявки с регистрацией метка ложится на регистрацию, у заявки без неё — на саму заявку', async () => {
    const u = await seedUser(db, { id: '1' });
    const withUser = await request({ userId: u });
    const noUser = await request();
    expect(await repo.set({ kind: 'request', id: withUser }, true, null, 'anna')).toEqual({ ok: true });
    expect(await repo.set({ kind: 'request', id: noUser }, true, 'говорит сам с собой', 'anna')).toEqual({ ok: true });
    const all = await repo.all();
    expect([...all.keys()].sort()).toEqual([`r${noUser}`, `u${u}`].sort());
    expect(all.get(`r${noUser}`)).toMatchObject({ by: 'anna', note: 'говорит сам с собой' });
  });

  test('карточка человека, внесённая вручную, и регистрация тоже отмечаются напрямую', async () => {
    const u = await seedUser(db, { id: '1' });
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name) VALUES ('Карточка') RETURNING id`)).rows[0]!.id;
    expect(await repo.set({ kind: 'user', id: u }, true, null, 'a')).toEqual({ ok: true });
    expect(await repo.set({ kind: 'person', id: p }, true, null, 'a')).toEqual({ ok: true });
    expect([...(await repo.all()).keys()].sort()).toEqual([`p${p}`, `u${u}`].sort());
  });

  test('повторная отметка обновляет заметку и автора, а не плодит строки; снятие убирает метку', async () => {
    const r = await request();
    await repo.set({ kind: 'request', id: r }, true, 'первое', 'anna');
    await repo.set({ kind: 'request', id: r }, true, 'второе', 'boris');
    expect((await repo.all()).get(`r${r}`)).toMatchObject({ by: 'boris', note: 'второе' });
    expect((await db.query('SELECT count(*)::int AS n FROM strange_marks')).rows[0]!.n).toBe(1);
    expect(await repo.set({ kind: 'request', id: r }, false, null, 'anna')).toEqual({ ok: true });
    expect((await repo.all()).size).toBe(0);
  });

  test('метка снимает сохранённые предложения групп у всех открытых заявок этого человека', async () => {
    const u = await seedUser(db, { id: '1' });
    const a = await request({ userId: u });
    const b = await request({ userId: u });
    const other = await request();
    await proposal(a); await proposal(b); await proposal(other);
    await repo.set({ kind: 'request', id: a }, true, null, 'anna');
    expect(await proposalStatus(a)).toEqual(['superseded']);
    expect(await proposalStatus(b)).toEqual(['superseded']);
    // Чужая заявка не затронута.
    expect(await proposalStatus(other)).toEqual(['proposed']);
  });

  test('в журнал идёт «поставлена/снята» без заметки, у заявки — запись по заявке', async () => {
    const r = await request();
    await repo.set({ kind: 'request', id: r }, true, 'личное наблюдение', 'anna');
    await repo.set({ kind: 'request', id: r }, false, null, 'anna');
    const log = await audits();
    expect(log.map((e) => [e.action, e.entity_type, e.entity_id, e.after])).toEqual([
      ['request.strange', 'request', r, { value: true }],
      ['request.strange', 'request', r, { value: false }],
    ]);
    expect(JSON.stringify(log)).not.toContain('личное наблюдение');
  });

  test('несуществующая или убранная запись — отказ, ничего не записывается', async () => {
    const r = await request();
    await db.query('UPDATE requests SET archived_at = now() WHERE id = $1', [r]);
    expect(await repo.set({ kind: 'request', id: r }, true, null, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await repo.set({ kind: 'user', id: 99999 }, true, null, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await repo.set({ kind: 'person', id: 99999 }, true, null, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect((await repo.all()).size).toBe(0);
    expect(await audits()).toEqual([]);
  });

  test('слишком длинная заметка отклоняется', async () => {
    const r = await request();
    expect(await repo.set({ kind: 'request', id: r }, true, 'я'.repeat(301), 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await repo.all()).size).toBe(0);
  });

  test('снять метку, которой нет, не ошибка', async () => {
    const r = await request();
    expect(await repo.set({ kind: 'request', id: r }, false, null, 'a')).toEqual({ ok: true });
  });

  test('удаление регистрации убирает и метку, чтобы она не осталась без человека', async () => {
    const u = await seedUser(db, { id: '1' });
    await repo.set({ kind: 'user', id: u }, true, null, 'a');
    await new UsersRepo(db).delete(u);
    expect((await repo.all()).size).toBe(0);
  });

  test('очистка базы убирает метки регистраций, а метки карточек оставляет', async () => {
    const u = await seedUser(db, { id: '1' });
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name) VALUES ('Карточка') RETURNING id`)).rows[0]!.id;
    await repo.set({ kind: 'user', id: u }, true, null, 'a');
    await repo.set({ kind: 'person', id: p }, true, null, 'a');
    await new MaintenanceRepo(db).resetAll();
    expect([...(await repo.all()).keys()]).toEqual([`p${p}`]);
  });
});
