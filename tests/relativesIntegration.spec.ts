import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService } from '../src/home-groups/composition.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/** Родственники (миграция 071) через настоящую базу: связь, представление «Людей», журнал, слияние карточки. */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const card = async (fio: string, phone: string | null = null, address: string | null = null) =>
  (await db.query<{ id: number }>(
    `INSERT INTO persons (full_name, phone, address, created_by) VALUES ($1, $2, $3, 'тест') RETURNING id::int AS id`, [fio, phone, address],
  )).rows[0]!.id;
const compose = () => composeService(db, createFakeEngine().engine, { defaultCapacity: 10, ttlMs: 0 });
const personOf = async (svc: ReturnType<typeof compose>, key: string) => (await svc.views()).people.items.find((p) => p.key === key)!;

describe('родственники в «Людях»', () => {
  test('«ребёнок» с одной стороны — «родитель» с другой; повторная связь пары — отказ; связь убирается', async () => {
    const svc = compose();
    const parent = await card('Иванов Пётр');
    const child = await card('Иванова Мария');
    expect(await svc.relatives.add({ key: `p${parent}`, otherKey: `p${child}`, kind: 'child' }, 'тест')).toEqual({ ok: true });
    const p = await personOf(svc, `p${parent}`);
    const c = await personOf(svc, `p${child}`);
    expect(p.relatives).toEqual([{ id: expect.any(Number), key: `p${child}`, fio: 'Иванова Мария', kind: 'child' }]);
    expect(c.relatives).toEqual([{ id: p.relatives[0]!.id, key: `p${parent}`, fio: 'Иванов Пётр', kind: 'parent' }]);
    expect(await svc.relatives.add({ key: `p${child}`, otherKey: `p${parent}`, kind: 'sibling' }, 'тест')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await svc.relatives.remove({ id: p.relatives[0]!.id }, 'тест')).toEqual({ ok: true });
    expect((await personOf(svc, `p${parent}`)).relatives).toEqual([]);
    expect(await svc.relatives.remove({ id: p.relatives[0]!.id }, 'тест')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('с несуществующим человеком не связывает; в журнал — номер связи и название поля, без имён и ключей', async () => {
    const svc = compose();
    const a = await card('Секретов Пётр');
    const b = await card('Секретова Анна');
    expect(await svc.relatives.add({ key: `p${a}`, otherKey: 'p999', kind: 'spouse' }, 'тест')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await svc.relatives.add({ key: `p${a}`, otherKey: `p${b}`, kind: 'spouse' }, 'тест')).toEqual({ ok: true });
    const { rows } = await db.query<{ action: string; entity_type: string; after: string }>('SELECT action, entity_type, after::text AS after FROM audit_log');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'person.relative.add', entity_type: 'relative' });
    expect(rows[0]!.after).not.toMatch(/Секрет|p\d/);
  });

  test('подсказка: та же фамилия и тот же телефон; после «Связать» — пропадает', async () => {
    const svc = compose();
    const he = await card('Сорокин Иван', '+79110001122');
    const she = await card('Сорокина Анна', '8 911 000-11-22');
    await card('Сорокин Олег', '+79990000000');
    expect((await personOf(svc, `p${he}`)).relativeHints).toEqual([{ key: `p${she}`, fio: 'Сорокина Анна', samePhone: '+7 911 000-11-22', sameAddress: null }]);
    await svc.relatives.add({ key: `p${he}`, otherKey: `p${she}`, kind: 'spouse' }, 'тест');
    expect((await personOf(svc, `p${he}`)).relativeHints).toEqual([]);
  });

  test('карточка слилась с регистрацией — связи переезжают на регистрацию, вариант семейного положения тоже', async () => {
    const wife = await card('Петрова Анна');
    const husband = await card('Петров Олег Иванович', '+79110005566');
    await db.query(`UPDATE persons SET family_status = 'есть дети', family_kind = 'married' WHERE id = $1`, [husband]);
    const svc = compose();
    await svc.relatives.add({ key: `p${husband}`, otherKey: `p${wife}`, kind: 'spouse' }, 'тест');
    const user = await seedUser(db, { id: '7', fio: 'Петров Олег', phone: '+79110005566' });
    const { rows } = await db.query('SELECT a_key, b_key FROM person_relatives');
    expect(rows).toEqual([{ a_key: `u${user}`, b_key: `p${wife}` }]);
    expect((await db.query('SELECT family_kind FROM users WHERE id = $1', [user])).rows[0]).toEqual({ family_kind: 'married' });
    expect((await personOf(svc, `p${wife}`)).relatives).toMatchObject([{ key: `u${user}`, kind: 'spouse' }]);
  });

  test('после слияния не бывает двух связей одной пары и связи человека с самим собой', async () => {
    const mother = await card('Кузнецова Ольга');
    const son = await card('Кузнецов Илья', '+79110009900');
    const svc = compose();
    // Регистрация того же человека заведена раньше карточки и уже связана с матерью; карточка — тоже.
    await db.query(`INSERT INTO person_relatives (a_key, b_key, kind, set_by) VALUES ('p' || $1::text, 'p' || $2::text, 'parent', 'тест')`, [son, mother]);
    const user = await seedUser(db, { id: '9', fio: 'Кузнецов Илья', phone: '+79110009911' });
    await svc.relatives.add({ key: `u${user}`, otherKey: `p${mother}`, kind: 'parent' }, 'тест');
    await svc.relatives.add({ key: `u${user}`, otherKey: `p${son}`, kind: 'other' }, 'тест');
    await db.query('UPDATE users SET phone = $2 WHERE id = $1', [user, '+79110009900']);
    const { rows } = await db.query('SELECT a_key, b_key, kind FROM person_relatives');
    expect(rows).toEqual([{ a_key: `u${user}`, b_key: `p${mother}`, kind: 'parent' }]);
  });

  test('семейное положение и родственники доходят до «Людей» и заявки', async () => {
    const svc = compose();
    const id = await card('Орлов Пётр');
    await db.query(`UPDATE persons SET family_status = 'Женат, двое детей' WHERE id = $1`, [id]);
    await db.query(`INSERT INTO requests (type, status, fio, person_id, origin) VALUES ('join_group', 'Новая', 'Орлов Пётр', $1, 'ui')`, [id]);
    expect(await personOf(svc, `p${id}`)).toMatchObject({ familyKind: 'married', family: 'Женат, двое детей' });
    const r = (await svc.views()).requests.items.find((x) => x.personKey === `p${id}`)!;
    expect(r).toMatchObject({ familyKind: 'married', family: 'Женат, двое детей' });
    // Карточке заявки — родственники её человека (экран заявок «Людей» не читает).
    const wife = await card('Орлова Анна');
    await svc.relatives.add({ key: `p${id}`, otherKey: `p${wife}`, kind: 'spouse' }, 'тест');
    const again = (await svc.views()).requests.items.find((x) => x.personKey === `p${id}`)!;
    expect(again.relatives).toEqual([{ id: expect.any(Number), key: `p${wife}`, fio: 'Орлова Анна', kind: 'spouse' }]);
  });

  test('удаление регистрации убирает и её связи', async () => {
    const svc = compose();
    const user = await seedUser(db, { id: '8', fio: 'Смирнов Илья', phone: '+79110007788' });
    const sister = await card('Смирнова Ольга');
    await svc.relatives.add({ key: `u${user}`, otherKey: `p${sister}`, kind: 'sibling' }, 'тест');
    const { UsersRepo } = await import('../src/db/repos/users.repo.js');
    await new UsersRepo(db).delete(user);
    expect((await db.query('SELECT 1 FROM person_relatives')).rowCount).toBe(0);
  });
});
