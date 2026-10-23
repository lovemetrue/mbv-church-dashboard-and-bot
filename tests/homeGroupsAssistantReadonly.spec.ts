import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { QueryError, createReadonlyRunner, validateSql } from '../src/home-groups/assistant/readonly.js';
import { buildPseudonyms, loadPseudonyms } from '../src/home-groups/assistant/pseudonyms.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function seed() {
  const g1 = (await db.query<{ id: number }>(`INSERT INTO groups (leader, phone, district, direction_id, status, people, coordinator, source)
    VALUES ('Иван Петров', '+79110001122', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 12, 'Анна Координатор', 'ui') RETURNING id`)).rows[0]!.id;
  await db.query(`INSERT INTO groups (leader, phone, district, direction_id, status, people, source)
    VALUES ('иван  петров', '8 911 000-11-22', 'Невский', group_direction_id('Основная церковь'), 'Функционирует', 4, 'ui')`);
  const u = (await db.query<{ id: number; registration_no: number }>(`INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, registration_no, registered_at, complete)
    VALUES ('telegram', 'u1', '', 'Мария Секретная', '+79215550011', nextval('registration_no_seq'), now(), true) RETURNING id, registration_no`)).rows[0]!;
  await db.query(`INSERT INTO requests (user_id, type, status, fio, phone, group_id, note, origin) VALUES ($1, 'join_group', 'Исполнена', 'Мария Секретная', '+79215550011', $2, 'звонить Сергею на 89990001122', 'ui')`, [u.id, g1]);
  return { g1, u };
}

describe('проверка запросов помощника', () => {
  test.each([
    ['SELECT 1', 'SELECT 1'], ['  select * from groups;  ', 'select * from groups'], ['WITH a AS (SELECT 1) SELECT * FROM a', 'WITH a AS (SELECT 1) SELECT * FROM a'],
  ])('«%s» разрешён', (raw, expected) => { expect(validateSql(raw)).toBe(expected); });

  test.each([
    '', '   ', 'DELETE FROM groups', 'UPDATE groups SET people = 0', 'DROP TABLE groups', 'INSERT INTO groups DEFAULT VALUES',
    'SELECT 1; DELETE FROM groups', 'SELECT 1 -- комментарий', 'SELECT /* x */ 1', 'COPY groups TO PROGRAM \'ls\'', 'SELECT 1; SELECT 2', 'я'.repeat(4001),
  ])('«%s» отклоняется', (raw) => { expect(() => validateSql(raw)).toThrow(QueryError); });
});

describe('выполнение запросов помощника на живой базе', () => {
  test('видны представления без имён: у людей номера, у телефонов маска, ключ телефона один у одного номера', async () => {
    const { u } = await seed();
    const run = createReadonlyRunner(db);
    const people = await run('SELECT person, phone_masked FROM people');
    expect(people.columns).toEqual(['person', 'phone_masked']);
    expect(people.rows).toEqual([[`Участник-${u.registration_no}`, '+7 *** ***-**-11']]);
    const groups = await run('SELECT leader, leader_phone_key FROM groups ORDER BY id');
    expect(groups.rows[0]![0]).toMatch(/^Ведущий-[0-9a-f]{6}$/);
    expect(groups.rows[0]).toEqual(groups.rows[1]);
    expect(JSON.stringify(groups)).not.toMatch(/Иван|Петров|911/);
  });

  test('у групп видна своя вместимость: capacity задана — число, не задана — пусто (общее значение берётся из инструкции)', async () => {
    const { g1 } = await seed();
    await db.query(`UPDATE groups SET capacity = 5 WHERE id = $1`, [g1]);
    const run = createReadonlyRunner(db);
    const groups = await run('SELECT id, capacity FROM groups ORDER BY id');
    expect(groups.rows.map((r) => r[1])).toEqual([5, null]);
  });

  test('имена, телефоны и заметки через представления не достаются: в них этих столбцов нет', async () => {
    await seed();
    const run = createReadonlyRunner(db);
    for (const sql of ['SELECT full_name FROM people', 'SELECT fio FROM requests', 'SELECT note FROM requests', 'SELECT phone FROM groups', 'SELECT comment FROM groups']) {
      await expect(run(sql), sql).rejects.toBeInstanceOf(QueryError);
    }
  });

  test('к таблицам и служебным данным доступа нет: users, requests, staff, audit_log, файлы сервера', async () => {
    await seed();
    const run = createReadonlyRunner(db);
    for (const sql of [
      'SELECT * FROM public.users', 'SELECT * FROM users', 'SELECT * FROM public.requests', 'SELECT * FROM staff', 'SELECT * FROM public.audit_log',
      "SELECT pg_read_file('/etc/passwd')", 'SELECT * FROM public.app_settings', 'SELECT * FROM pg_shadow',
    ]) {
      await expect(run(sql), sql).rejects.toBeInstanceOf(QueryError);
    }
  });

  test('записать или удалить нельзя ни запросом, ни подкопом: данные остаются на месте', async () => {
    await seed();
    const run = createReadonlyRunner(db);
    for (const sql of [
      'WITH d AS (DELETE FROM public.groups RETURNING 1) SELECT * FROM d',
      'WITH i AS (INSERT INTO public.groups (leader, district, format, status, source) VALUES (\'x\',\'x\',\'x\',\'x\',\'x\') RETURNING 1) SELECT * FROM i',
      'SELECT * INTO public.hack FROM groups',
    ]) {
      await expect(run(sql), sql).rejects.toBeInstanceOf(QueryError);
    }
    expect((await db.query('SELECT count(*)::int AS n FROM groups')).rows[0].n).toBe(2);
  });

  test('число строк ограничено, остальное помечено «обрезано»; слишком долгий запрос обрывается', async () => {
    await seed();
    const run = createReadonlyRunner(db, { maxRows: 3, timeoutMs: 300 });
    const r = await run('SELECT generate_series(1, 50) AS n');
    expect(r.rows).toHaveLength(3);
    expect(r.truncated).toBe(true);
    await expect(run('SELECT pg_sleep(5)')).rejects.toBeInstanceOf(QueryError);
  });

  test('значение с номером телефона или почтой, если вдруг попало в ответ, маскируется ещё раз', async () => {
    const run = createReadonlyRunner(db);
    const r = await run("SELECT 'звоните 8 911 000-11-22 или a@b.ru' AS t");
    expect(r.rows[0]![0]).toBe('звоните *** или ***');
  });

  test('каждый запрос выполняется отдельно и ничего не оставляет после себя: роль и режим не «залипают» на соединении', async () => {
    await seed();
    const run = createReadonlyRunner(db);
    await run('SELECT 1');
    expect((await db.query('SELECT count(*)::int AS n FROM groups')).rows[0].n).toBe(2);
    expect((await db.query('SELECT current_user')).rows[0].current_user).not.toBe('assistant_ro');
  });
});

describe('условные номера вместо имён', () => {
  test('словарь строится из самих таблиц тем же правилом, что и представления: номер из ответа возвращается именем', async () => {
    const { u } = await seed();
    const dict = await loadPseudonyms(db);
    const run = createReadonlyRunner(db);
    const leader = (await run('SELECT leader FROM groups ORDER BY id LIMIT 1')).rows[0]![0] as string;
    expect(dict.toReal(`${leader} ведёт две группы, а Участник-${u.registration_no} состоит в одной`)).toBe('Иван Петров ведёт две группы, а Мария Секретная состоит в одной');
  });

  test('имя в вопросе служителя заменяется номером до отправки, в том числе при другом регистре и лишних пробелах', async () => {
    const { u } = await seed();
    const dict = await loadPseudonyms(db);
    expect(dict.toRef('в каких группах мария  секретная?')).toBe(`в каких группах Участник-${u.registration_no}?`);
    expect(dict.toRef('где ведёт Иван Петров?')).toMatch(/^где ведёт Ведущий-[0-9a-f]{6}\?$/);
  });

  test('чужие и неизвестные номера не трогаются, обычный текст не портится', () => {
    const d = buildPseudonyms([{ ref: 'Участник-1', name: 'Мария Секретная' }, { ref: 'Участник-2', name: 'Анна' }]);
    expect(d.toReal('Участник-99 и Ведущий-abcdef')).toBe('Участник-99 и Ведущий-abcdef');
    expect(d.toRef('Анна пришла, Мариям привет')).toBe('Анна пришла, Мариям привет');
    expect(d.toRef('Мария Секретная и Марию Секретную')).toBe('Участник-1 и Марию Секретную');
  });

  test('ни в одном ответе помощнику не встречаются имена из базы', async () => {
    await seed();
    const dict = await loadPseudonyms(db);
    const run = createReadonlyRunner(db);
    const tables = [await run('SELECT * FROM people'), await run('SELECT * FROM requests'), await run('SELECT * FROM groups'), await run('SELECT * FROM placements'), await run('SELECT * FROM coordinators')];
    const text = JSON.stringify(tables);
    expect(dict.toRef(text)).toBe(text);
    expect(text).not.toMatch(/Мария|Секретная|Иван|Петров|Анна|Координатор(?!-)|Сергею|8999/);
  });
});

describe('словарь имён не зависит от порядка строк', () => {
  test('у одного номера несколько написаний: в любом порядке возвращается аккуратное, с заглавных', () => {
    const a = { ref: 'Ведущий-aaaaaa', name: 'Иван Петров' };
    const b = { ref: 'Ведущий-aaaaaa', name: 'иван  петров' };
    expect(buildPseudonyms([a, b]).toReal('Ведущий-aaaaaa')).toBe('Иван Петров');
    expect(buildPseudonyms([b, a]).toReal('Ведущий-aaaaaa')).toBe('Иван Петров');
  });
});
