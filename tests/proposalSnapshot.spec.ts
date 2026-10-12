import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { inputSnapshot } from '../src/home-groups/plan/signature.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: PlacementRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new PlacementRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const base = { district: 'Приморский', ageRange: [25, 35] as [number, number], days: [] as never[], slot: null, street: null };
async function seed() {
  const g1 = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, format, status, source) VALUES ('Один', 'Приморский', 'очно', 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
  const g2 = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, format, status, source) VALUES ('Два', 'Невский', 'очно', 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
  const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, fio, status, origin) VALUES ('join_group', 'Человек', 'Новая', 'ui') RETURNING id`)).rows[0]!.id;
  return { g1, g2, r };
}
const desired = (requestId: number, groupId: number, hash: string, snap: ReturnType<typeof inputSnapshot>) =>
  ({ requestId, groupId, confidence: 80, rationale: [], inputHash: hash, inputSnapshot: snap });
const audits = async () => (await db.query(`SELECT actor, action, entity_type, entity_id::int AS entity_id, after FROM audit_log WHERE action = 'request.data_changed' ORDER BY id`)).rows;

describe('снимок данных у предложения', () => {
  test('при сохранении предложения снимок кладётся в базу и возвращается вместе с действующими предложениями', async () => {
    const { g1, r } = await seed();
    const snap = inputSnapshot(base);
    await repo.syncProposals([desired(r, g1, 'h1', snap)], 'auto');
    expect((await repo.activeProposals()).get(r)).toMatchObject({ groupId: g1, inputHash: 'h1', inputSnapshot: snap });
  });

  test('данные изменились, группа та же: снимок обновляется, а в журнал пишется, какие поля изменились (без значений)', async () => {
    const { g1, r } = await seed();
    await repo.syncProposals([desired(r, g1, 'h1', inputSnapshot(base))], 'auto');
    const after = inputSnapshot({ ...base, street: 'ул. Секретная 7', slot: 'вечер' });
    await repo.syncProposals([desired(r, g1, 'h2', after)], 'auto');
    expect((await repo.activeProposals()).get(r)).toMatchObject({ inputHash: 'h2', inputSnapshot: after });
    const log = await audits();
    expect(log).toEqual([{ actor: 'auto', action: 'request.data_changed', entity_type: 'request', entity_id: r, after: { fields: ['Время суток', 'Улица'] } }]);
    expect(JSON.stringify(log)).not.toContain('Секретная');
  });

  test('данные те же — в журнал ничего не пишется', async () => {
    const { g1, r } = await seed();
    const snap = inputSnapshot(base);
    await repo.syncProposals([desired(r, g1, 'h1', snap)], 'auto');
    await repo.syncProposals([desired(r, g1, 'h1', snap)], 'auto');
    expect(await audits()).toEqual([]);
  });

  test('данные изменились и группа другая: новое предложение со своим снимком, в журнале изменившиеся поля', async () => {
    const { g1, g2, r } = await seed();
    await repo.syncProposals([desired(r, g1, 'h1', inputSnapshot(base))], 'auto');
    const moved = inputSnapshot({ ...base, district: 'Невский' });
    await repo.syncProposals([desired(r, g2, 'h2', moved)], 'auto');
    expect((await repo.activeProposals()).get(r)).toMatchObject({ groupId: g2, inputSnapshot: moved });
    expect((await audits()).map((e) => e.after)).toEqual([{ fields: ['Район'] }]);
  });

  test('у предложения, сохранённого до появления снимков, снимка нет (null), и первое изменение пишет в журнал пустой список полей', async () => {
    const { g1, r } = await seed();
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source, confidence, rationale, input_hash) VALUES ($1, $2, 'script', 80, '[]'::jsonb, 'old')`, [r, g1]);
    expect((await repo.activeProposals()).get(r)!.inputSnapshot).toBeNull();
    await repo.syncProposals([desired(r, g1, 'new', inputSnapshot(base))], 'auto');
    expect((await repo.activeProposals()).get(r)).toMatchObject({ inputHash: 'new', inputSnapshot: inputSnapshot(base) });
    expect((await audits()).map((e) => e.after)).toEqual([{ fields: [] }]);
  });
});
