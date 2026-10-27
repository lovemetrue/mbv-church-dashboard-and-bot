import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { CoordinatorsRepo, CoordinatorTakenError } from '../src/db/repos/coordinators.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: CoordinatorsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new CoordinatorsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const ROLE = [{ name: 'Координатор' }];
const person = async (fio: string, phone: string | null = null) =>
  (await db.query<{ id: number }>('INSERT INTO persons (full_name, phone) VALUES ($1, $2) RETURNING id::int AS id', [fio, phone])).rows[0]!.id;
const personsNamed = async (fio: string) =>
  (await db.query('SELECT id FROM persons WHERE full_name = $1 AND archived_at IS NULL', [fio])).rowCount;

describe('участник команды — человек из «Людей»', () => {
  test('заведённый по имени находит единственную регистрацию с тем же ФИО (регистр и «ё» не важны)', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Семёнова Анна', phone: '+79110001122' });
    const c = await repo.create({ name: 'семенова  анна', roles: ROLE }, 'таблица');
    expect(c).toMatchObject({ person_key: `u${u}`, phone: '+79110001122' });
  });

  test('и единственную карточку; телефон берётся из неё', async () => {
    const p = await person('Пётр Громов', '+79210000000');
    expect(await repo.create({ name: 'Пётр Громов', roles: ROLE })).toMatchObject({ person_key: `p${p}`, phone: '+79210000000' });
  });

  test('никого нет или тёзки — заводится своя карточка: угадывать между тёзками нельзя', async () => {
    const alone = await repo.create({ name: 'Анна Л.', roles: ROLE });
    expect(alone.person_key).toMatch(/^p\d+$/);
    expect(await personsNamed('Анна Л.')).toBe(1);
    await person('Иван Орлов');
    await seedUser(db, { id: '2', fio: 'Иван Орлов' });
    const twin = await repo.create({ name: 'Иван Орлов', roles: ROLE });
    expect(await personsNamed('Иван Орлов')).toBe(2);
    expect(twin.person_key).toMatch(/^p\d+$/);
  });

  test('выбранный человек ставится как есть; второй строки в команде на него нет', async () => {
    const p = await person('Вера Назарова');
    const c = await repo.create({ name: 'Вера Назарова', roles: ROLE, person: { personId: p } });
    expect(c.person_key).toBe(`p${p}`);
    await expect(repo.create({ name: 'Вера Назарова', roles: ROLE, person: { personId: p } })).rejects.toBeInstanceOf(CoordinatorTakenError);
  });

  test('смена человека в правке меняет связь и имя, а имя переписывается в заявках и группах', async () => {
    const c = await repo.create({ name: 'Анна Л.', roles: ROLE });
    await db.query(`INSERT INTO requests (type, fio, status, origin, responsible) VALUES ('join_group', 'Кто-то', 'Новая', 'ui', 'Анна Л.')`);
    const p = await person('Анна Лебедева');
    const updated = await repo.rename(c.id, { name: 'Анна Лебедева', roles: ROLE, person: { personId: p } });
    expect(updated).toMatchObject({ name: 'Анна Лебедева', person_key: `p${p}` });
    expect((await db.query('SELECT responsible FROM requests')).rows).toEqual([{ responsible: 'Анна Лебедева' }]);
  });

  test('правка ФИО в «Людях» переписывает имя участника команды, «в работе у» заявок и координатора групп', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Анна Лебедева' });
    const c = await repo.create({ name: 'Анна Лебедева', roles: ROLE, person: { userId: u } });
    await db.query(`INSERT INTO requests (type, fio, status, origin, responsible) VALUES ('join_group', 'Кто-то', 'Новая', 'ui', 'Анна Лебедева')`);
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, source, coordinator) VALUES ('В', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui', 'Анна Лебедева')`);
    await db.query(`UPDATE users SET full_name = 'Анна Лебедева-Орлова' WHERE id = $1`, [u]);
    expect((await repo.findActive(c.id))!.name).toBe('Анна Лебедева-Орлова');
    expect((await db.query('SELECT responsible FROM requests')).rows[0].responsible).toBe('Анна Лебедева-Орлова');
    expect((await db.query('SELECT coordinator FROM groups')).rows[0].coordinator).toBe('Анна Лебедева-Орлова');
  });

  test('то же для карточки', async () => {
    const p = await person('Пётр Г.');
    const c = await repo.create({ name: 'Пётр Г.', roles: ROLE, person: { personId: p } });
    await db.query(`UPDATE persons SET full_name = 'Пётр Громов' WHERE id = $1`, [p]);
    expect((await repo.findActive(c.id))!.name).toBe('Пётр Громов');
  });
});

describe('привязка уже заведённых (миграция 056)', () => {
  test('каждый получает своего человека: единственное совпадение — его, тёзку уже взятого — новая карточка; повтор ничего не меняет', async () => {
    const u = await seedUser(db, { id: '1', fio: 'Давид Родионов' });
    const a = await repo.create({ name: 'Давид Родионов', roles: ROLE });
    const b = await repo.create({ name: 'Родионов Давид', roles: ROLE });
    const lone = await repo.create({ name: 'Галя', roles: ROLE });
    // Как до миграции: связей нет.
    await db.query('UPDATE coordinators SET user_id = NULL, person_id = NULL');
    await db.query(`DELETE FROM persons WHERE created_by = 'команда'`);
    expect((await db.query('SELECT link_unlinked_coordinators() AS n')).rows[0].n).toBe(3);
    expect((await repo.findActive(a.id))!.person_key).toBe(`u${u}`);
    expect((await repo.findActive(b.id))!.person_key).toMatch(/^p\d+$/);
    expect((await repo.findActive(lone.id))!.person_key).toMatch(/^p\d+$/);
    expect((await db.query('SELECT link_unlinked_coordinators() AS n')).rows[0].n).toBe(0);
  });
});
