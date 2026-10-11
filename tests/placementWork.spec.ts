import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: PlacementRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new PlacementRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function request(over: { status?: string; origin?: string; callback?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, phone, age, place, origin, callback)
     VALUES ('join_group', $1, 'Мария Иванова', '+79110001122', '26-35', 'Приморский', $2, $3) RETURNING id`,
    [over.status ?? 'Новая', over.origin ?? 'ui', over.callback ?? false],
  );
  return rows[0]!.id;
}
const row = async (id: number) =>
  (await db.query('SELECT fio, phone, age, place, note, responsible, callback, origin FROM requests WHERE id = $1', [id])).rows[0];
const audits = async () => (await db.query('SELECT * FROM audit_log ORDER BY id')).rows;

describe('правка заявки координатором', () => {
  test('меняются только присланные поля, остальные остаются', async () => {
    const r = await request();
    expect(await repo.editRequest(r, { phone: '+7 921 555-00-11', age: '36-45' }, 'a')).toEqual({ ok: true });
    expect(await row(r)).toMatchObject({ fio: 'Мария Иванова', phone: '+79215550011', age: '36-45', place: 'Приморский' });
  });

  test('пустое значение очищает поле, кроме ФИО', async () => {
    const r = await request();
    expect(await repo.editRequest(r, { place: '  ', note: null }, 'a')).toEqual({ ok: true });
    expect((await row(r)).place).toBeNull();
    expect(await repo.editRequest(r, { fio: ' ' }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await row(r)).fio).toBe('Мария Иванова');
  });

  test('неверный телефон отклоняется', async () => {
    const r = await request();
    expect(await repo.editRequest(r, { phone: 'позвонить маме' }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('слишком длинный текст отклоняется', async () => {
    const r = await request();
    expect(await repo.editRequest(r, { note: 'я'.repeat(1001) }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('в журнал идут только названия изменённых полей, а не значения', async () => {
    const r = await request();
    await repo.editRequest(r, { phone: '+7 921 555-00-11', age: '36-45' }, 'a');
    const [entry] = await audits();
    expect(entry).toMatchObject({ action: 'request.edit', actor: 'a' });
    expect(entry.after).toEqual({ fields: ['phone', 'age'] });
    expect(JSON.stringify(entry)).not.toMatch(/921|36-45/);
  });

  test('если ничего не изменилось, журнал не пишется', async () => {
    const r = await request();
    await repo.editRequest(r, { age: '26-35' }, 'a');
    expect(await audits()).toHaveLength(0);
  });

  test('заявка из таблицы после правки считается заведённой в интерфейсе', async () => {
    const r = await request({ origin: 'таблица' });
    await repo.editRequest(r, { note: 'просила вечером' }, 'a');
    expect((await row(r)).origin).toBe('ui');
  });

  test('закрытую заявку править нельзя', async () => {
    const r = await request({ status: 'Исполнена' });
    expect(await repo.editRequest(r, { note: 'x' }, 'a')).toMatchObject({ ok: false, error: 'already_closed' });
  });

  test('несуществующая заявка — not_found', async () => {
    expect(await repo.editRequest(99999, { note: 'x' }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('«в работе у»', () => {
  test('ответственный назначается и снимается, имя попадает в журнал', async () => {
    const r = await request();
    expect(await repo.assign(r, 'Анна Смирнова', 'a')).toEqual({ ok: true });
    expect((await row(r)).responsible).toBe('Анна Смирнова');
    expect(await repo.assign(r, null, 'a')).toEqual({ ok: true });
    expect((await row(r)).responsible).toBeNull();
    const log = await audits();
    expect(log.map((x) => x.action)).toEqual(['request.assign', 'request.assign']);
    expect(log[0].after).toEqual({ responsible: 'Анна Смирнова' });
    expect(log[1].after).toEqual({ responsible: null });
  });

  test('то же значение повторно не пишется в журнал', async () => {
    const r = await request();
    await repo.assign(r, 'Анна Смирнова', 'a');
    await repo.assign(r, 'Анна Смирнова', 'a');
    expect(await audits()).toHaveLength(1);
  });

  test('слишком длинное имя отклоняется', async () => {
    const r = await request();
    expect(await repo.assign(r, 'я'.repeat(201), 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('итог звонка', () => {
  test.each([
    ['reached', false, true], ['refused', false, true], ['no_answer', true, false], ['later', true, false],
  ] as const)('«%s» ставит отметку «нужен звонок» = %s', async (result, callback) => {
    const r = await request({ callback: result === 'reached' || result === 'refused' });
    expect(await repo.recordCall(r, result, null, 'a')).toEqual({ ok: true });
    expect((await row(r)).callback).toBe(callback);
  });

  test('итог пишется в журнал с комментарием, каждый звонок отдельной записью', async () => {
    const r = await request();
    await repo.recordCall(r, 'no_answer', null, 'a');
    await repo.recordCall(r, 'reached', 'договорились на субботу', 'b');
    const log = await audits();
    expect(log.map((x) => [x.action, x.actor, x.after.result, x.note])).toEqual([
      ['request.call', 'a', 'no_answer', null],
      ['request.call', 'b', 'reached', 'договорились на субботу'],
    ]);
  });

  test('неизвестный итог и длинный комментарий отклоняются', async () => {
    const r = await request();
    expect(await repo.recordCall(r, 'потом' as never, null, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await repo.recordCall(r, 'reached', 'я'.repeat(501), 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await audits()).toHaveLength(0);
  });

  test('закрытой заявке итог звонка не пишется', async () => {
    const r = await request({ status: 'Исполнена' });
    expect(await repo.recordCall(r, 'reached', null, 'a')).toMatchObject({ ok: false, error: 'already_closed' });
  });
});
