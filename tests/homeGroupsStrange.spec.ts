import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { StrangeRepo } from '../src/db/repos/strange.repo.js';
import { createStrange } from '../src/home-groups/strange.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let svc: ReturnType<typeof createStrange>;
beforeAll(async () => { db = await setupTestDb(); svc = createStrange({ repo: new StrangeRepo(db) }); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

/** Человек заявки в «Людях»: у заявки без регистрации — её карточка (миграция 057). */
const keyOfRequest = async (id: number): Promise<string> =>
  (await db.query<{ key: string }>(`SELECT CASE WHEN user_id IS NOT NULL THEN 'u' || user_id ELSE 'p' || person_id END AS key FROM requests WHERE id = $1`, [id])).rows[0]!.key;

const marks = async () => (await db.query('SELECT person_key, note, set_by FROM strange_marks ORDER BY person_key')).rows;
async function request(userId: number | null = null): Promise<number> {
  return (await db.query<{ id: number }>(`INSERT INTO requests (type, user_id, fio, status, origin) VALUES ('join_group', $1, 'Человек', 'Новая', 'ui') RETURNING id`, [userId])).rows[0]!.id;
}

describe('метка «Странный человек»: разбор запросов', () => {
  test('со страницы заявки: метка ложится на человека заявки, автор и заметка записываются', async () => {
    const r = await request();
    expect(await svc.forRequest(r, { value: true, note: ' непонятная речь ' }, 'anna')).toEqual({ ok: true });
    expect(await marks()).toEqual([{ person_key: await keyOfRequest(r), note: 'непонятная речь', set_by: 'anna' }]);
    expect(await svc.forRequest(r, { value: false }, 'boris')).toEqual({ ok: true });
    expect(await marks()).toEqual([]);
  });

  test('из справочника людей по ключу: регистрация, заявка без регистрации и карточка', async () => {
    const u = await seedUser(db, { id: '1' });
    const r = await request();
    const p = (await db.query<{ id: number }>(`INSERT INTO persons (full_name) VALUES ('Карточка') RETURNING id`)).rows[0]!.id;
    for (const key of [`u${u}`, `r${r}`, `p${p}`]) expect(await svc.forPerson({ key, value: true }, 'anna'), key).toEqual({ ok: true });
    // Старый ключ «r» заявки ведёт к её человеку — карточке (миграция 057).
    expect((await marks()).map((m) => m.person_key).sort()).toEqual([`p${p}`, await keyOfRequest(r), `u${u}`].sort());
  });

  test.each([
    [{}], [null], [[]], [{ value: 'да' }], [{ value: 1 }], [{ value: true, note: 5 }],
  ])('неверное тело заявки %j отклоняется', async (body) => {
    const r = await request();
    expect(await svc.forRequest(r, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await marks()).toEqual([]);
  });

  test.each([
    [{ value: true }], [{ key: 5, value: true }], [{ key: 'x12', value: true }], [{ key: 'u12' }], [{ key: 'u', value: true }], [null],
  ])('неверное тело для человека %j отклоняется', async (body) => {
    expect(await svc.forPerson(body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await marks()).toEqual([]);
  });

  test('человека нет — отказ not_found', async () => {
    expect(await svc.forPerson({ key: 'u99999', value: true }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await svc.forRequest(99999, { value: true }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });
});
