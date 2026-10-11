import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const put = (actor: string, action: string, daysAgo: number, entity = 'request') =>
  db.query(
    `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, at) VALUES ($1, 'home-groups', $2, $3, 1, now() - ($4::int * interval '1 day'))`,
    [actor, action, entity, daysAgo],
  );

describe('действия за неделю для сводки руководителя', () => {
  test('считает по человеку и действию, только свежие и только ручные действия над заявками', async () => {
    await put('anna', 'request.call', 1);
    await put('anna', 'request.call', 2);
    await put('anna', 'request.approve', 3);
    await put('boris', 'request.edit', 1);
    await put('anna', 'request.call', 9);
    await put('anna', 'matching.run', 1, 'matching');
    await put('anna', 'request.need_call', 1);
    const rows = await new AuditRepo(db).activitySince(7);
    expect(rows.map((r) => `${r.actor}:${r.action}:${r.n}`).sort()).toEqual([
      'anna:request.approve:1', 'anna:request.call:2', 'boris:request.edit:1',
    ]);
  });
});
