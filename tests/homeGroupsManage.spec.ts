import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { TeamRolesRepo } from '../src/db/repos/teamRoles.repo.js';
import { GroupDirectionsRepo } from '../src/db/repos/groupDirections.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { createManager } from '../src/home-groups/manage.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const manager = () => createManager({
  groups: new GroupsRepo(db), coordinators: new CoordinatorsRepo(db), teamRoles: new TeamRolesRepo(db), directions: new GroupDirectionsRepo(db), requests: new RequestsRepo(db), users: new UsersRepo(db), audit: new AuditRepo(db),
});

async function group(): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, people, phone, phones, address, co_leader_phone, day, "time", comment, source)
     VALUES ('Иван Петров', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 5, '+79110001122', ARRAY['+79110001122'], 'ул. Секретная 1', '+79213334455', 'Пн', '19:00', 'заметка', 'таблица') RETURNING id`,
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
    await db.query(`UPDATE groups SET composition = 'Смешанная, Ментальная' WHERE id=$1`, [id]);
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect((await g(id)).composition).toBe('Смешанная, Ментальная');
    await manager().updateGroup(id, { fields: { composition: 'Мужская, Женская' } }, 'a');
    expect((await g(id)).composition).toBe('Мужская, Женская');
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

  test('поля старого дашборда (приём новых, обучение, № в реестре, возраст, «проверено», «40 дней») правятся и снимаются', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, {
      fields: { openToNew: 'По требованию', training: 'Да', no: '85', age: '25-40', checked: '1', campaignRegistered: '1' },
    }, 'a')).toEqual({ ok: true });
    expect(await g(id)).toMatchObject({
      open_to_new: 'По требованию', training: 'Да', no: 85, age: '25-40', checked: true, campaign_registered: true, people: 5,
    });
    // Правка другого поля флажки не трогает: их значения берутся из базы.
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect(await g(id)).toMatchObject({ checked: true, campaign_registered: true });
    await manager().updateGroup(id, { fields: { checked: '0', campaignRegistered: '0', openToNew: '' } }, 'a');
    expect(await g(id)).toMatchObject({ checked: false, campaign_registered: false, open_to_new: null });
  });

  test('«мест в группе» задаётся, очищается к общему значению и не теряется при правке других полей и из старого дашборда', async () => {
    const id = await group();
    await manager().updateGroup(id, { fields: { capacity: '6' } }, 'a');
    expect((await g(id)).capacity).toBe(6);
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect((await g(id)).capacity).toBe(6);
    // Старый дашборд шлёт форму целиком, но поля не знает: вместимость остаётся как была.
    const repo = new GroupsRepo(db);
    await repo.update(id, { leader: 'Иван Петров', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует' } as never);
    expect((await g(id)).capacity).toBe(6);
    await manager().updateGroup(id, { fields: { capacity: '' } }, 'a');
    expect((await g(id)).capacity).toBeNull();
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

describe('ведущий и соведущий — люди из «Людей»', () => {
  const card = async (name: string, archived = false) =>
    (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone, archived_at) VALUES ($1, '+79215550099', $2) RETURNING id`, [name, archived ? new Date() : null])).rows[0]!.id;
  const links = async (id: number) =>
    (await db.query(
      `SELECT leader_user_id::int AS lu, leader_person_id::int AS lp, co_leader_user_id::int AS cu, co_leader_person_id::int AS cp FROM groups WHERE id = $1`, [id],
    )).rows[0];
  const shown = async (id: number) => (await new GroupsRepo(db).forDashboard()).find((x) => x.id === id)!;

  test('ведущий — регистрация, соведущий — карточка; имя в группе — ФИО из карточки, записанные телефоны не трогаются', async () => {
    const id = await group();
    const u = await seedUser(db, { id: '501', fio: 'Петров Иван' });
    const p = await card('Петрова Мария');
    expect(await manager().updateGroup(id, { fields: { leaderKey: `u${u}`, coLeaderKey: `p${p}` } }, 'a')).toEqual({ ok: true });
    expect(await links(id)).toEqual({ lu: u, lp: null, cu: null, cp: p });
    expect(await g(id)).toMatchObject({ leader: 'Петров Иван', co_leader: 'Петрова Мария', phone: '+79110001122', co_leader_phone: '+79213334455', source: 'ui' });
    // Журнал — только названия полей, без ключей людей.
    expect(JSON.parse((await audits()).at(-1)!.after)).toEqual({ fields: ['leaderKey', 'coLeaderKey'] });
  });

  test('ФИО ведущего и соведущего текстом здесь не правится: только выбором человека', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { leader: 'Кто-то Другой' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await manager().updateGroup(id, { fields: { coLeader: 'Кто-то Другой' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await g(id)).leader).toBe('Иван Петров');
  });

  test('ведущего можно сменить, но не отвязать: без ведущего группы не бывает', async () => {
    const id = await group();
    const u = await seedUser(db, { id: '502' });
    const p = await card('Сидоров Пётр');
    await manager().updateGroup(id, { fields: { leaderKey: `u${u}` } }, 'a');
    await manager().updateGroup(id, { fields: { leaderKey: `p${p}` } }, 'a');
    expect(await links(id)).toMatchObject({ lu: null, lp: p });
    expect((await g(id)).leader).toBe('Сидоров Пётр');
    expect(await manager().updateGroup(id, { fields: { leaderKey: '' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await links(id)).toMatchObject({ lu: null, lp: p });
  });

  test('отвязанный соведущий уходит целиком: ссылка, имя и телефон, записанные в группе', async () => {
    const id = await group();
    await db.query(`UPDATE groups SET co_leader = 'Мария' WHERE id = $1`, [id]);
    const p = await card('Петрова Мария');
    await manager().updateGroup(id, { fields: { coLeaderKey: `p${p}` } }, 'a');
    expect(await manager().updateGroup(id, { fields: { coLeaderKey: '' } }, 'a')).toEqual({ ok: true });
    expect(await links(id)).toMatchObject({ cu: null, cp: null });
    expect(await g(id)).toMatchObject({ co_leader: null, co_leader_phone: null });
  });

  test('человек из заявки без регистрации: при привязке ему заводится карточка с данными из заявки', async () => {
    const id = await group();
    const r = (await db.query<{ id: number }>(
      `INSERT INTO requests (type, fio, phone, phones, age, place, hobby, status, origin) VALUES ('join_group', 'Заявкин Олег', '+79215550077', ARRAY['+79215550077'], '35', 'Беговая', 'гитара', 'Новая', 'таблица') RETURNING id`,
    )).rows[0]!.id;
    expect(await manager().updateGroup(id, { fields: { coLeaderKey: `r${r}` } }, 'a')).toEqual({ ok: true });
    const l = await links(id);
    expect(l.cp).not.toBeNull();
    expect((await db.query('SELECT full_name, phone, age, place, hobby FROM persons WHERE id = $1', [l.cp])).rows[0])
      .toEqual({ full_name: 'Заявкин Олег', phone: '+79215550077', age: '35', place: 'Беговая', hobby: 'гитара' });
    expect((await g(id)).co_leader).toBe('Заявкин Олег');
  });

  test('правка, которая не прошла проверку, карточку человеку из заявки не заводит', async () => {
    const id = await group();
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, fio, status, origin) VALUES ('join_group', 'Заявкин Олег', 'Новая', 'таблица') RETURNING id`)).rows[0]!.id;
    expect(await manager().updateGroup(id, { fields: { coLeaderKey: `r${r}`, people: 'много' } }, 'a')).toMatchObject({ ok: false });
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });

  test('ФИО, поправленное в «Людях», сразу видно в группе: имя берётся из карточки, а не из текста группы', async () => {
    const id = await group();
    const p = await card('Петрова Мария');
    await manager().updateGroup(id, { fields: { leaderKey: `p${p}` } }, 'a');
    await db.query(`UPDATE persons SET full_name = 'Петрова-Сидорова Мария' WHERE id = $1`, [p]);
    expect(await shown(id)).toMatchObject({ leader: 'Петрова-Сидорова Мария' });
    // Карточку удалили — показываем то, что записано в группе.
    await db.query('UPDATE persons SET archived_at = now() WHERE id = $1', [p]);
    expect((await shown(id)).leader).toBe('Петрова Мария');
  });

  test('правка других полей ссылки не трогает', async () => {
    const id = await group();
    const u = await seedUser(db, { id: '503' });
    await manager().updateGroup(id, { fields: { coLeaderKey: `u${u}` } }, 'a');
    await manager().updateGroup(id, { fields: { comment: 'x' } }, 'a');
    expect(await links(id)).toMatchObject({ cu: u, cp: null });
  });

  test.each([
    ['не ключ вовсе', 'Иванов'],
    ['ключ без номера', 'u'],
  ])('%s — отказ', async (_, key) => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { leaderKey: key } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('удалённую карточку и незавершённую регистрацию не выбрать', async () => {
    const id = await group();
    const gone = await card('Удалённый', true);
    const half = await seedUser(db, { id: '504', registered: false });
    expect(await manager().updateGroup(id, { fields: { leaderKey: `p${gone}` } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await manager().updateGroup(id, { fields: { coLeaderKey: `u${half}` } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await links(id)).toEqual({ lu: null, lp: null, cu: null, cp: null });
  });

  test('один человек ведущим и соведущим сразу — отказ, и в одной правке, и против уже записанного', async () => {
    const id = await group();
    const u = await seedUser(db, { id: '505' });
    expect(await manager().updateGroup(id, { fields: { leaderKey: `u${u}`, coLeaderKey: `u${u}` } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    await manager().updateGroup(id, { fields: { leaderKey: `u${u}` } }, 'a');
    expect(await manager().updateGroup(id, { fields: { coLeaderKey: `u${u}` } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await links(id)).toEqual({ lu: u, lp: null, cu: null, cp: null });
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
    expect(await m.updateCoordinator(created.id, { fields: { role: 'Старший координатор' } }, 'a')).toEqual({ ok: true });
    expect((await db.query('SELECT c.name, coordinator_role_names(c.id) AS role FROM coordinators c WHERE c.id=$1', [created.id])).rows[0]).toEqual({ name: 'Анна Смирнова', role: 'Старший координатор' });
  });

  test('новый интерфейс отмечает несколько ролей из справочника; правка имени роли не трогает', async () => {
    const m = manager();
    const roleId = async (name: string) => (await db.query<{ id: number }>('SELECT id::int AS id FROM team_roles WHERE name = $1', [name])).rows[0]!.id;
    const [distributor, catalyst, senior] = await Promise.all(['Распределитель', 'Катализатор', 'Старший координатор'].map(roleId));
    const created = await m.createCoordinator({ fields: { name: 'Анна Смирнова', roleIds: `${distributor}, ${catalyst}` } }, 'a');
    if (!created.ok) throw new Error('нет id');
    const now = async () => (await db.query(
      'SELECT name, ARRAY(SELECT role_id::int FROM coordinator_roles WHERE coordinator_id = c.id ORDER BY role_id) AS roles FROM coordinators c WHERE id=$1',
      [created.id],
    )).rows[0];
    const sorted = (...ids: number[]) => [...ids].sort((a, b) => a - b);
    expect(await now()).toEqual({ name: 'Анна Смирнова', roles: sorted(distributor!, catalyst!) });
    await m.updateCoordinator(created.id, { fields: { name: 'Анна Иванова' } }, 'a');
    expect(await now()).toEqual({ name: 'Анна Иванова', roles: sorted(distributor!, catalyst!) });
    expect(await m.updateCoordinator(created.id, { fields: { roleIds: String(senior) } }, 'a')).toEqual({ ok: true });
    expect(await now()).toEqual({ name: 'Анна Иванова', roles: [senior] });
    expect(await m.updateCoordinator(created.id, { fields: { roleIds: '' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request', message: 'Отметьте хотя бы одну роль.' });
    const [entry] = (await db.query("SELECT after::text AS after FROM audit_log WHERE action = 'coordinator.create'")).rows;
    expect(JSON.parse(entry.after)).toEqual({ role: 'Катализатор, Распределитель' });
  });

  test('роли, которой нет в справочнике, не поставить: понятный отказ вместо ошибки базы', async () => {
    const m = manager();
    expect(await m.createCoordinator({ fields: { name: 'Анна', roleIds: '999' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request', message: expect.stringMatching(/нет в справочнике/) });
    const c = await m.createCoordinator({ fields: { name: 'Анна', role: 'Координатор' } }, 'a');
    if (!c.ok) throw new Error('нет id');
    expect(await m.updateCoordinator(c.id, { fields: { roleIds: '1, 999' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
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

describe('«Работает только в кампанию» и «40 дней» у потенциальных', () => {
  test('галочка «Работает только в кампанию» ставится и снимается правкой и не теряется при правке другого поля', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { campaignOnly: '1' } }, 'a')).toEqual({ ok: true });
    expect((await g(id)).campaign_only).toBe(true);
    await manager().updateGroup(id, { fields: { comment: 'другая' } }, 'a');
    expect((await g(id)).campaign_only).toBe(true);
    await manager().updateGroup(id, { fields: { campaignOnly: '' } }, 'a');
    expect((await g(id)).campaign_only).toBe(false);
  });

  test('статус «Кампания» правкой поставить нельзя', async () => {
    const id = await group();
    expect(await manager().updateGroup(id, { fields: { status: 'Кампания' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('потенциальная группа заводится с «40 днями», если о них не сказано; сказанное явно — как сказано', async () => {
    const repo = new GroupsRepo(db);
    const base = { leader: 'Ведущий', district: 'Приморский', direction: 'Молодёжное служение' } as const;
    expect((await repo.create({ ...base, status: 'Потенциальная' }, 'бот')).campaign_registered).toBe(true);
    expect((await repo.create({ ...base, status: 'Потенциальная', campaignRegistered: false }, 'ui')).campaign_registered).toBe(false);
    expect((await repo.create({ ...base, status: 'Функционирует' }, 'бот')).campaign_registered).toBe(false);
  });
});
