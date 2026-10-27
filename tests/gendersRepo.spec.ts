import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { GendersRepo } from '../src/db/repos/genders.repo.js';
import { MaintenanceRepo } from '../src/db/repos/maintenance.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { createGenders, parseWords } from '../src/home-groups/genders.js';
import type { LlmClient } from '../src/platform/llm/deepseek.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: GendersRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new GendersRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

/** Человек заявки в «Людях»: у заявки без регистрации — её карточка (миграция 057). */
const keyOfRequest = async (id: number): Promise<string> =>
  (await db.query<{ key: string }>(`SELECT CASE WHEN user_id IS NOT NULL THEN 'u' || user_id ELSE 'p' || person_id END AS key FROM requests WHERE id = $1`, [id])).rows[0]!.key;

async function request(userId: number | null = null): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, user_id, fio, status, origin) VALUES ('join_group', $1, 'Саша Ким', 'Новая', 'ui') RETURNING id`,
    [userId],
  );
  return rows[0]!.id;
}
const proposal = async (requestId: number) => {
  const g = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Ведущий', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
  await db.query(`INSERT INTO placement_proposals (request_id, group_id, source, confidence, rationale) VALUES ($1, $2, 'script', 80, '[]'::jsonb)`, [requestId, g]);
};
const proposalStatus = async (requestId: number) => (await db.query('SELECT status FROM placement_proposals WHERE request_id = $1', [requestId])).rows.map((r) => r.status);

describe('пол человека в базе', () => {
  test('у заявки с регистрацией пол ложится на регистрацию, без неё — на карточку её человека; null снимает', async () => {
    const u = await seedUser(db, { id: '1' });
    const withUser = await request(u);
    const noUser = await request();
    expect(await repo.set({ kind: 'request', id: withUser }, 'ж', 'anna')).toEqual({ ok: true });
    expect(await repo.set({ kind: 'request', id: noUser }, 'м', 'anna')).toEqual({ ok: true });
    expect(await repo.all()).toEqual(new Map([[`u${u}`, { gender: 'ж', by: 'anna' }], [await keyOfRequest(noUser), { gender: 'м', by: 'anna' }]]));
    expect(await repo.set({ kind: 'user', id: u }, null, 'anna')).toEqual({ ok: true });
    expect([...(await repo.all()).keys()]).toEqual([await keyOfRequest(noUser)]);
  });

  test('смена пола снимает закреплённое предложение группы: оно могло быть в группу другого пола', async () => {
    const r = await request();
    await proposal(r);
    await repo.set({ kind: 'request', id: r }, 'м', 'anna');
    expect(await proposalStatus(r)).toEqual(['superseded']);
  });

  test('в журнал — значение, без имени', async () => {
    const r = await request();
    await repo.set({ kind: 'request', id: r }, 'ж', 'anna');
    const { rows } = await db.query(`SELECT action, after FROM audit_log`);
    expect(rows).toEqual([{ action: 'request.gender', after: { gender: 'ж' } }]);
  });

  test('подсказки модели не перетирают поставленное служителем', async () => {
    const u = await seedUser(db, { id: '1' });
    await repo.set({ kind: 'user', id: u }, 'ж', 'anna');
    expect(await repo.fillFromAi([{ key: `u${u}`, gender: 'м' }, { key: 'r5', gender: 'м' }])).toBe(1);
    expect(await repo.all()).toEqual(new Map([[`u${u}`, { gender: 'ж', by: 'anna' }], ['r5', { gender: 'м', by: 'ии' }]]));
  });

  test('незнакомая заявка — «не найдена»', async () => {
    expect(await repo.set({ kind: 'request', id: 999 }, 'м', 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('удаление регистрации и очистка базы убирают её пол: номера начнутся заново и достались бы чужим', async () => {
    const u = await seedUser(db, { id: '1' });
    await repo.set({ kind: 'user', id: u }, 'м', 'a');
    await new UsersRepo(db).delete(u);
    expect((await repo.all()).size).toBe(0);
    const u2 = await seedUser(db, { id: '2' });
    await repo.set({ kind: 'user', id: u2 }, 'м', 'a');
    await repo.fillFromAi([{ key: 'p1', gender: 'ж' }]);
    await new MaintenanceRepo(db).resetAll();
    expect([...(await repo.all()).keys()]).toEqual(['p1']);
  });
});

describe('пол: прогон моделью', () => {
  const fakeLlm = (answer: Record<string, string>, seen: string[] = []): LlmClient => ({
    model: 'тест',
    complete: async (req) => {
      seen.push(req.user);
      return { text: JSON.stringify({ words: answer }) };
    },
    chat: async () => { throw new Error('не нужен'); },
  } as unknown as LlmClient);

  test('модели уходят отдельные слова, а не ФИО; заполняется, где все слова согласны', async () => {
    const seen: string[] = [];
    const genders = createGenders({
      repo,
      llm: fakeLlm({ Ярик: 'м', Ким: '?', Женя: '?' }, seen),
      unknown: async () => [{ key: 'r1', fio: 'Ярик Ким' }, { key: 'r2', fio: 'Женя Ким' }],
    });
    expect(await genders.fillWithAi()).toEqual({ ok: true, unknownBefore: 2, filled: 1, left: 1 });
    expect(await repo.all()).toEqual(new Map([['r1', { gender: 'м', by: 'ии' }]]));
    expect(seen.join('')).not.toContain('Ярик Ким');
    expect(JSON.parse(seen[0]!)).toEqual({ words: ['Женя', 'Ким', 'Ярик'] });
  });

  test('без подключённого помощника — понятный отказ', async () => {
    const genders = createGenders({ repo, llm: null, unknown: async () => [] });
    expect(await genders.fillWithAi()).toMatchObject({ ok: false, error: 'unavailable' });
  });

  test('ответ модели: берутся только спрошенные слова и только «м»/«ж»', () => {
    expect(parseWords('{"words":{"Ярик":"м","Чужое":"ж","Ким":"?"}}', new Set(['Ярик', 'Ким']))).toEqual([['Ярик', 'м']]);
    expect(parseWords('не json', new Set(['Ярик']))).toEqual([]);
  });

  test('неверное тело ручной установки отклоняется до базы', async () => {
    const genders = createGenders({ repo, llm: null, unknown: async () => [] });
    expect(await genders.set({ key: 'u1', gender: 'x' }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await genders.set({ key: 'плохо', gender: 'м' }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });
});
