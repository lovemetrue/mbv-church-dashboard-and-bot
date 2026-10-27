import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

/** Заявка как до миграции 057: без человека (триггер на время вставки снимаем, чтобы проверить сам перенос). */
async function oldRequest(fields: Record<string, unknown>): Promise<number> {
  await db.query('ALTER TABLE requests DISABLE TRIGGER requests_link_person');
  try {
    const cols = Object.keys(fields);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, origin, ${cols.join(', ')}) VALUES ('join_group', 'Новая', 'таблица', ${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id::int AS id`,
      Object.values(fields),
    );
    return rows[0]!.id;
  } finally {
    await db.query('ALTER TABLE requests ENABLE TRIGGER requests_link_person');
  }
}
const req = async (id: number) => (await db.query('SELECT user_id::int AS user_id, person_id::int AS person_id FROM requests WHERE id = $1', [id])).rows[0];
const person = async (id: number) => (await db.query('SELECT * FROM persons WHERE id = $1', [id])).rows[0];
const migrate = async () => (await db.query('SELECT link_unlinked_requests() AS n')).rows[0].n as number;

describe('заявка → человек (миграция 057)', () => {
  test('заявка без регистрации получает карточку со своими данными; правка координатора (улица, время) — тоже в карточку', async () => {
    const id = await oldRequest({ fio: 'Мария Соколова', phone: '+7 911 124-24-18', age: '18–25', place: 'Беговая', hobby: 'бег', manual_street: 'Савушкина 10', manual_schedule: 'вт вечер' });
    expect(await migrate()).toBe(1);
    const { person_id } = await req(id);
    expect(await person(person_id)).toMatchObject({ full_name: 'Мария Соколова', phone: '+7 911 124-24-18', age: '18–25', place: 'Беговая', hobby: 'бег', address: 'Савушкина 10', schedule: 'вт вечер' });
  });

  test('склейка по телефону: регистрация с тем же номером — заявка к ней, пустые поля регистрации дополняются', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Мария Соколова', phone: '79111242418' });
    const id = await oldRequest({ fio: 'Соколова М.', phone: '8 (911) 124-24-18', hobby: 'бег' });
    await migrate();
    expect(await req(id)).toEqual({ user_id: u, person_id: null });
    const user = (await db.query('SELECT full_name, hobby FROM users WHERE id = $1', [u])).rows[0];
    // ФИО регистрации не перетирается написанием из таблицы — пустое дополняется.
    expect(user).toEqual({ full_name: 'Мария Соколова', hobby: 'бег' });
  });

  test('две заявки одного человека (один номер) — одна карточка; без телефона — у каждой своя', async () => {
    const a = await oldRequest({ fio: 'Пётр', phone: '+79210000001' });
    const b = await oldRequest({ fio: 'Пётр Громов', phones: ['+7 921 000-00-01'] });
    const c = await oldRequest({ fio: 'Без номера' });
    const d = await oldRequest({ fio: 'Без номера' });
    await migrate();
    expect((await req(a)).person_id).toBe((await req(b)).person_id);
    expect((await req(c)).person_id).not.toBe((await req(d)).person_id);
  });

  test('номер совпал у двоих (регистрация и карточка) — не угадываем, своя карточка', async () => {
    await seedUser(db, { id: '1', fio: 'А', phone: '79210000002' });
    await db.query(`INSERT INTO persons (full_name, phone) VALUES ('Б', '+79210000002')`);
    const id = await oldRequest({ fio: 'В', phone: '+79210000002' });
    await migrate();
    expect(await person((await req(id)).person_id)).toMatchObject({ full_name: 'В' });
  });

  test('метка «Странный человек», пол и состав группы с ключом заявки переходят на человека', async () => {
    const id = await oldRequest({ fio: 'Пётр', phone: '+79210000003' });
    const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Ведущий', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui') RETURNING id::int AS id`)).rows[0]!.id;
    await db.query(`INSERT INTO strange_marks (person_key, set_by) VALUES ($1, 'a')`, [`r${id}`]);
    await db.query(`INSERT INTO person_genders (person_key, gender, set_by) VALUES ($1, 'м', 'a')`, [`r${id}`]);
    await db.query(`INSERT INTO group_members (group_id, request_id) VALUES ($1, $2)`, [g, id]);
    await migrate();
    const key = `p${(await req(id)).person_id}`;
    expect((await db.query('SELECT person_key FROM strange_marks')).rows).toEqual([{ person_key: key }]);
    expect((await db.query('SELECT person_key FROM person_genders')).rows).toEqual([{ person_key: key }]);
    expect((await db.query('SELECT request_id, person_id::int AS person_id FROM group_members')).rows).toEqual([{ request_id: null, person_id: (await req(id)).person_id }]);
  });

  test('заявка с регистрацией: правка координатора (улица, время) уходит в регистрацию', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Анна' });
    await db.query(`INSERT INTO requests (type, status, origin, user_id, manual_street, manual_schedule) VALUES ('join_group', 'Новая', 'бот', $1, 'Наличная 5', 'сб утро')`, [u]);
    await migrate();
    expect((await db.query('SELECT address_raw, schedule_raw FROM users WHERE id = $1', [u])).rows[0]).toEqual({ address_raw: 'Наличная 5', schedule_raw: 'сб утро' });
  });

  test('удалённая заявка карточку не заводит: в «Людях» её человека не было', async () => {
    const id = await oldRequest({ fio: 'Удалённый', archived_at: new Date() });
    await migrate();
    expect(await req(id)).toEqual({ user_id: null, person_id: null });
    expect((await db.query('SELECT count(*)::int AS n FROM persons')).rows[0].n).toBe(0);
  });

  test('повторный запуск ничего не меняет', async () => {
    await oldRequest({ fio: 'Пётр', phone: '+79210000004' });
    await migrate();
    expect(await migrate()).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM persons')).rows[0].n).toBe(1);
  });

  test('новая заявка (перенос таблицы, форма) сразу получает человека — триггер', async () => {
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone) VALUES ('Пётр', '+79210000005') RETURNING id::int AS id`)).rows[0]!.id;
    const { rows } = await db.query<{ id: number }>(`INSERT INTO requests (type, status, origin, fio, phone) VALUES ('join_group', 'Новая', 'таблица', 'Пётр Г.', '89210000005') RETURNING id::int AS id`);
    expect(await req(rows[0]!.id)).toEqual({ user_id: null, person_id: p });
  });
});

describe('ведущие групп из таблицы церкви (миграция 057)', () => {
  const group = async (leader: string, phone: string | null, extra: Record<string, unknown> = {}) => {
    const cols = ['leader', 'phone', ...Object.keys(extra)];
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO groups (district, direction_id, status, source, ${cols.join(', ')}) VALUES ('Приморский', group_direction_id('очно'), 'Функционирует', 'таблица', ${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id::int AS id`,
      [leader, phone, ...Object.values(extra)],
    );
    return rows[0]!.id;
  };
  const links = async (id: number) => (await db.query('SELECT leader_user_id::int AS lu, leader_person_id::int AS lp, co_leader_user_id::int AS cu, co_leader_person_id::int AS cp FROM groups WHERE id = $1', [id])).rows[0];
  const run = async () => (await db.query('SELECT link_unlinked_group_leaders() AS n')).rows[0].n as number;

  test('ведущий по телефону находит регистрацию; без совпадения — карточка с его именем и телефоном', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Ольга К.', phone: '79112003145' });
    const a = await group('Ольга К.', '+7 911 200-31-45');
    const b = await group('Марина Л.', '79052006612', { co_leader: 'Игорь', co_leader_phone: '79050000000' });
    await run();
    expect(await links(a)).toMatchObject({ lu: u, lp: null });
    const lb = await links(b);
    expect(await person(lb.lp)).toMatchObject({ full_name: 'Марина Л.', phone: '79052006612' });
    expect(await person(lb.cp)).toMatchObject({ full_name: 'Игорь', phone: '79050000000' });
  });

  test('пара в одной строке («Елена и Сергей Н.») не связывается: её разбирают в правке группы', async () => {
    const g = await group('Елена и Сергей Н.', '79212007704');
    await run();
    expect(await links(g)).toEqual({ lu: null, lp: null, cu: null, cp: null });
  });

  test('уже связанных не трогает; повтор ничего не меняет', async () => {
    await group('Пётр', '79210000009');
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
  });
});

describe('очистка базы служителем после склейки', () => {
  test('заявка из таблицы, склеенная с регистрацией, переживает удаление регистраций — человек переезжает в карточку', async () => {
    const { MaintenanceRepo } = await import('../src/db/repos/maintenance.repo.js');
    await seedUser(db, { id: '1', fio: 'Мария Соколова', phone: '79111242418' });
    const id = await oldRequest({ fio: 'Соколова М.', phone: '+79111242418' });
    await migrate();
    await new MaintenanceRepo(db).resetAll();
    const r = await req(id);
    expect(r.user_id).toBeNull();
    expect(await person(r.person_id)).toMatchObject({ full_name: 'Мария Соколова', phone: '79111242418', created_by: 'заявка' });
  });
});

describe('удаление заявки и её человек', () => {
  test('удалённая заявка карточку человека не убирает: он прихожанин, его данные нужны и без кампании и группы', async () => {
    const id = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, origin, fio, phone) VALUES ('join_group', 'Новая', 'ui', 'Пётр', '+79210000010') RETURNING id::int AS id`)).rows[0]!.id;
    await db.query('UPDATE requests SET archived_at = now() WHERE id = $1', [id]);
    expect((await db.query('SELECT p.archived_at FROM requests r JOIN persons p ON p.id = r.person_id WHERE r.id = $1', [id])).rows[0].archived_at).toBeNull();
    // Подал заявку снова — она цепляется к тому же человеку, дубля нет.
    const again = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, origin, fio, phone) VALUES ('join_group', 'Новая', 'ui', 'Пётр Громов', '8 921 000-00-10') RETURNING id::int AS id`)).rows[0]!.id;
    expect((await req(again)).person_id).toBe((await req(id)).person_id);
    expect((await db.query('SELECT count(*)::int AS n FROM persons')).rows[0].n).toBe(1);
  });
});

describe('человек из «Людей» регистрируется в боте или на стойке', () => {
  test('карточка с тем же телефоном сливается с регистрацией: заявки, состав, ведущий, команда, метка и пол — к регистрации', async () => {
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone, hobby, place) VALUES ('Пётр Громов', '+79210000020', 'рыбалка', 'Купчино') RETURNING id::int AS id`)).rows[0]!.id;
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, origin, fio, phone) VALUES ('join_group', 'Новая', 'таблица', 'Пётр', '+79210000020') RETURNING id::int AS id`)).rows[0]!.id;
    expect((await req(r)).person_id).toBe(p);
    const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source, leader_person_id) VALUES ('Пётр Громов', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui', $1) RETURNING id::int AS id`, [p])).rows[0]!.id;
    await db.query(`INSERT INTO group_members (group_id, person_id) VALUES ($1, $2)`, [g, p]);
    await db.query(`INSERT INTO strange_marks (person_key, set_by) VALUES ($1, 'a')`, [`p${p}`]);
    await db.query(`INSERT INTO person_genders (person_key, gender, set_by) VALUES ($1, 'м', 'a')`, [`p${p}`]);

    const u = await seedUser(db, { id: '1', fio: 'Пётр Громов', phone: '89210000020' });

    expect(await req(r)).toEqual({ user_id: u, person_id: null });
    expect((await db.query('SELECT leader_user_id::int AS lu, leader_person_id AS lp FROM groups WHERE id = $1', [g])).rows[0]).toEqual({ lu: u, lp: null });
    expect((await db.query('SELECT user_id::int AS u, person_id FROM group_members WHERE archived_at IS NULL')).rows).toEqual([{ u, person_id: null }]);
    expect((await db.query('SELECT person_key FROM strange_marks')).rows).toEqual([{ person_key: `u${u}` }]);
    expect((await db.query('SELECT person_key FROM person_genders')).rows).toEqual([{ person_key: `u${u}` }]);
    expect((await db.query('SELECT hobby, location FROM users WHERE id = $1', [u])).rows[0]).toEqual({ hobby: 'рыбалка', location: 'Купчино' });
    // Карточка уходит: человек теперь один — регистрация.
    expect((await person(p)).archived_at).not.toBeNull();
  });

  test('тот же номер, а ФИО другие (жена с номером мужа) — не сливаем: его карточка, группа и заявки остаются его', async () => {
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone) VALUES ('Олейник Иаков Владиславич', '+79210000023') RETURNING id::int AS id`)).rows[0]!.id;
    const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source, leader_person_id) VALUES ('Олейник Иаков', 'Выборгский', group_direction_id('очно'), 'Функционирует', 'ui', $1) RETURNING id::int AS id`, [p])).rows[0]!.id;
    await seedUser(db, { id: '1', fio: 'Олейник Анастасия Михайловна', phone: '89210000023' });
    expect((await person(p)).archived_at).toBeNull();
    expect((await db.query('SELECT leader_user_id, leader_person_id::int AS lp FROM groups WHERE id = $1', [g])).rows[0]).toEqual({ leader_user_id: null, lp: p });
  });

  test('отчество, записанное только в одной из записей, слиянию не мешает', async () => {
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name, phone) VALUES ('Кондораки Светлана', '+79210000024') RETURNING id::int AS id`)).rows[0]!.id;
    await seedUser(db, { id: '1', fio: 'Кондораки Светлана Викторовна', phone: '89210000024' });
    expect((await person(p)).archived_at).not.toBeNull();
  });

  test('номер у двух карточек — не угадываем, не сливаем', async () => {
    await db.query(`INSERT INTO persons (full_name, phone) VALUES ('А', '+79210000021'), ('Б', '+79210000021')`);
    await seedUser(db, { id: '1', phone: '+79210000021' });
    expect((await db.query('SELECT count(*)::int AS n FROM persons WHERE archived_at IS NULL')).rows[0].n).toBe(2);
  });

  test('незавершённая анкета (без номера регистрации) не сливает', async () => {
    await db.query(`INSERT INTO persons (full_name, phone) VALUES ('А', '+79210000022')`);
    await seedUser(db, { id: '1', phone: '+79210000022', registered: false });
    expect((await db.query('SELECT count(*)::int AS n FROM persons WHERE archived_at IS NULL')).rows[0].n).toBe(1);
  });
});
