import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { createBotSettings } from '../src/home-groups/botSettings.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const make = (env = 'off') => createBotSettings({ settings: new SettingsRepo(db), audit: new AuditRepo(db), envValue: env });
const stored = async () => (await db.query(`SELECT value FROM app_settings WHERE key = 'bot.extra_questions'`)).rows[0]?.value ?? null;

describe('настройка бота «новые вопросы анкеты»', () => {
  test('пока настройку не меняли, показывается значение из .env и сказано, откуда оно', async () => {
    expect((await make('off').view()).extraQuestions).toEqual({ mode: 'off', ids: '', source: 'env', envValue: 'off' });
    expect((await make('all').view()).extraQuestions).toMatchObject({ mode: 'all', source: 'env' });
    expect((await make('max:7, 5').view()).extraQuestions).toMatchObject({ mode: 'list', ids: 'max:7,5', source: 'env' });
  });

  test('сохранённое значение показывается и сразу меняет режим', async () => {
    const s = make('off');
    expect(await s.setExtraQuestions({ mode: 'all' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('all');
    expect((await s.view()).extraQuestions).toMatchObject({ mode: 'all', source: 'settings', envValue: 'off' });
    expect(await s.setExtraQuestions({ mode: 'off' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('off');
  });

  test('список id нормализуется: пробелы, регистр, повторы убираются', async () => {
    const s = make();
    expect(await s.setExtraQuestions({ mode: 'list', ids: ' MAX:27637540 , 1763357182,max:27637540 ' }, 'boss')).toEqual({ ok: true });
    expect(await stored()).toBe('max:27637540,1763357182');
  });

  test.each([
    [{ mode: 'list' }], [{ mode: 'list', ids: '' }], [{ mode: 'list', ids: 'сорок два' }], [{ mode: 'list', ids: 'vk:123' }],
    [{ mode: 'list', ids: '1,,' }], [{ mode: 'всем' }], [{}], [null], [{ mode: 'all', ids: 5 }],
  ])('неверное тело %j отклоняется, ничего не сохраняется', async (body) => {
    expect(await make().setExtraQuestions(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await stored()).toBeNull();
  });

  test('в журнале режим и число id, но не сами id', async () => {
    await make().setExtraQuestions({ mode: 'list', ids: '27637540,1763357182' }, 'boss');
    const [e] = (await db.query(`SELECT actor, action, after::text AS after FROM audit_log`)).rows;
    expect(e).toMatchObject({ actor: 'boss', action: 'settings.extra_questions' });
    expect(JSON.parse(e.after)).toEqual({ mode: 'list', count: 2 });
  });
});
