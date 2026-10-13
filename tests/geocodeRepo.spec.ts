import { readFileSync } from 'node:fs';
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
  test('точка с точностью и «не нашли» читаются обратно, повторная запись заменяет прежнюю', async () => {
    await repo.save('рылеева 32', { lat: 59.94, lon: 30.35 }, 'house');
    await repo.save('юкки', { lat: 60.1, lon: 30.3 }, 'area');
    await repo.save('потерянная 9', null, null);
    expect(await repo.all()).toEqual(new Map([
      ['рылеева 32', { lat: 59.94, lon: 30.35, accuracy: 'house', matched: null }],
      ['юкки', { lat: 60.1, lon: 30.3, accuracy: 'area', matched: null }],
      ['потерянная 9', null],
    ]));
    await repo.save('рылеева 32', { lat: 1, lon: 2 }, 'street');
    expect((await repo.all()).get('рылеева 32')).toEqual({ lat: 1, lon: 2, accuracy: 'street', matched: null });
    expect(await repo.countSince(24)).toBe(3);
    await db.query("UPDATE geocode_cache SET fetched_at = now() - interval '2 days' WHERE address_key = 'потерянная 9'");
    expect(await repo.countSince(24)).toBe(2);
  });

  test('записи старого вида (точность Яндекса exact, number…) читаются как «дом»', async () => {
    await db.query(`INSERT INTO geocode_cache (address_key, found, lat, lon, accuracy) VALUES ('старый', true, 1, 2, 'exact'), ('ближний', true, 3, 4, 'near')`);
    expect(await repo.all()).toEqual(new Map([['старый', { lat: 1, lon: 2, accuracy: 'house', matched: null }], ['ближний', { lat: 3, lon: 4, accuracy: 'house', matched: null }]]));
  });

  test('миграция 037 сбрасывает только «не нашлось»: найденные адреса остаются, ненайденные запросятся заново', async () => {
    await repo.save('найден', { lat: 1, lon: 2 }, 'house');
    await repo.save('не нашёлся', null, null);
    await db.query(readFileSync(new URL('../migrations/037_geocode_requery_missing.sql', import.meta.url), 'utf8'));
    expect([...(await repo.all()).keys()]).toEqual(['найден']);
  });

  test('что нашёл Яндекс хранится вместе с точкой и заменяется при повторной записи', async () => {
    await repo.save('среда', { lat: 59.9, lon: 30.4, matched: 'Россия, Санкт-Петербург, улица Средняя' }, 'street');
    expect((await repo.all()).get('среда')).toEqual({ lat: 59.9, lon: 30.4, accuracy: 'street', matched: 'Россия, Санкт-Петербург, улица Средняя' });
    await repo.save('среда', null, null);
    expect((await repo.all()).get('среда')).toBeNull();
  });

  test('миграция 038 сбрасывает найденные адреса (чтобы заново подобрались с текстом Яндекса), «не нашлось» остаётся', async () => {
    await db.query('ALTER TABLE geocode_cache DROP COLUMN matched');
    await db.query(`INSERT INTO geocode_cache (address_key, found, lat, lon, accuracy) VALUES ('найден', true, 1, 2, 'house'), ('нет', false, null, null, null)`);
    await db.query(readFileSync(new URL('../migrations/038_geocode_matched.sql', import.meta.url), 'utf8'));
    expect([...(await repo.all()).keys()]).toEqual(['нет']);
  });
});
