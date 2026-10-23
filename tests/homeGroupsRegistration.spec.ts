import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { RequestsRepo, type RequestWithUser } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { createRegistrar } from '../src/home-groups/registration.js';
import { createRecordCreator } from '../src/home-groups/create.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const notified: RequestWithUser[] = [];
beforeEach(() => { notified.length = 0; });

const registrar = () => createRegistrar({
  users: new UsersRepo(db), requests: new RequestsRepo(db), audit: new AuditRepo(db),
  notify: async (r) => { notified.push(r); },
});

describe('регистрация участника в «Домашних группах»', () => {
  test('участник заводится, а ответ про Малую группу создаёт заявку origin=ui и уведомляет служителя', async () => {
    const out = await registrar().register({ fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22', mdgStatus: 'join', church: 'Миссия' } }, 'p_ivanova');
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error('нет результата');
    const { rows: users } = await db.query('SELECT full_name, registered_by, registration_no FROM users WHERE id=$1', [out.id]);
    expect(users[0]).toMatchObject({ full_name: 'Иван Петров', registered_by: 'p_ivanova' });
    expect(out.registrationNo).toBe(users[0].registration_no);
    const { rows: reqs } = await db.query('SELECT type, origin, user_id FROM requests');
    expect(reqs).toEqual([{ type: 'join_group', origin: 'ui', user_id: out.id }]);
    expect(notified.map((r) => r.id)).toEqual([expect.any(Number)]);
  });

  test('удобное время и улица с домом сохраняются в регистрацию и сразу видны в заявке, по ним идёт подбор', async () => {
    const out = await registrar().register({
      fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22', mdgStatus: 'join', schedule: 'среда вечером', address: 'ул. Есенина, 1' },
    }, 'p_ivanova');
    if (!out.ok) throw new Error('регистрация не прошла');
    const { rows: users } = await db.query('SELECT schedule_raw, address_raw FROM users WHERE id=$1', [out.id]);
    expect(users[0]).toEqual({ schedule_raw: 'среда вечером', address_raw: 'ул. Есенина, 1' });
    // Заявка своих копий не держит: время и адрес читаются из регистрации, как у анкеты бота.
    const request = (await new RequestsRepo(db).forDashboard()).find((r) => r.user_id === out.id);
    expect(request).toMatchObject({ schedule: 'среда вечером', address: 'ул. Есенина, 1' });
  });

  test('удобные дни и время галочками, хобби, профессия и семья сохраняются в регистрацию', async () => {
    const out = await registrar().register({
      fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22', mdgStatus: 'join', days: 'сб', time: 'утро', hobby: 'футбол', profession: 'инженер', family: 'холост' },
    }, 'a');
    if (!out.ok) throw new Error('регистрация не прошла');
    const { rows } = await db.query('SELECT schedule_raw, hobby, profession, family_status FROM users WHERE id=$1', [out.id]);
    expect(rows[0]).toEqual({ schedule_raw: 'сб утром', hobby: 'футбол', profession: 'инженер', family_status: 'холост' });
  });

  test('без ответа про Малую группу заявки нет и уведомления нет', async () => {
    const out = await registrar().register({ fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22' } }, 'a');
    expect(out.ok).toBe(true);
    expect((await db.query('SELECT 1 FROM requests')).rowCount).toBe(0);
    expect(notified).toHaveLength(0);
  });

  test('в журнал попадают номер регистрации и заявка, но не имя и телефон', async () => {
    const out = await registrar().register({ fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22', mdgStatus: 'open' } }, 'a');
    expect(out.ok).toBe(true);
    const { rows } = await db.query("SELECT actor, after::text AS after FROM audit_log WHERE action='registration.create'");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('a');
    // Телефон ищем целиком, а не «911»: номер заявки в журнале растёт от прогона к прогону и сам бывает 911.
    expect(rows[0].after).not.toMatch(/Иван|Петров|9110001122|000-11-22/);
  });

  test.each([
    [null], ['текст'], [{}], [{ fields: { phone: '+7 911 000-11-22' } }], [{ fields: { fio: 'Иван' } }],
    [{ fields: { fio: 'Иван', phone: '+7 911 000-11-22', mdgStatus: 'чепуха' } }],
  ])('неверное тело %j отклоняется без записи в базу', async (body) => {
    expect(await registrar().register(body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT 1 FROM users')).rowCount).toBe(0);
  });

  test('QR и данные карточки отдаются по номеру участника, для чужого номера — null', async () => {
    const r = registrar();
    const out = await r.register({ fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22' } }, 'a');
    if (!out.ok) throw new Error('нет результата');
    const png = await r.qr(out.id);
    expect(png?.subarray(1, 4).toString()).toBe('PNG');
    expect(await r.card(out.id)).toMatchObject({ registrationNo: out.registrationNo, fullName: 'Иван Петров' });
    expect(await r.qr(999999)).toBeNull();
    expect(await r.card(999999)).toBeNull();
  });
});

describe('заявка из «+ Создать» уведомляет служителя', () => {
  const creator = (extra: { notify?: (r: RequestWithUser) => Promise<void> }) => createRecordCreator({
    requests: new RequestsRepo(db), groups: new GroupsRepo(db), audit: new AuditRepo(db), ...extra,
  });

  test('созданная заявка уходит в уведомление ровно один раз', async () => {
    const out = await creator({ notify: async (r) => { notified.push(r); } }).request(
      { fields: { fio: 'Анна Смирнова', type: 'join_group', status: 'Новая' } }, 'a');
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error('нет результата');
    expect(notified.map((r) => r.id)).toEqual([out.id]);
  });

  test('без уведомителя заявка заводится молча', async () => {
    const out = await creator({}).request({ fields: { fio: 'Анна Смирнова', type: 'join_group', status: 'Новая' } }, 'a');
    expect(out.ok).toBe(true);
  });

  test('адрес, удобные дни и время, хобби, профессия и семья сохраняются в заявку и видны подбору', async () => {
    const out = await creator({}).request({ fields: {
      fio: 'Анна Смирнова', type: 'join_group', status: 'Новая',
      address: 'Савушкина 5', days: 'ср,пн', time: 'вечер', hobby: 'хор', profession: 'врач', family: 'замужем, двое детей',
    } }, 'a');
    if (!out.ok) throw new Error(out.message);
    const { rows } = await db.query('SELECT manual_street, manual_schedule, hobby, profession, family_status FROM requests WHERE id = $1', [out.id]);
    expect(rows[0]).toEqual({
      manual_street: 'Савушкина 5', manual_schedule: 'пн, ср вечером', hobby: 'хор', profession: 'врач', family_status: 'замужем, двое детей',
    });
    // Подбор и карточка читают те же поля, что правка «Править данные».
    const request = (await new RequestsRepo(db).forDashboard()).find((r) => r.id === out.id);
    expect(request).toMatchObject({ manual_street: 'Савушкина 5', manual_schedule: 'пн, ср вечером', hobby: 'хор', profession: 'врач', family: 'замужем, двое детей' });
  });

  test('неверная форма не создаёт заявку и никого не уведомляет', async () => {
    const out = await creator({ notify: async (r) => { notified.push(r); } }).request({ fields: { fio: 'Анна' } }, 'a');
    expect(out.ok).toBe(false);
    expect(notified).toHaveLength(0);
  });
});
