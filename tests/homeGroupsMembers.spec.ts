import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { MembersRepo, parsePersonKey } from '../src/db/repos/members.repo.js';
import { createMembers } from '../src/home-groups/members.js';
import { composeService, engine } from '../src/home-groups/composition.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

/** Человек заявки в «Людях»: у заявки без регистрации — её карточка (миграция 057). */
const keyOfRequest = async (id: number): Promise<string> =>
  (await db.query<{ key: string }>(`SELECT CASE WHEN user_id IS NOT NULL THEN 'u' || user_id ELSE 'p' || person_id END AS key FROM requests WHERE id = $1`, [id])).rows[0]!.key;

const svc = () => createMembers({ members: new MembersRepo(db), audit: new AuditRepo(db), now: () => new Date('2026-10-11T10:00:00Z') });
const seedGroup = async () => (await db.query<{ id: number }>(
  `INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Иван', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
const seedUser = async (name = 'Мария Участница') => (await db.query<{ id: number }>(
  `INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, registration_no, registered_at, complete)
   VALUES ('telegram', 'u' || nextval('users_id_seq'), '', $1, '+79110001122', nextval('registration_no_seq'), now(), true) RETURNING id`, [name])).rows[0]!.id;
const seedRequestOnly = async () => (await db.query<{ id: number }>(
  `INSERT INTO requests (type, status, fio, phone, origin) VALUES ('join_group', 'Новая', 'Пётр Из Таблицы', '+79215550011', 'таблица') RETURNING id`)).rows[0]!.id;
const rows = async () => (await db.query('SELECT group_id, user_id, request_id, person_id, joined_on::text AS joined_on, note, archived_at FROM group_members ORDER BY id')).rows;
const audits = async () => (await db.query(`SELECT action, after::text AS after FROM audit_log ORDER BY id`)).rows;

describe('ключ человека в справочнике', () => {
  test.each([['u12', { kind: 'u', id: 12 }], ['r345', { kind: 'r', id: 345 }], ['p7', { kind: 'p', id: 7 }]])('«%s» разбирается', (key, ref) => {
    expect(parsePersonKey(key)).toEqual(ref);
  });
  test.each(['', 'x1', 'u', 'u-1', 'u1; DROP', 'U12', 5, null, undefined])('«%s» не ключ', (key) => {
    expect(parsePersonKey(key)).toBeNull();
  });
});

describe('состав группы: ссылки на справочник людей', () => {
  test('участника из справочника добавляют по ключу: имя и телефон не копируются, а читаются по ссылке', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    expect(await svc().add(g, { personKey: `u${u}`, joinedOn: '2026-09-01', note: 'ходит давно' }, 'a')).toMatchObject({ ok: true, personKey: `u${u}` });
    expect(await rows()).toEqual([{ group_id: g, user_id: u, request_id: null, person_id: null, joined_on: '2026-09-01', note: 'ходит давно', archived_at: null }]);
    const all = await new MembersRepo(db).all();
    expect(all[0]).toMatchObject({ personKey: `u${u}`, full_name: 'Мария Участница', phone: '+79110001122' });
    await db.query(`UPDATE users SET full_name = 'Мария Новая' WHERE id = $1`, [u]);
    expect((await new MembersRepo(db).all())[0]!.full_name).toBe('Мария Новая');
  });

  test('человека из заявки без регистрации тоже можно добавить: в состав встаёт его карточка, а не заявка', async () => {
    const g = await seedGroup();
    const r = await seedRequestOnly();
    expect(await svc().add(g, { personKey: `r${r}` }, 'a')).toMatchObject({ ok: true });
    expect((await new MembersRepo(db).all())[0]).toMatchObject({ personKey: await keyOfRequest(r), full_name: 'Пётр Из Таблицы' });
  });

  test('новый человек «по плюсу»: карточка появляется в справочнике и сразу в составе, телефон приводится к +7…', async () => {
    const g = await seedGroup();
    const out = await svc().add(g, { newPerson: { fio: ' Анна  Новая ', phone: '8 921 555-00-11', age: '35', place: 'Купчино' }, joinedOn: '2026-08-01' }, 'a');
    expect(out).toMatchObject({ ok: true, personKey: expect.stringMatching(/^p\d+$/) });
    const persons = (await db.query('SELECT full_name, phone, age, place, created_by FROM persons')).rows;
    expect(persons).toEqual([{ full_name: 'Анна Новая', phone: '+79215550011', age: '35', place: 'Купчино', created_by: 'a' }]);
    expect((await new MembersRepo(db).all())[0]).toMatchObject({ full_name: 'Анна Новая', joined_on: '2026-08-01' });
  });

  test('новый человек не заводится, если не удалось добавить в состав: нет «осиротевших» карточек', async () => {
    expect(await svc().add(99999, { newPerson: { fio: 'Анна' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });

  test('нужно выбрать ровно одно: человека из справочника или нового', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    for (const body of [{}, { personKey: `u${u}`, newPerson: { fio: 'Я' } }, null, 'текст']) {
      expect(await svc().add(g, body, 'a'), JSON.stringify(body)).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });

  test.each([
    [{ personKey: 'u999999' }, 'not_found'], [{ personKey: 'x1' }, 'bad_request'], [{ personKey: 'p999999' }, 'not_found'],
    [{ newPerson: {} }, 'bad_request'], [{ newPerson: { fio: '' } }, 'bad_request'], [{ newPerson: { fio: 'Я', extra: 'x' } }, 'bad_request'],
    [{ newPerson: { fio: 'Я' }, joinedOn: '2027-01-01' }, 'bad_request'], [{ newPerson: { fio: 'Я' }, joinedOn: 'вчера' }, 'bad_request'],
    [{ newPerson: { fio: 'Я' }, note: 'я'.repeat(301) }, 'bad_request'], [{ newPerson: { fio: 'я'.repeat(201) } }, 'bad_request'],
  ])('неверное тело %j → %s, в базу ничего не пишется', async (body, error) => {
    const g = await seedGroup();
    expect(await svc().add(g, body, 'a')).toMatchObject({ ok: false, error });
    expect(await rows()).toEqual([]);
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });

  test('участника, который не прошёл регистрацию, добавить нельзя; человека из любого обращения — можно, он в «Людях»', async () => {
    const g = await seedGroup();
    const unregistered = (await db.query<{ id: number }>(`INSERT INTO users (platform, platform_user_id, chat_id) VALUES ('telegram', 'z1', '') RETURNING id`)).rows[0]!.id;
    expect(await svc().add(g, { personKey: `u${unregistered}` }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    const q = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, origin) VALUES ('question', 'Новая', 'Вопрос', 'ui') RETURNING id`)).rows[0]!.id;
    expect(await svc().add(g, { personKey: await keyOfRequest(q) }, 'a')).toMatchObject({ ok: true });
  });

  test('одного человека в одну группу дважды не добавить; в другую можно', async () => {
    const g1 = await seedGroup();
    const g2 = await seedGroup();
    const u = await seedUser();
    await svc().add(g1, { personKey: `u${u}` }, 'a');
    expect(await svc().add(g1, { personKey: `u${u}` }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await svc().add(g2, { personKey: `u${u}` }, 'a')).toMatchObject({ ok: true });
  });

  test('того, кого уже направили в эту группу через сервис, вручную не вносят: он и так в составе', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    await db.query(`INSERT INTO requests (user_id, type, status, fio, group_id, origin) VALUES ($1, 'join_group', 'Исполнена', 'Мария', $2, 'ui')`, [u, g]);
    expect(await svc().add(g, { personKey: `u${u}` }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
  });

  test('убрав человека из состава, его можно добавить снова', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    const first = await svc().add(g, { personKey: `u${u}` }, 'a');
    if (!first.ok) throw new Error('нет id');
    expect(await svc().remove(first.id, 'a')).toEqual({ ok: true });
    expect(await new MembersRepo(db).all()).toEqual([]);
    expect(await svc().add(g, { personKey: `u${u}` }, 'a')).toMatchObject({ ok: true });
  });

  test('в строке состава правятся только дата и заметка; имя и телефон — нет', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    const added = await svc().add(g, { personKey: `u${u}`, note: 'старая' }, 'a');
    if (!added.ok) throw new Error('нет id');
    expect(await svc().update(added.id, { fields: { note: '', joinedOn: '2026-09-05' } }, 'a')).toEqual({ ok: true });
    expect((await rows())[0]).toMatchObject({ note: null, joined_on: '2026-09-05' });
    expect(await svc().update(added.id, { fields: { fio: 'Другое имя' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc().update(added.id, { fields: {} }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc().update(99999, { fields: { note: 'x' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('карточка, внесённая вручную, правится и скрывается; из составов она исчезает вместе с карточкой', async () => {
    const g = await seedGroup();
    const added = await svc().add(g, { newPerson: { fio: 'Анна', phone: '+79215550011' } }, 'a');
    if (!added.ok) throw new Error('нет id');
    const id = Number(added.personKey.slice(1));
    expect(await svc().updatePerson(id, { fields: { fio: 'Анна Смирнова', place: 'Невский' } }, 'a')).toEqual({ ok: true });
    expect((await new MembersRepo(db).all())[0]).toMatchObject({ full_name: 'Анна Смирнова', phone: '+79215550011' });
    expect(await svc().updatePerson(id, { fields: { fio: '' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc().deletePerson(id, 'boss')).toEqual({ ok: true });
    expect(await new MembersRepo(db).all()).toEqual([]);
    expect(await svc().deletePerson(id, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('удалённая заявка человека из состава не убирает: в составе человек, а не заявка; убранная группа — убирает', async () => {
    const g = await seedGroup();
    const r = await seedRequestOnly();
    await svc().add(g, { personKey: `r${r}` }, 'a');
    await db.query('UPDATE requests SET archived_at = now() WHERE id = $1', [r]);
    expect(await new MembersRepo(db).all()).toHaveLength(1);
    await db.query('UPDATE groups SET archived_at = now() WHERE id = $1', [g]);
    expect(await new MembersRepo(db).all()).toEqual([]);
  });

  test('в журнал идут номера и названия полей, без имён и телефонов', async () => {
    const g = await seedGroup();
    const added = await svc().add(g, { newPerson: { fio: 'Анна Смирнова', phone: '+79215550011' }, note: 'секрет' }, 'a');
    if (!added.ok) throw new Error('нет id');
    await svc().update(added.id, { fields: { note: 'другое' } }, 'b');
    await svc().updatePerson(Number(added.personKey.slice(1)), { fields: { phone: '+79990001122' } }, 'b');
    await svc().remove(added.id, 'b');
    const log = await audits();
    expect(log.map((e) => e.action)).toEqual(['group.member.add', 'group.member.update', 'person.update', 'group.member.remove']);
    expect(JSON.stringify(log)).not.toMatch(/Анна|Смирнова|921|999|секрет|другое/);
  });
});

describe('новая карточка без группы («+ Новый человек» при выборе ведущего)', () => {
  test('заводится с ФИО и телефоном, возвращает ключ «p…»; в журнале — названия полей, без имени', async () => {
    const out = await svc().createPerson({ fields: { fio: 'Новикова Тамара', phone: '8 921 000-11-22' } }, 'a');
    expect(out).toEqual({ ok: true, personKey: expect.stringMatching(/^p\d+$/) });
    const id = Number((out as { personKey: string }).personKey.slice(1));
    expect((await db.query('SELECT full_name, phone FROM persons WHERE id = $1', [id])).rows[0]).toEqual({ full_name: 'Новикова Тамара', phone: '+79210001122' });
    expect(JSON.stringify((await db.query('SELECT after FROM audit_log')).rows)).not.toContain('Новикова');
  });

  test('без ФИО — отказ, карточки нет', async () => {
    expect(await svc().createPerson({ fields: { fio: '  ', phone: '+79210001122' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });
});

describe('справочник людей и составы в представлениях', () => {
  test('внесённая вручную карточка появляется в «Людях» и показывает группы, где состоит; участник из бота — тоже', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    const svcc = composeService(db, engine, { defaultCapacity: 10, ttlMs: 0 });
    await svcc.members.add(g, { personKey: `u${u}` }, 'a');
    const added = await svcc.members.add(g, { newPerson: { fio: 'Анна Новая', place: 'Приморский' } }, 'a');
    if (!added.ok) throw new Error('нет id');
    const code = `ДГ-${String(g).padStart(4, '0')}`;

    const views = await svcc.views();
    const people = views.people.items;
    expect(people.find((p) => p.key === `u${u}`)).toMatchObject({ groups: [code], personId: null });
    expect(people.find((p) => p.key === added.personKey)).toMatchObject({ fio: 'Анна Новая', from: 'Внесён вручную', district: 'Приморский', groups: [code], personId: Number(added.personKey.slice(1)) });
    expect(views.groups.items.find((x) => x.id === g)!.members.map((m) => [m.kind, m.fio, m.personKey])).toEqual([
      ['manual', 'Мария Участница', `u${u}`], ['manual', 'Анна Новая', added.personKey],
    ]);
  });

  test('после утверждения человек сам в составе группы, и вносить его вручную не нужно', async () => {
    const g = await seedGroup();
    const u = await seedUser();
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (user_id, type, status, fio, origin) VALUES ($1, 'join_group', 'Новая', 'Мария', 'ui') RETURNING id`, [u])).rows[0]!.id;
    const svcc = composeService(db, engine, { defaultCapacity: 10, ttlMs: 0 });
    await svcc.placement.approve(r, g, 'boss', { force: true, defaultCapacity: 10 });
    const views = await svcc.views();
    expect(views.groups.items.find((x) => x.id === g)!.members.map((m) => [m.kind, m.personKey])).toEqual([['placed', `u${u}`]]);
    expect(views.people.items.find((p) => p.key === `u${u}`)!.groups).toEqual([`ДГ-${String(g).padStart(4, '0')}`]);
    // Вернули заявку в работу — человек из состава ушёл сам.
    await svcc.placement.reopen(r, 'boss');
    expect((await svcc.views()).groups.items.find((x) => x.id === g)!.members).toEqual([]);
  });
});
