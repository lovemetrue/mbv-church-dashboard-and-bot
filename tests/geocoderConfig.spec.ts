import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import type { Geocoder } from '../src/home-groups/geocode.js';
import { createGeocoderConfig } from '../src/home-groups/geocoderConfig.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const SECRET = 'секрет сервера';
// Ключи-пустышки собираются из частей: сканеры секретов не должны принимать их за настоящие.
const SAVED = ['ya', 'saved', 'key', '0000ABCD'].join('-');
const ENV_KEY = ['ya', 'env', 'key', '00001234'].join('-');

function make(env: NodeJS.ProcessEnv = {}, geocoder?: Geocoder) {
  const asked: string[] = [];
  const cfg = createGeocoderConfig({
    settings: new SettingsRepo(db), audit: new AuditRepo(db), env, secret: SECRET, usedToday: async () => 7,
    makeGeocoder: (key) => geocoder ?? { geocode: async () => { asked.push(key); return { kind: 'found', point: { lat: 1, lon: 2 }, precision: 'exact' }; } },
  });
  return { cfg, asked };
}
const stored = async () => (await db.query(`SELECT value FROM app_settings WHERE key = 'geocoder.api_key'`)).rows[0]?.value ?? null;

describe('ключ геокодера', () => {
  test('ничего не задано — ключа нет; в .env — виден источник и последние четыре символа', async () => {
    expect(await make().cfg.view()).toMatchObject({ keySet: false, keySource: null, usedToday: 7, dailyLimit: 900 });
    expect(await make({ YANDEX_GEOCODER_KEY: ENV_KEY }).cfg.view()).toMatchObject({ keySet: true, keySource: 'env', keyHint: '1234' });
  });

  test('сохранённый ключ лежит в базе зашифрованным, важнее .env и сразу действует; в журнале ключа нет', async () => {
    const { cfg } = make({ YANDEX_GEOCODER_KEY: ENV_KEY });
    expect(await cfg.save({ apiKey: `  "${SAVED}" ` }, 'admin')).toEqual({ ok: true });
    expect(JSON.stringify(await stored())).not.toContain(SAVED);
    expect(await cfg.currentKey()).toBe(SAVED);
    expect(await cfg.view()).toMatchObject({ keySource: 'settings', keyHint: 'ABCD' });
    const log = (await db.query(`SELECT actor, action, after::text AS after FROM audit_log`)).rows;
    expect(log).toEqual([{ actor: 'admin', action: 'settings.geocoder', after: '{"key": "set"}' }]);
  });

  test('«убрать сохранённый» возвращает ключ из .env', async () => {
    const { cfg } = make({ YANDEX_GEOCODER_KEY: ENV_KEY });
    await cfg.save({ apiKey: SAVED }, 'admin');
    expect(await cfg.save({ apiKey: null }, 'admin')).toEqual({ ok: true });
    expect(await cfg.currentKey()).toBe(ENV_KEY);
  });

  test('плохие ключи отклоняются понятным текстом и ничего не пишут', async () => {
    const { cfg } = make();
    for (const apiKey of ['коротко', 'с пробелом внутри 12345', 'кириллица-ключ-123456']) {
      expect(await cfg.save({ apiKey }, 'admin')).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(await cfg.save({}, 'admin')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await stored()).toBeNull();
  });

  test('без секрета сервера ключ сохранить нельзя: открыто мы его не храним', async () => {
    const cfg = createGeocoderConfig({ settings: new SettingsRepo(db), audit: new AuditRepo(db), env: {}, secret: '', usedToday: async () => 0 });
    expect(await cfg.save({ apiKey: SAVED }, 'admin')).toMatchObject({ ok: false, error: 'unavailable' });
  });

  test('проверка идёт с введённым ключом, а без него — с действующим, и ничего не сохраняет', async () => {
    const { cfg, asked } = make({ YANDEX_GEOCODER_KEY: ENV_KEY });
    expect(await cfg.test({ apiKey: SAVED })).toMatchObject({ ok: true });
    expect(await cfg.test({})).toMatchObject({ ok: true });
    expect(asked).toEqual([SAVED, ENV_KEY]);
    expect(await stored()).toBeNull();
    expect(await make().cfg.test({})).toMatchObject({ ok: false, message: expect.stringContaining('Ключ не задан') });
  });

  test('отказ Яндекса (неверный ключ, лимит) возвращается словами, а не ошибкой запроса', async () => {
    const refused: Geocoder = { geocode: async () => ({ kind: 'failed', message: 'Геокодер ответил 403' }) };
    expect(await make({}, refused).cfg.test({ apiKey: SAVED })).toMatchObject({ ok: false, message: expect.stringContaining('403') });
  });
});
