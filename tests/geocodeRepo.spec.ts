import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { GeocodeRepo } from '../src/db/repos/geocode.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: GeocodeRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new GeocodeRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

describe('кэш координат', () => {
  test('точка и «не нашли» читаются обратно, повторная запись заменяет прежнюю', async () => {
    await repo.save('рылеева 32', { lat: 59.94, lon: 30.35 }, 'exact');
    await repo.save('потерянная 9', null, null);
    expect(await repo.all()).toEqual(new Map([['рылеева 32', { lat: 59.94, lon: 30.35 }], ['потерянная 9', null]]));
    await repo.save('рылеева 32', { lat: 1, lon: 2 }, 'number');
    expect((await repo.all()).get('рылеева 32')).toEqual({ lat: 1, lon: 2 });
  });
});
