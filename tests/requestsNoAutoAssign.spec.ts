import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import type { RequestType } from '../src/core/fsm.js';
import { seedCoordinator, seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: RequestsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new RequestsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const responsibleOf = async (id: number) => (await db.query<{ responsible: string | null }>('SELECT responsible FROM requests WHERE id = $1', [id])).rows[0]!.responsible;
const botRequest = async (n: number, type: RequestType) => {
  const u = await seedUser(db, { id: String(1000 + n) });
  return (await repo.create(u, type)).id;
};

describe('новые заявки приходят «не назначен»: автоназначения нет', () => {
  test('заявка любого типа из бота остаётся без ответственного, даже если в «Команде» есть распределитель', async () => {
    await seedCoordinator(db, 'Анна Распределова', ['Распределитель']);
    const types: RequestType[] = ['join_group', 'lead_group', 'question', 'already_member', 'already_leader'];
    for (const [i, type] of types.entries()) expect(await responsibleOf(await botRequest(i + 1, type)), type).toBeNull();
  });

  test('заявка из формы дашборда без ответственного остаётся без него; указанный вручную сохраняется', async () => {
    await seedCoordinator(db, 'Анна Распределова', ['Распределитель']);
    const base = { fio: 'Из формы', type: 'join_group' as const, status: 'Новая' as const };
    expect(await responsibleOf(await repo.createFromDashboard({ ...base }))).toBeNull();
    expect(await responsibleOf(await repo.createFromDashboard({ ...base, responsible: 'Другой Человек' }))).toBe('Другой Человек');
  });

  test('в журнал не пишется запись об автоназначении', async () => {
    await seedCoordinator(db, 'Анна Распределова', ['Распределитель']);
    await botRequest(1, 'join_group');
    const { rows } = await db.query(`SELECT 1 FROM audit_log WHERE action = 'request.assign'`);
    expect(rows).toEqual([]);
  });
});
