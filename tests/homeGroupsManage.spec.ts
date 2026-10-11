import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { createManager } from '../src/home-groups/manage.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const manager = () => createManager({
  groups: new GroupsRepo(db), coordinators: new CoordinatorsRepo(db), requests: new RequestsRepo(db), users: new UsersRepo(db), audit: new AuditRepo(db),
});

async function group(): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, people, phone, phones, address, co_leader_phone, day, "time", comment, source)
     VALUES ('Иван Петров', 'Приморский', 'Основная церковь', 'Функционирует', 5, '+79110001122', ARRAY['+79110001122'], 'ул. Секретная 1', '+79213334455', 'Пн', '19:00', 'заметка', 'таблица') RETURNING id`,
  );
  return rows[0]!.id;
}
const g = async (id: number) => (await db.query('SELECT * FROM groups WHERE id=$1', [id])).rows[0];
const audits = async () => (await db.query('SELECT actor, action, entity_type, after::text AS after FROM audit_log ORDER BY id')).rows;

describe('правка группы из нового интерфейса', () => {
  test('меняется только присланное, остальное и закрытое (адрес, телефоны) остаётся как было', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { people: '8', day: 'Вт' } }, 'a')).toEqual({ ok: true });
    expect(await g(id)).toMatchObject({
      people: 8, day: 'Вт', leader: 'Иван Петров', district: 'Приморский', time: '19:00', comment: 'заметка',
      phone: '+79110001122', phones: ['+79110001122'], address: 'ул. Секретная 1', co_leader_phone: '+79213334455',
    });
  });

  test('состав из нескольких значений не теряется при правке другого поля и правится списком через запятую', async () => {
    const id = await group();
    await db.query(`UPDATE groups SET composition = 'Смешанная, Семейная' WHERE id=$1`, [id]);
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect((await g(id)).composition).toBe('Смешанная, Семейная');
    await manager().updateGroup(id, { fields: { composition: 'Мужская, Служение' } }, 'a');
    expect((await g(id)).composition).toBe('Мужская, Служение');
    await manager().updateGroup(id, { fields: { composition: '' } }, 'a');
    expect((await g(id)).composition).toBeNull();
  });

  test('новый телефон и адрес записываются, прочее остаётся; в журнале только названия полей', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { phone: '8 921 555-00-11', address: 'ул. Новая 5' } }, 'a')).toEqual({ ok: true });
    expect(await g(id)).toMatchObject({
      phone: '+79215550011', phones: ['+79215550011'], address: 'ул. Новая 5', co_leader_phone: '+79213334455', people: 5,
    });
    await manager().updateGroup(id, { fields: { coLeaderPhone: '+7 999 111-22-33' } }, 'a');
    expect(await g(id)).toMatchObject({ co_leader_phone: '+79991112233', phone: '+79215550011', address: 'ул. Новая 5' });
    const e = (await audits()).at(-1)!;
    expect(JSON.parse(e.after)).toEqual({ fields: ['coLeaderPhone'] });
    expect(JSON.stringify(await audits())).not.toMatch(/921|Новая/);
  });

  test('пустое значение стирает адрес', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { address: '' } }, 'a');
    expect((await g(id)).address).toBeNull();
  });

  test('группа из таблицы после правки считается заведённой в интерфейсе', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { comment: 'новое' } }, 'a');
    expect((await g(id)).source).toBe('ui');
  });

  test('пустое значение очищает необязательное поле', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { comment: '' } }, 'a');
    expect((await g(id)).comment).toBeNull();
  });

  test('«Не направлять» ставится и снимается отдельно от остального', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { doNotRefer: '1' } }, 'a');
    expect((await g(id)).do_not_refer).toBe(true);
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect((await g(id)).do_not_refer).toBe(true);
    await manager().updateGroup(id, { fields: { doNotRefer: '0' } }, 'a');
    expect((await g(id)).do_not_refer).toBe(false);
  });

  test.each([
    [{ fields: { district: 'Луна' } }], [{ fields: { people: '500' } }], [{ fields: { status: 'чепуха' } }], [{ fields: { leader: '' } }],
    [{ fields: { metro_station: 'x' } }], [{ fields: { id: '5' } }], [{ fields: {} }], [{}], [null],
  ])('неверное тело %j отклоняется, группа не меняется', async (body) => {
    const id = await group();
    expect(await manager().updateGroup(id, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await g(id)).toMatchObject({ people: 5, leader: 'Иван Петров', address: 'ул. Секретная 1' });
    expect(await audits()).toHaveLength(0);
  });

  test('в журнал идут названия изменённых полей без значений', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { comment: 'очень личное', people: '7' } }, 'a');
    const [e] = await audits();
    expect(e).toMatchObject({ actor: 'a', action: 'group.update', entity_type: 'group' });
    expect(JSON.parse(e.after)).toEqual({ fields: ['comment', 'people'] });
  });

  test('чужой номер — not_found', async () => {
    expect(await manager().updateGroup(99999, { fields: { people: '3' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('удаление', () => {
  test('группа скрывается, а не стирается, и это видно в журнале', async () => {
    const id = await group();
    expect(await manager().deleteGroup(id, 'a')).toEqual({ ok: true });
    expect((await g(id)).archived_at).not.toBeNull();
    expect((await audits()).map((e) => e.action)).toEqual(['group.delete']);
    expect(await manager().deleteGroup(id, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('заявка скрывается, а не стирается', async () => {
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, origin) VALUES ('join_group','Новая','Мария','ui') RETURNING id`)).rows[0]!.id;
    expect(await manager().deleteRequest(r, 'a')).toEqual({ ok: true });
    expect((await db.query('SELECT archived_at FROM requests WHERE id=$1', [r])).rows[0].archived_at).not.toBeNull();
    expect((await audits()).map((e) => e.action)).toEqual(['request.delete']);
  });
});

describe('удаление регистрации', () => {
  test('регистрация стирается вместе с заявками, в журнале только номер регистрации', async () => {
    const u = await new UsersRepo(db).createManual({ fio: 'Иван Петров', phone: '+79110001122', platform: 'telegram', byAdminId: 'x' });
    await db.query(`INSERT INTO requests (user_id, type, status, fio, origin) VALUES ($1, 'join_group', 'Новая', 'Иван Петров', 'ui')`, [u.id]);
    expect(await manager().deletePerson(u.id, 'boss')).toEqual({ ok: true });
    expect((await db.query('SELECT 1 FROM users')).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM requests')).rowCount).toBe(0);
    const [e] = await audits();
    expect(e).toMatchObject({ actor: 'boss', action: 'registration.delete', entity_type: 'user' });
    expect(JSON.parse(e.after)).toEqual({ registrationNo: u.registration_no });
    expect(await manager().deletePerson(u.id, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('координаторы', () => {
  test('заводится и правится по тем же правилам, что в старом дашборде', async () => {
    const m = manager();
    expect(await m.createCoordinator({ fields: { name: '' , role: 'Координатор' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    const created = await m.createCoordinator({ fields: { name: 'Анна Смирнова', role: 'Координатор' } }, 'a');
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error('нет id');
    expect(await m.updateCoordinator(created.id, { fields: { role: 'Руководитель' } }, 'a')).toEqual({ ok: true });
    expect((await db.query('SELECT name, role FROM coordinators WHERE id=$1', [created.id])).rows[0]).toEqual({ name: 'Анна Смирнова', role: 'Руководитель' });
  });

  test('переименование переписывает «в работе у» в заявках и координатора в группах', async () => {
    const m = manager();
    const c = await m.createCoordinator({ fields: { name: 'Анна Смирнова', role: 'Координатор' } }, 'a');
    if (!c.ok) throw new Error('нет id');
    await db.query(`INSERT INTO requests (type, status, fio, responsible, origin) VALUES ('join_group','Новая','М','Анна Смирнова','ui'), ('join_group','Новая','Н','Борис','ui')`);
    const gid = await group();
    await db.query(`UPDATE groups SET coordinator='Анна Смирнова' WHERE id=$1`, [gid]);
    await m.updateCoordinator(c.id, { fields: { name: 'Анна Иванова' } }, 'a');
    expect((await db.query('SELECT responsible FROM requests ORDER BY id')).rows.map((r) => r.responsible)).toEqual(['Анна Иванова', 'Борис']);
    expect((await g(gid)).coordinator).toBe('Анна Иванова');
  });

  test('удаление скрывает, повторное — not_found', async () => {
    const m = manager();
    const c = await m.createCoordinator({ fields: { name: 'Анна Смирнова', role: 'Координатор' } }, 'a');
    if (!c.ok) throw new Error('нет id');
    expect(await m.deleteCoordinator(c.id, 'a')).toEqual({ ok: true });
    expect(await m.deleteCoordinator(c.id, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await m.updateCoordinator(c.id, { fields: { role: 'x' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });
});
