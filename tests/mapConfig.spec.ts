import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { createMapConfig } from '../src/home-groups/mapConfig.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const SECRET = 'секрет сервера';
// Ключ-пустышка из частей: сканеры секретов не должны принимать его за настоящий.
const KEY = ['map', 'key', '0000ABCD'].join('-');

function make(now = new Date('2026-10-13T10:00:00Z'), secret = SECRET) {
  return createMapConfig({ settings: new SettingsRepo(db), audit: new AuditRepo(db), secret, now: () => now });
}
const stored = async () => (await db.query(`SELECT value FROM app_settings WHERE key = 'map.api_key'`)).rows[0]?.value ?? null;

describe('ключ карты и счётчик открытий', () => {
  test('ключ шифруется в базе, настройки показывают лишь последние четыре символа, а странице он отдаётся целиком', async () => {
    const cfg = make();
    expect(await cfg.save({ apiKey: `  "${KEY}" ` }, 'admin')).toEqual({ ok: true });
    expect(JSON.stringify(await stored())).not.toContain(KEY);
    expect(await cfg.view()).toEqual({ keySet: true, keyHint: 'ABCD', keyUnreadable: false, loadsThisMonth: 0, monthlyLimit: 100 });
    expect((await cfg.bootstrap()).apiKey).toBe(KEY);
    const log = (await db.query(`SELECT action, after::text AS after FROM audit_log`)).rows;
    expect(log).toEqual([{ action: 'settings.map', after: '{"key": "set"}' }]);
  });

  test('убрать ключ — карты нет; плохие ключи отклоняются; без секрета сервера сохранить нельзя', async () => {
    const cfg = make();
    await cfg.save({ apiKey: KEY }, 'admin');
    expect(await cfg.save({ apiKey: null }, 'admin')).toEqual({ ok: true });
    expect((await cfg.bootstrap()).apiKey).toBeNull();
    for (const apiKey of ['коротко', 'с пробелом 12345678', 'кириллица-ключ-123456']) {
      expect(await cfg.save({ apiKey }, 'admin')).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(await cfg.save({}, 'admin')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await make(undefined, '').save({ apiKey: KEY }, 'admin')).toMatchObject({ ok: false, error: 'unavailable' });
  });

  test('каждое открытие карты считается в своём месяце: в новом месяце счёт начинается заново', async () => {
    const october = make(new Date('2026-10-13T10:00:00Z'));
    await october.recordLoad();
    await october.recordLoad();
    expect((await october.bootstrap()).loadsThisMonth).toBe(2);
    expect((await make(new Date('2026-11-01T00:30:00Z')).bootstrap()).loadsThisMonth).toBe(0);
    expect((await october.view()).loadsThisMonth).toBe(2);
  });
});
