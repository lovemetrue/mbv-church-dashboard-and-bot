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
  return createMapConfig({ settings: new SettingsRepo(db), audit: new AuditRepo(db), secret, now: () => now, timeZone: 'Europe/Moscow' });
}
// Второй ключ — Static API (снимок карты), тоже пустышка из частей.
const STATIC = ['static', 'key', '0000EFGH'].join('-');
const stored = async () => (await db.query(`SELECT value FROM app_settings WHERE key = 'map.api_key'`)).rows[0]?.value ?? null;

describe('ключ карты и счётчик открытий', () => {
  test('ключ шифруется в базе, настройки показывают лишь последние четыре символа, а странице он отдаётся целиком', async () => {
    const cfg = make();
    expect(await cfg.save({ apiKey: `  "${KEY}" ` }, 'admin')).toEqual({ ok: true });
    expect(JSON.stringify(await stored())).not.toContain(KEY);
    expect(await cfg.view()).toEqual({
      keySet: true, keyHint: 'ABCD', keyUnreadable: false,
      staticKeySet: false, staticKeyHint: null, staticKeyUnreadable: false,
      loadsToday: 0, dailyLimit: 100,
    });
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

  test('у Яндекса лимит 100 открытий в сутки: счёт идёт по дню кампании (Москва), а в полночь по Москве начинается заново', async () => {
    // 20:30 UTC 13 октября — это уже 23:30 по Москве, а 21:30 UTC — 00:30 14 октября по Москве.
    const evening = make(new Date('2026-10-13T20:30:00Z'));
    await evening.recordLoad();
    await evening.recordLoad();
    expect((await evening.bootstrap()).loadsToday).toBe(2);
    expect((await make(new Date('2026-10-13T10:00:00Z')).view()).loadsToday).toBe(2);
    expect((await make(new Date('2026-10-13T21:30:00Z')).bootstrap()).loadsToday).toBe(0);
    expect((await evening.view()).dailyLimit).toBe(100);
  });

  test('ключ Static API хранится отдельно и тоже зашифрован; странице он не отдаётся, только признак, что снимок возможен', async () => {
    const cfg = make();
    expect(await cfg.save({ staticKey: STATIC }, 'admin')).toEqual({ ok: true });
    const sealed = (await db.query(`SELECT value FROM app_settings WHERE key = 'map.static_key'`)).rows[0]?.value;
    expect(JSON.stringify(sealed)).not.toContain(STATIC);
    expect(await cfg.view()).toMatchObject({ keySet: false, staticKeySet: true, staticKeyHint: 'EFGH' });
    expect(await cfg.staticKey()).toBe(STATIC);
    const boot = await cfg.bootstrap();
    expect(JSON.stringify(boot)).not.toContain(STATIC);
    expect(boot).toMatchObject({ apiKey: null, staticReady: true });
    expect(await cfg.save({ staticKey: null }, 'admin')).toEqual({ ok: true });
    expect((await cfg.bootstrap()).staticReady).toBe(false);
    expect(await cfg.save({ staticKey: 'коротко' }, 'admin')).toMatchObject({ ok: false, error: 'bad_request' });
    const log = (await db.query(`SELECT after::text AS after FROM audit_log ORDER BY id`)).rows.map((r) => r.after);
    expect(log).toEqual(['{"staticKey": "set"}', '{"staticKey": "removed"}']);
  });
});
