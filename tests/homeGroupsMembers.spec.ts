import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { MembersRepo } from '../src/db/repos/members.repo.js';
import { createMembers } from '../src/home-groups/members.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const svc = () => createMembers({ members: new MembersRepo(db), audit: new AuditRepo(db), now: () => new Date('2026-10-11T10:00:00Z') });
const seedGroup = async () => (await db.query<{ id: number }>(
  `INSERT INTO groups (leader, district, format, status, source) VALUES ('Иван', 'Приморский', 'Основная церковь', 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
const rows = async () => (await db.query('SELECT group_id, full_name, phone, joined_on::text AS joined_on, note, archived_at FROM group_members ORDER BY id')).rows;
const audits = async () => (await db.query(`SELECT actor, action, after::text AS after FROM audit_log ORDER BY id`)).rows;

describe('состав группы вручную', () => {
  test('человек добавляется в группу: ФИО, телефон приводится к +7…, дата и заметка сохраняются', async () => {
    const g = await seedGroup();
    const out = await svc().add(g, { fields: { fio: '  Анна   Смирнова ', phone: '8 921 555-00-11', joinedOn: '2026-09-01', note: 'ходит с мужем' } }, 'a');
    expect(out).toMatchObject({ ok: true });
    expect(await rows()).toEqual([{ group_id: g, full_name: 'Анна Смирнова', phone: '+79215550011', joined_on: '2026-09-01', note: 'ходит с мужем', archived_at: null }]);
  });

  test('телефон, который не разобрать, сохраняется как написан', async () => {
    const g = await seedGroup();
    await svc().add(g, { fields: { fio: 'Борис', phone: 'спросить у Марины' } }, 'a');
    expect((await rows())[0]!.phone).toBe('спросить у Марины');
  });

  test.each([
    [{}], [{ fields: {} }], [{ fields: { fio: '' } }], [{ fields: { fio: 'Я', joinedOn: '2026-13-40' } }], [{ fields: { fio: 'Я', joinedOn: '2027-01-01' } }],
    [{ fields: { fio: 'Я', joinedOn: 'вчера' } }], [{ fields: { fio: 'Я', group_id: '5' } }], [{ fields: { fio: 'я'.repeat(201) } }], [{ fields: { fio: 'Я', note: 'я'.repeat(301) } }], [null],
  ])('неверное тело %j отклоняется, ничего не записывается', async (body) => {
    const g = await seedGroup();
    expect(await svc().add(g, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await rows()).toEqual([]);
  });

  test('в убранную или несуществующую группу добавить нельзя', async () => {
    const g = await seedGroup();
    await db.query('UPDATE groups SET archived_at = now() WHERE id = $1', [g]);
    expect(await svc().add(g, { fields: { fio: 'Борис' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await svc().add(99999, { fields: { fio: 'Борис' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('правка меняет только присланные поля, пустое значение очищает необязательное', async () => {
    const g = await seedGroup();
    const created = await svc().add(g, { fields: { fio: 'Анна', phone: '+79215550011', note: 'заметка' } }, 'a');
    if (!created.ok) throw new Error('нет id');
    expect(await svc().update(created.id, { fields: { note: '' } }, 'a')).toEqual({ ok: true });
    expect(await svc().update(created.id, { fields: { fio: 'Анна Смирнова' } }, 'a')).toEqual({ ok: true });
    expect((await rows())[0]).toMatchObject({ full_name: 'Анна Смирнова', phone: '+79215550011', note: null });
    expect(await svc().update(created.id, { fields: { fio: '' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc().update(99999, { fields: { fio: 'Я' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('«убрать из состава» скрывает запись, повторно — not_found', async () => {
    const g = await seedGroup();
    const created = await svc().add(g, { fields: { fio: 'Анна' } }, 'a');
    if (!created.ok) throw new Error('нет id');
    expect(await svc().remove(created.id, 'a')).toEqual({ ok: true });
    expect((await rows())[0]!.archived_at).not.toBeNull();
    expect(await svc().remove(created.id, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await new MembersRepo(db).all()).toEqual([]);
  });

  test('в журнал идут группа и названия полей, без имён и телефонов', async () => {
    const g = await seedGroup();
    const created = await svc().add(g, { fields: { fio: 'Анна Смирнова', phone: '+79215550011' } }, 'a');
    if (!created.ok) throw new Error('нет id');
    await svc().update(created.id, { fields: { phone: '+79990001122' } }, 'b');
    await svc().remove(created.id, 'b');
    const log = await audits();
    expect(log.map((e) => e.action)).toEqual(['group.member.add', 'group.member.update', 'group.member.remove']);
    expect(JSON.stringify(log)).not.toMatch(/Анна|Смирнова|921|999/);
  });

  test('состав убранной группы не читается', async () => {
    const g = await seedGroup();
    await svc().add(g, { fields: { fio: 'Анна' } }, 'a');
    await db.query('UPDATE groups SET archived_at = now() WHERE id = $1', [g]);
    expect(await new MembersRepo(db).all()).toEqual([]);
  });
});
