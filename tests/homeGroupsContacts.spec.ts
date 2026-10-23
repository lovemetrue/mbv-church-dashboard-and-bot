import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ContactsRepo } from '../src/db/repos/contacts.repo.js';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { MembersRepo } from '../src/db/repos/members.repo.js';
import { createMembers } from '../src/home-groups/members.js';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { createContacts, parseContactPatch } from '../src/home-groups/contacts.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const svc = () => createContacts({ contacts: new ContactsRepo(db) });
const seedUser = async () => (await db.query<{ id: number }>(
  `INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, age, location, address_raw, schedule_raw, registration_no, registered_at, complete)
   VALUES ('telegram', 'u' || nextval('users_id_seq'), '', 'Мария Участница', '+79110001122', '26-35', 'Приморский', 'Савушкина 5', 'среда вечером',
           nextval('registration_no_seq'), now(), true) RETURNING id`)).rows[0]!.id;
const seedRequest = async (userId: number | null, extra = '') => (await db.query<{ id: number }>(
  `INSERT INTO requests (type, status, user_id, origin${extra ? ', ' + extra.split('|')[0] : ''})
   VALUES ('join_group', 'Новая', $1, 'бот'${extra ? ', ' + extra.split('|')[1] : ''}) RETURNING id`, [userId])).rows[0]!.id;
const user = async (id: number) => (await db.query('SELECT full_name, phone, age, location, address_raw, schedule_raw, hobby, profession, family_status, admin_comment FROM users WHERE id = $1', [id])).rows[0];
const request = async (id: number) => (await db.query('SELECT fio, phone, phones, age, place, manual_street, manual_schedule, origin, hobby, profession, family_status, note FROM requests WHERE id = $1', [id])).rows[0];

describe('разбор тела правки', () => {
  test('пустая строка очищает поле, телефон приводится к +7…, ФИО пустым быть не может', () => {
    expect(parseContactPatch({ fields: { phone: '8 921 555-00-11', address: '  ', age: ' 36-45 ' } })).toEqual({ phone: '+79215550011', address: null, age: '36-45' });
    expect(parseContactPatch({ fields: { fio: '  ' } })).toBe('ФИО не может быть пустым.');
    expect(parseContactPatch({ fields: { phone: 'позвонить Марине' } })).toMatch(/телефон/);
    expect(parseContactPatch({ fields: { surname: 'x' } })).toMatch(/нельзя/);
    expect(parseContactPatch({ fields: { hobby: ' вязание ', family: '', note: 'x' } })).toEqual({ hobby: 'вязание', family: null, note: 'x' });
    expect(parseContactPatch({ fields: {} })).toBe('Нечего менять.');
    expect(parseContactPatch({ fields: { address: 'я'.repeat(201) } })).toMatch(/длинный/);
  });
});

describe('правка человека из справочника', () => {
  test('регистрация: данные меняются в ней и в переписанных полях её заявок, а пустые поля заявки остаются пустыми', async () => {
    const u = await seedUser();
    const withOverride = await seedRequest(u, "fio, phone, manual_street|'Старое Имя', '+79000000000', 'Старая 1'");
    const plain = await seedRequest(u);
    const out = await svc().update(`u${u}`, { fields: { fio: 'Мария Новая', phone: '+7 921 555-00-11', address: 'Коллонтай 5', schedule: 'пятница' } }, 'тест');
    expect(out).toEqual({ ok: true });
    expect(await user(u)).toMatchObject({ full_name: 'Мария Новая', phone: '+79215550011', address_raw: 'Коллонтай 5', schedule_raw: 'пятница' });
    expect(await request(withOverride)).toMatchObject({ fio: 'Мария Новая', phone: '+79215550011', manual_street: 'Коллонтай 5', manual_schedule: null });
    expect(await request(plain)).toMatchObject({ fio: null, phone: null, manual_street: null });
  });

  test('заявка без регистрации: адрес и время пишутся в правку координатора, происхождение из таблицы становится ui', async () => {
    const id = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', 'Новая', 'Пётр', 'таблица') RETURNING id`)).rows[0]!.id;
    expect(await svc().update(`r${id}`, { fields: { address: 'Юкки', schedule: 'вторник', phone: '8 911 000-11-22' } }, 'тест')).toEqual({ ok: true });
    expect(await request(id)).toMatchObject({ manual_street: 'Юкки', manual_schedule: 'вторник', phone: '+79110001122', phones: ['+79110001122'], origin: 'ui' });
  });

  test('человек не найден или ключ чужой — ошибка, в журнал ничего не пишется; в журнале только названия полей', async () => {
    expect(await svc().update('u999', { fields: { fio: 'А' } }, 'тест')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await svc().update('p5', { fields: { fio: 'А' } }, 'тест')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT 1 FROM audit_log')).rowCount).toBe(0);
    const u = await seedUser();
    await svc().update(`u${u}`, { fields: { fio: 'Секретное Имя' } }, 'тест');
    const after = (await db.query<{ after: string }>(`SELECT after::text AS after FROM audit_log`)).rows[0]!.after;
    expect(after).toContain('fio');
    expect(after).not.toContain('Секретное');
  });
});

describe('правка из заявки доходит до человека', () => {
  test('«Править данные» с адресом и временем пишет в заявку и в регистрацию, а другие его заявки с правками обновляются', async () => {
    const u = await seedUser();
    const first = await seedRequest(u);
    const second = await seedRequest(u, "manual_street|'Старая 1'");
    const out = await new PlacementRepo(db).editRequest(first, { address: 'Коллонтай 5', schedule: 'среда', fio: 'Мария Новая' }, 'тест');
    expect(out).toEqual({ ok: true });
    expect(await request(first)).toMatchObject({ manual_street: 'Коллонтай 5', manual_schedule: 'среда', fio: 'Мария Новая' });
    expect(await user(u)).toMatchObject({ full_name: 'Мария Новая', address_raw: 'Коллонтай 5', schedule_raw: 'среда' });
    expect(await request(second)).toMatchObject({ manual_street: 'Коллонтай 5', fio: null });
  });

  test('комментарий остаётся только в заявке', async () => {
    const u = await seedUser();
    const r = await seedRequest(u);
    await new PlacementRepo(db).editRequest(r, { note: 'позвонить после 18' }, 'тест');
    expect(await user(u)).toMatchObject({ full_name: 'Мария Участница' });
  });

  test('хобби, профессия, семейное положение: у регистрации и в переписанных полях заявок, а комментарий — каждый свой', async () => {
    const u = await seedUser();
    const own = await seedRequest(u, "hobby, note|'старое хобби', 'комментарий заявки'");
    const plain = await seedRequest(u);
    expect(await svc().update(`u${u}`, { fields: { hobby: 'вязание', profession: 'врач', family: 'замужем', note: 'позвонить вечером' } }, 'тест')).toEqual({ ok: true });
    expect(await user(u)).toMatchObject({ hobby: 'вязание', profession: 'врач', family_status: 'замужем', admin_comment: 'позвонить вечером' });
    expect(await request(own)).toMatchObject({ hobby: 'вязание', profession: null, note: 'комментарий заявки' });
    expect(await request(plain)).toMatchObject({ hobby: null, note: null });
  });

  test('«Править данные» заявки: профессия и семейное положение уходят и в регистрацию, комментарий — только в заявку', async () => {
    const u = await seedUser();
    const r = await seedRequest(u);
    expect(await new PlacementRepo(db).editRequest(r, { profession: 'учитель', family: 'женат', note: 'только для заявки' }, 'тест')).toEqual({ ok: true });
    expect(await request(r)).toMatchObject({ profession: 'учитель', family_status: 'женат', note: 'только для заявки' });
    expect(await user(u)).toMatchObject({ profession: 'учитель', family_status: 'женат', admin_comment: null });
  });

  test('карточка, внесённая вручную, хранит те же поля: адрес, время, хобби, профессию, семейное положение', async () => {
    const members = createMembers({ members: new MembersRepo(db), audit: new AuditRepo(db) });
    const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Иван', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
    expect(await members.add(g, { newPerson: { fio: 'Анна Новая', address: 'Юкки', hobby: 'бег' } }, 'тест')).toMatchObject({ ok: true });
    const id = (await db.query<{ id: number }>('SELECT id FROM persons')).rows[0]!.id;
    expect(await members.updatePerson(id, { fields: { schedule: 'вторник', profession: 'повар', family: 'вдова' } }, 'тест')).toEqual({ ok: true });
    expect((await db.query('SELECT address, schedule, hobby, profession, family_status FROM persons')).rows[0]).toEqual({ address: 'Юкки', schedule: 'вторник', hobby: 'бег', profession: 'повар', family_status: 'вдова' });
    expect(await members.updatePerson(id, { fields: { address: 'я'.repeat(201) } }, 'тест')).toMatchObject({ ok: false, error: 'bad_request' });
  });
});
