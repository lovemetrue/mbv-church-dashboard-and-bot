import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: RequestsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new RequestsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const groups = async () => (await db.query(
  `SELECT leader, phone, district, status, source, comment, leader_user_id::int AS leader_user_id, source_request_id::int AS source_request_id FROM groups ORDER BY id`,
)).rows;
async function lead(n: number, opts: { place?: string; phone?: string; fio?: string; mdg?: 'open' | 'home' } = {}) {
  const userId = await seedUser(db, { id: String(100 + n), fio: opts.fio ?? 'Хозяйка Дома', phone: opts.phone ?? `+7900111000${n}`, mdgStatus: opts.mdg ?? 'open' });
  if (opts.place) await db.query('UPDATE users SET location = $2 WHERE id = $1', [userId, opts.place]);
  const r = await repo.create(userId, 'lead_group');
  return { userId, requestId: r.id };
}

describe('потенциальные группы из заявок «хочу открыть»', () => {
  test('новая заявка сразу заводит группу со статусом «Потенциальная»: ведущий, телефон, ссылка на регистрацию и заявку', async () => {
    const { userId, requestId } = await lead(1, { place: 'метро Беговая, Приморский район' });
    expect(await groups()).toEqual([{
      leader: 'Хозяйка Дома', phone: '+79001110001', district: 'Приморский', status: 'Потенциальная', source: 'бот',
      comment: 'Из заявки «хочу открыть группу». Место: метро Беговая, Приморский район.', leader_user_id: userId, source_request_id: requestId,
    }]);
  });

  test('«дам дом» — тоже потенциальная группа, с соответствующей пометкой', async () => {
    await lead(1, { mdg: 'home' });
    expect((await groups())[0]!.comment).toContain('дам дом');
  });

  test('район не определился — «Не указан», координатор поправит', async () => {
    await lead(1, { place: 'где-то у метро' });
    expect((await groups())[0]!.district).toBe('Не указан');
  });

  test('повторный вызов по той же заявке ничего не дублирует, и тот же человек второй раз группы не получает', async () => {
    const { userId, requestId } = await lead(1);
    await db.query('SELECT ensure_potential_group($1)', [requestId]);
    expect(await groups()).toHaveLength(1);
    await repo.create(userId, 'lead_group');
    expect(await groups()).toHaveLength(1);
  });

  test('человек, который уже ведёт группу (по ссылке или по телефону ведущего), потенциальной группы не получает', async () => {
    await db.query(`INSERT INTO groups (leader, phones, district, format, status, source) VALUES ('Давний Ведущий', ARRAY['+79001110001'], 'Невский', 'Основная церковь', 'Функционирует', 'таблица')`);
    await lead(1);
    expect(await groups()).toHaveLength(1);
    const linked = await seedUser(db, { id: '500', phone: '+79005550000' });
    await db.query(`INSERT INTO groups (leader, district, format, status, source, leader_user_id) VALUES ('Связанный', 'Невский', 'Основная церковь', 'Функционирует', 'ui', $1)`, [linked]);
    await repo.create(linked, 'lead_group');
    expect(await groups()).toHaveLength(2);
  });

  test('другие виды заявок и закрытые заявки групп не заводят', async () => {
    const u = await seedUser(db, { id: '700' });
    await repo.create(u, 'join_group');
    await repo.create(u, 'question');
    const closed = await seedUser(db, { id: '701' });
    const r = await repo.create(closed, 'lead_group');
    await db.query('DELETE FROM groups');
    await db.query(`UPDATE requests SET status = 'Исполнена' WHERE id = $1`, [r.id]);
    await db.query('SELECT ensure_potential_group($1)', [r.id]);
    expect(await groups()).toEqual([]);
  });

  test('заявка из формы дашборда («Создать → Заявка») тоже заводит группу, у неё источник ui', async () => {
    const id = await repo.createFromDashboard({ fio: 'Из формы', type: 'lead_group', status: 'Новая', phone: '+79216660000', place: 'Выборгский' });
    expect(await groups()).toMatchObject([{ leader: 'Из формы', district: 'Выборгский', status: 'Потенциальная', source: 'ui', leader_user_id: null, source_request_id: id }]);
  });

  test('потенциальная группа в подбор не попадает: её статус не из принимающих', async () => {
    const { PASSING_STATUSES } = await import('../src/core/matching.js');
    expect(PASSING_STATUSES.has('Потенциальная')).toBe(false);
  });

  test('миграция: уже накопившиеся открытые заявки получили группы, закрытые — нет', async () => {
    await db.query('DELETE FROM groups');
    const a = await seedUser(db, { id: '800', fio: 'Старая Открытая' });
    const b = await seedUser(db, { id: '801', fio: 'Старая Закрытая' });
    await db.query(`INSERT INTO requests (type, user_id, status, origin) VALUES ('lead_group', $1, 'Новая', 'бот'), ('lead_group', $2, 'Исполнена', 'бот')`, [a, b]);
    await db.query(`SELECT ensure_potential_group(id) FROM requests WHERE type = 'lead_group' AND archived_at IS NULL ORDER BY id`);
    expect((await groups()).map((g) => g.leader)).toEqual(['Старая Открытая']);
  });

  test('ответы про время и адрес, пришедшие после заведения группы (досылка), попадают в «Адрес» и комментарий группы', async () => {
    const { userId } = await lead(1, { place: 'Приморский район' });
    await new UsersRepo(db).savePatch(userId, { schedule: 'будни после 18:00' });
    await new UsersRepo(db).savePatch(userId, { address: 'ул. Рылеева, 32' });
    const g = (await db.query(`SELECT address, comment FROM groups`)).rows[0]!;
    expect(g.address).toBe('ул. Рылеева, 32');
    expect(g.comment).toBe('Из заявки «хочу открыть группу». Место: Приморский район. Удобное время: будни после 18:00.');
  });

  test('адрес, названный до регистрации, ложится в группу при создании заявки; повторный ответ время не дублирует', async () => {
    const userId = await seedUser(db, { id: '110', fio: 'С Адресом', phone: '+79001110011', mdgStatus: 'open' });
    await db.query(`UPDATE users SET address_raw = 'пр. Мира, 5', schedule_raw = 'вечером' WHERE id = $1`, [userId]);
    await repo.create(userId, 'lead_group');
    await new UsersRepo(db).savePatch(userId, { schedule: 'вечером' });
    const g = (await db.query(`SELECT address, comment FROM groups`)).rows[0]!;
    expect(g.address).toBe('пр. Мира, 5');
    expect(g.comment.match(/Удобное время/g)).toHaveLength(1);
  });

  test('правка координатора важнее анкеты: непустой адрес группы не затирается', async () => {
    const { userId } = await lead(1);
    await db.query(`UPDATE groups SET address = 'Поправлено вручную, 1'`);
    await new UsersRepo(db).savePatch(userId, { address: 'ул. Из анкеты, 2' });
    expect((await db.query(`SELECT address FROM groups`)).rows[0]!.address).toBe('Поправлено вручную, 1');
  });

  test('миграция 035: уже накопившиеся ответы переносятся в группы, повторный запуск ничего не меняет', async () => {
    const { userId } = await lead(1, { place: 'Выборгский' });
    await db.query(`UPDATE users SET address_raw = 'пр. Энгельса, 10', schedule_raw = 'по субботам' WHERE id = $1`, [userId]);
    const sql = readFileSync(new URL('../migrations/035_sync_potential_group_answers.sql', import.meta.url), 'utf8');
    await db.query(sql);
    const first = (await db.query(`SELECT address, comment FROM groups`)).rows[0]!;
    expect(first.address).toBe('пр. Энгельса, 10');
    expect(first.comment).toContain('Удобное время: по субботам.');
    await db.query(sql);
    expect((await db.query(`SELECT address, comment FROM groups`)).rows[0]).toEqual(first);
  });
});
