import type { Pool } from 'pg';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { PlacementRepo, type ActionOutcome } from '../src/db/repos/placement.repo.js';
import { createActions } from '../src/home-groups/actions.js';
import { composeViews, engine as realEngine } from '../src/home-groups/composition.js';
import { createHomeGroupsServer } from '../src/home-groups/server.js';
import type { RequestsView } from '../src/home-groups/contracts.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Действие координатора от HTTP до базы: утверждение меняет заявку, пишет журнал, а список сразу
 * показывает результат (снимок сбрасывается). Движок поддельный, остальное — боевое.
 */

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

describe('разбор тела запроса', () => {
  const calls: unknown[][] = [];
  const stub = {
    approve: async (...a: unknown[]) => { calls.push(['approve', ...a]); return { ok: true } as ActionOutcome; },
    reject: async (...a: unknown[]) => { calls.push(['reject', ...a]); return { ok: true } as ActionOutcome; },
    setNeedCall: async (...a: unknown[]) => { calls.push(['need', ...a]); return { ok: true } as ActionOutcome; },
  } as unknown as PlacementRepo;
  const actions = createActions(stub, { defaultCapacity: 10 });
  beforeEach(() => { calls.length = 0; });

  test.each([null, 'текст', [], {}, { groupId: '5' }, { groupId: 0 }, { groupId: -1 }, { groupId: 1.5 }, { groupId: 5, force: 'да' }])(
    'утверждение с телом %j отклоняется до обращения к базе',
    async (body) => {
      expect(await actions.approve(1, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
      expect(calls).toHaveLength(0);
    },
  );

  test('утверждение без force передаёт force=false и вместимость по умолчанию', async () => {
    await actions.approve(1, { groupId: 5 }, 'a');
    expect(calls[0]).toEqual(['approve', 1, 5, 'a', { force: false, defaultCapacity: 10 }]);
  });

  test.each([{ groupId: 1 }, { groupId: 1, reason: 7 }, { groupId: 1, reason: 'far', comment: 5 }, { reason: 'far' }])(
    'отказ с телом %j отклоняется', async (body) => {
      expect(await actions.reject(1, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
      expect(calls).toHaveLength(0);
    },
  );

  test('слишком длинный комментарий к отказу отклоняется', async () => {
    expect(await actions.reject(1, { groupId: 1, reason: 'other', comment: 'я'.repeat(501) }, 'a')).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  test('«нужен звонок» требует true или false', async () => {
    expect(await actions.setNeedCall(1, { value: 'yes' }, 'a')).toMatchObject({ ok: false });
    await actions.setNeedCall(1, { value: true }, 'a');
    expect(calls).toEqual([['need', 1, true, 'a']]);
  });
});

describe('утверждение через HTTP на живой базе', () => {
  async function start(engine = createFakeEngine().engine) {
    const store = new Map<string, string>();
    const memory: SessionStore = {
      async set(k, v) { store.set(k, v); }, async get(k) { return store.get(k) ?? null; },
      async del(k) { store.delete(k); }, async incr(k) { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    };
    const web = mkdtempSync(join(tmpdir(), 'hg-act-'));
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    // Долгий срок жизни снимка: список обновится только потому, что действие его сбросило.
    const views = composeViews(db, engine, { defaultCapacity: 10, ttlMs: 60_000 });
    const server = createHomeGroupsServer({
      auth: new SessionService(memory, { password: 'пароль-для-теста', login: 'mbv_admin', superPassword: 'другой-пароль-1', superLogin: 'super_mbv_admin', ttlSeconds: 60, maxAttempts: 5 }),
      views,
      actions: createActions(new PlacementRepo(db), { defaultCapacity: 10 }),
      invalidateViews: () => views.invalidate(),
      actorName: (role) => (role === 'super' ? 'super_mbv_admin' : 'mbv_admin'),
      sessionTtlSeconds: 60, secureCookie: false, webDir: web,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.4.0.1' },
      body: new URLSearchParams({ login: 'mbv_admin', password: 'пароль-для-теста' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const post = (path: string, body: unknown) => fetch(`${base}/api/v1/requests/${path}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const list = async () => (await (await fetch(`${base}/api/v1/requests`, { headers: { cookie } })).json()) as RequestsView;
    return { server, post, list };
  }

  async function seed() {
    const g = (await db.query<{ id: number }>(
      `INSERT INTO groups (leader, district, format, status, people, source)
       VALUES ('Иван Петров', 'Приморский', 'Основная церковь', 'Функционирует', 3, 'ui') RETURNING id`,
    )).rows[0]!.id;
    const r = (await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, place, origin) VALUES ('join_group', 'Новая', 'Мария Иванова', 'Приморский', 'ui') RETURNING id`,
    )).rows[0]!.id;
    return { g, r };
  }

  test('после «Утвердить» заявка в списке сразу становится утверждённой, а в журнале есть след', async () => {
    const { g, r } = await seed();
    const app = await start();
    try {
      const before = (await app.list()).items.find((i) => i.id === r)!;
      expect(before.bucket).not.toBe('done');

      const res = await app.post(`${r}/approve`, { groupId: g });
      expect(res.status).toBe(200);

      const after = (await app.list()).items.find((i) => i.id === r)!;
      expect(after.bucket).toBe('done');
      expect(after.finalGroup?.id).toBe(g);
      expect(after.log.map((l) => l.text)).toContain(`Утверждено: ДГ-${String(g).padStart(4, '0')}, Иван Петров · mbv_admin`);
    } finally { app.server.close(); }
  });

  test('повторное утверждение той же заявки — 409 «уже обработали»', async () => {
    const { g, r } = await seed();
    const app = await start();
    try {
      expect((await app.post(`${r}/approve`, { groupId: g })).status).toBe(200);
      const again = await app.post(`${r}/approve`, { groupId: g });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: 'already_closed' });
    } finally { app.server.close(); }
  });

  test('«нужен звонок» переносит заявку в «перезвонить» в тот же миг', async () => {
    const { r } = await seed();
    const app = await start();
    try {
      await app.list();
      expect((await app.post(`${r}/need-call`, { value: true })).status).toBe(200);
      const item = (await app.list()).items.find((i) => i.id === r)!;
      expect(item.callback).toBe(true);
    } finally { app.server.close(); }
  });

  test('отказ запоминается: отклонённая группа больше не предлагается этой заявке (настоящий движок)', async () => {
    const { g, r } = await seed();
    const app = await start(realEngine);
    try {
      const before = (await app.list()).items.find((i) => i.id === r)!;
      expect(before.proposal?.main.group.id).toBe(g);

      expect((await app.post(`${r}/reject`, { groupId: g, reason: 'time' })).status).toBe(200);
      const rows = await db.query(`SELECT status, reject_reason FROM placement_proposals WHERE request_id = $1`, [r]);
      expect(rows.rows).toEqual([{ status: 'rejected', reject_reason: 'time' }]);

      const after = (await app.list()).items.find((i) => i.id === r)!;
      expect(after.proposal).toBeNull();
      expect(after.bucket).toBe('human');
    } finally { app.server.close(); }
  });
});
