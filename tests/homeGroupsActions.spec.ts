import type { Pool } from 'pg';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { PlacementRepo, type ActionOutcome } from '../src/db/repos/placement.repo.js';
import { createActions } from '../src/home-groups/actions.js';
import { composeService, engine as realEngine } from '../src/home-groups/composition.js';
import { createHomeGroupsServer } from '../src/home-groups/server.js';
import type { RequestsView } from '../src/home-groups/contracts.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { seedCoordinator, setupTestDb, truncateAll } from './helpers/testDb.js';

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

describe('закрытие заявки и возврат в работу: разбор тела', () => {
  const calls: unknown[][] = [];
  const stub = {
    closeRequest: async (...a: unknown[]) => { calls.push(['close', ...a]); return { ok: true }; },
    reopen: async (...a: unknown[]) => { calls.push(['reopen', ...a]); return { ok: true }; },
  } as unknown as PlacementRepo;
  const actions = createActions(stub, { defaultCapacity: 10 });
  beforeEach(() => { calls.length = 0; });

  test.each([null, 'текст', {}, { outcome: 'потом' }, { outcome: 'cancel', reason: 5 }, { outcome: 'cancel', reason: 'потому' }, { outcome: 'done', comment: 5 }])(
    'тело %j отклоняется до обращения к базе', async (body) => {
      expect(await actions.close(1, body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
      expect(calls).toHaveLength(0);
    });

  test('верное тело доходит до базы с автором', async () => {
    await actions.close(1, { outcome: 'cancel', reason: 'duplicate', comment: 'дубль' }, 'a');
    await actions.reopen(1, 'a');
    expect(calls).toEqual([['close', 1, 'cancel', 'duplicate', 'дубль', 'a'], ['reopen', 1, 'a']]);
  });
});

describe('массовые действия над заявками', () => {
  const mk = async (status = 'Новая') => (await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', $1, 'М', 'ui') RETURNING id`, [status])).rows[0]!.id;
  const actions = () => createActions(new PlacementRepo(db), { defaultCapacity: 10 });

  test('передача нескольких заявок: открытые передаются, закрытые и чужие номера пропускаются', async () => {
    const [a, b, closed] = [await mk(), await mk(), await mk('Исполнена')];
    const out = await actions().bulk({ ids: [a, b, closed, 99999], action: 'assign', responsible: 'Анна' }, 'boss');
    expect(out).toEqual({ ok: true, done: 2, skipped: 2 });
    const rows = (await db.query('SELECT id, responsible FROM requests ORDER BY id')).rows;
    expect(rows.map((r) => r.responsible)).toEqual(['Анна', 'Анна', null]);
    expect((await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action='request.assign'`)).rows[0].n).toBe(2);
  });

  test('«нужен звонок» ставится сразу нескольким', async () => {
    const [a, b] = [await mk(), await mk()];
    expect(await actions().bulk({ ids: [a, b], action: 'need-call', value: true }, 'boss')).toEqual({ ok: true, done: 2, skipped: 0 });
    expect((await db.query('SELECT callback FROM requests')).rows.every((r) => r.callback)).toBe(true);
  });

  test('повторяющиеся номера считаются один раз', async () => {
    const a = await mk();
    expect(await actions().bulk({ ids: [a, a, a], action: 'assign', responsible: 'Анна' }, 'boss')).toEqual({ ok: true, done: 1, skipped: 0 });
  });

  test.each([
    [null], [{}], [{ ids: [] , action: 'assign'}], [{ ids: [1], action: 'удалить' }], [{ ids: ['1'], action: 'assign' }],
    [{ ids: [1], action: 'need-call' }], [{ ids: [1], action: 'assign', responsible: 5 }],
    [{ ids: Array.from({ length: 101 }, (_, i) => i + 1), action: 'assign', responsible: 'Анна' }],
  ])('неверное тело %j отклоняется до обращения к базе', async (body) => {
    expect(await actions().bulk(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
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
    const composed = composeService(db, engine, { defaultCapacity: 10, ttlMs: 60_000 });
    const views = composed.views;
    const server = createHomeGroupsServer({
      auth: new SessionService(memory, { password: 'пароль-для-теста', login: 'mbv_admin', superPassword: 'другой-пароль-1', superLogin: 'super_mbv_admin', ttlSeconds: 60, maxAttempts: 5 }),
      views,
      actions: createActions(new PlacementRepo(db), { defaultCapacity: 10 }),
      matching: composed.matching,
      settings: composed.settings,
      creator: composed.creator,
      registrar: composed.registrar,
      manager: composed.manager,
      exporter: composed.exporter,
      audit: composed.audit,
      formMeta: composed.formMeta,
      staff: composed.staff,
      reportError: (source, err, context) => { void composed.errors.record(source, err instanceof Error ? err.message : String(err), context); },
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
    const settingsGet = (name: string) => fetch(`${base}/api/v1/settings/${name}`, { headers: { cookie } });
    return { server, post, list, settingsGet, base, cookie };
  }

  async function seed() {
    const g = (await db.query<{ id: number }>(
      `INSERT INTO groups (leader, district, direction_id, status, people, source)
       VALUES ('Иван Петров', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui') RETURNING id`,
    )).rows[0]!.id;
    const r = (await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, place, origin, responsible) VALUES ('join_group', 'Новая', 'Мария Иванова', 'Приморский', 'ui', 'Анна') RETURNING id`,
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

  test('свободные места считаются от вместимости самой группы: в группу на 5 при пяти участниках — «нет мест»', async () => {
    const { g, r } = await seed();
    await db.query(`UPDATE groups SET capacity = 5, people = 5 WHERE id = $1`, [g]);
    const app = await start();
    try {
      const groups = await (await fetch(`${app.base}/api/v1/groups`, { headers: { cookie: app.cookie } })).json() as { items: { id: number }[] };
      const group = groups.items.find((x) => x.id === g);
      expect(group).toMatchObject({ capacity: 5, capacityOwn: 5, free: 0 });
      const res = await app.post(`${r}/approve`, { groupId: g });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'group_full' });
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


describe('раздел «Настройки» через HTTP на живой базе', () => {
  async function startSuper() {
    const store = new Map<string, string>();
    const memory: SessionStore = {
      async set(k, v) { store.set(k, v); }, async get(k) { return store.get(k) ?? null; },
      async del(k) { store.delete(k); }, async incr(k) { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    };
    const web = mkdtempSync(join(tmpdir(), 'hg-set-'));
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    const composed = composeService(db, createFakeEngine().engine, { defaultCapacity: 10, ttlMs: 0 });
    const server = createHomeGroupsServer({
      auth: new SessionService(memory, { password: 'пароль-для-теста', login: 'mbv_admin', superPassword: 'другой-пароль-1', superLogin: 'super_mbv_admin', ttlSeconds: 60, maxAttempts: 5 }),
      views: composed.views, actions: createActions(composed.placement, { defaultCapacity: 10 }), matching: composed.matching,
      settings: composed.settings, creator: composed.creator, formMeta: composed.formMeta, staff: composed.staff,
      reportError: (source, err, context) => { void composed.errors.record(source, err instanceof Error ? err.message : String(err), context); },
      invalidateViews: () => composed.views.invalidate(), actorName: (role) => (role === 'super' ? 'super_mbv_admin' : 'mbv_admin'),
      sessionTtlSeconds: 60, secureCookie: false, webDir: web,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.5.0.1' },
      body: new URLSearchParams({ login: 'super_mbv_admin', password: 'другой-пароль-1' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const json = (path: string, body: unknown) => fetch(`${base}/api/v1/settings/${path}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const get = async (name: string) => (await (await fetch(`${base}/api/v1/settings/${name}`, { headers: { cookie } })).json()) as any;
    return { server, json, get, base, cookie };
  }

  test('инструкция: сохранить, увидеть новой версией, откатить; журнал регистрации показывает оба действия', async () => {
    const app = await startSuper();
    try {
      expect((await app.get('prompts')).agents[0].blocks[0].isDefault).toBe(true);
      expect((await app.json('prompts/save', { agent: 'coordinator', block: 'role', text: 'Первая' })).status).toBe(200);
      expect((await app.json('prompts/save', { agent: 'coordinator', block: 'role', text: 'Вторая' })).status).toBe(200);
      expect((await app.get('prompts')).agents[0].blocks[0]).toMatchObject({ text: 'Вторая', isDefault: false });
      expect((await app.json('prompts/activate', { agent: 'coordinator', block: 'role', version: 1 })).status).toBe(200);
      expect((await app.get('prompts')).agents[0].blocks[0].text).toBe('Первая');

      const audit = await app.get('audit');
      expect(audit.items.map((i: { action: string }) => i.action)).toEqual(['prompt.activate', 'prompt.save', 'prompt.save']);
      expect(audit.items[0]).toMatchObject({ actor: 'super_mbv_admin', actionLabel: 'Откат версии инструкции агента' });
    } finally { app.server.close(); }
  });

  test('ошибка в запросе попадает в журнал ошибок: источник и «метод путь» без строки запроса', async () => {
    const app = await startSuper();
    try {
      // Ломаем чтение групп: сервис отвечает 500 и записывает ошибку в журнал.
      await db.query('ALTER TABLE groups RENAME TO groups_tmp');
      try {
        expect((await fetch(`${app.base}/api/v1/today?x=1`, { headers: { cookie: app.cookie } })).status).toBe(500);
      } finally { await db.query('ALTER TABLE groups_tmp RENAME TO groups'); }
      // Запись идёт в фоне: ждём её появления.
      let items: { service: string; context: string | null }[] = [];
      for (let i = 0; i < 20 && items.length === 0; i += 1) {
        items = (await app.get('errors')).items;
        if (items.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(items[0]).toMatchObject({ service: 'домашние группы', context: 'GET /api/v1/today' });
    } finally { app.server.close(); }
  });

  test('состояние сервера отдаётся с шестью метриками', async () => {
    const app = await startSuper();
    try {
      const h = await app.get('health');
      expect(h.metrics.map((m: { key: string }) => m.key)).toEqual(['cpu', 'memory', 'disk', 'database', 'sessions', 'service']);
      expect(h.metrics.find((m: { key: string }) => m.key === 'database').status).not.toBe('crit');
    } finally { app.server.close(); }
  });
});


describe('создание и параметры подбора через HTTP на живой базе', () => {
  async function startAdmin() {
    const store = new Map<string, string>();
    const memory: SessionStore = {
      async set(k, v) { store.set(k, v); }, async get(k) { return store.get(k) ?? null; },
      async del(k) { store.delete(k); }, async incr(k) { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    };
    const web = mkdtempSync(join(tmpdir(), 'hg-new-'));
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    const composed = composeService(db, realEngine, { defaultCapacity: 10, ttlMs: 60_000 });
    const server = createHomeGroupsServer({
      auth: new SessionService(memory, { password: 'пароль-для-теста', login: 'mbv_admin', superPassword: 'другой-пароль-1', superLogin: 'super_mbv_admin', ttlSeconds: 60, maxAttempts: 5 }),
      views: composed.views, actions: createActions(composed.placement, { defaultCapacity: 10 }), matching: composed.matching,
      settings: composed.settings, creator: composed.creator, formMeta: composed.formMeta, staff: composed.staff,
      reportError: () => undefined, invalidateViews: () => composed.views.invalidate(),
      actorName: (role) => (role === 'super' ? 'super_mbv_admin' : 'mbv_admin'), sessionTtlSeconds: 60, secureCookie: false, webDir: web,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.6.0.1' },
      body: new URLSearchParams({ login: 'mbv_admin', password: 'пароль-для-теста' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const post = (path: string, body: unknown) => fetch(`${base}/api/v1/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const get = async (path: string) => (await (await fetch(`${base}/api/v1/${path}`, { headers: { cookie } })).json()) as any;
    return { server, post, get };
  }

  test('созданная заявка сразу видна в списке и попадает в журнал; ошибка проверки — понятный текст', async () => {
    const app = await startAdmin();
    try {
      const bad = await app.post('requests/create', { fields: { type: 'join_group', status: 'Новая' } });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: 'bad_request', message: expect.stringContaining('ФИО') });

      await app.get('requests');
      const ok = await app.post('requests/create', { fields: { fio: 'Мария Иванова', type: 'join_group', status: 'Новая', place: 'Приморский', age: '25-40' } });
      expect(ok.status).toBe(200);
      const { id } = await ok.json() as { id: number };
      const item = (await app.get('requests')).items.find((i: { id: number }) => i.id === id);
      expect(item).toMatchObject({ fio: 'Мария Иванова' });
      expect((await db.query(`SELECT origin FROM requests WHERE id = $1`, [id])).rows[0]).toEqual({ origin: 'ui' });
      expect((await db.query(`SELECT actor FROM audit_log WHERE action = 'request.create'`)).rows).toEqual([{ actor: 'mbv_admin' }]);
    } finally { app.server.close(); }
  });

  test('созданная действующая группа появляется в справочнике с кодом, source=ui и ростком: дату открытия ставит база', async () => {
    const app = await startAdmin();
    try {
      const ok = await app.post('groups/create', { fields: { leader: 'Иван Петров', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует', people: '4' } });
      expect(ok.status).toBe(200);
      const { id } = await ok.json() as { id: number };
      const group = (await app.get('groups')).items.find((g: { id: number }) => g.id === id);
      expect(group).toMatchObject({ leader: 'Иван Петров', isNew: true, people: 4 });
      expect((await db.query(`SELECT source FROM groups WHERE id = $1`, [id])).rows[0]).toEqual({ source: 'ui' });
    } finally { app.server.close(); }
  });

  test('заявка создаётся со всеми полями старого дашборда: группа, служение, рекомендация, посещение, «Дополнительно»', async () => {
    const groupId = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Иван Петров', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
    const app = await startAdmin();
    try {
      const ok = await app.post('requests/create', { fields: {
        fio: 'Мария Иванова', type: 'join_group', status: 'На контроле', groupId: String(groupId), ministry: 'Колизей 13:00',
        recommended: 'Иван Петров', recommendedAt: '2026-09-01', finalGroup: 'Иван Петров', cancelReason: 'переехала',
        attendance: 'ходит', extra: 'из таблицы', source: 'Сайт церкви',
      } });
      expect(ok.status).toBe(200);
      const { id } = await ok.json() as { id: number };
      expect((await db.query(`SELECT status, group_id, ministry, recommended, recommended_at, final_group, cancel_reason, attendance, extra, source FROM requests WHERE id = $1`, [id])).rows[0]).toEqual({
        status: 'На контроле', group_id: groupId, ministry: 'Колизей 13:00', recommended: 'Иван Петров', recommended_at: '2026-09-01',
        final_group: 'Иван Петров', cancel_reason: 'переехала', attendance: 'ходит', extra: 'из таблицы', source: 'Сайт церкви',
      });
    } finally { app.server.close(); }
  });

  test('группа создаётся со всеми полями старого дашборда: состав через запятую, соведущий, приём новых, флажки', async () => {
    const app = await startAdmin();
    try {
      const ok = await app.post('groups/create', { fields: {
        leader: 'Иван Петров', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует',
        composition: 'Ментальная, Мужская', coLeader: 'Анна Петрова', coLeaderPhone: '8 921 000-11-44', openToNew: 'По требованию',
        training: 'Да', feedbackAt: '2026-09-10', no: '85', checked: '1', campaignRegistered: '1',
      } });
      expect(ok.status).toBe(200);
      const { id } = await ok.json() as { id: number };
      expect((await db.query(`SELECT composition, co_leader, co_leader_phone, open_to_new, training, feedback_at, no, checked, campaign_registered FROM groups WHERE id = $1`, [id])).rows[0]).toEqual({
        // Порядок — как в списке составов, а не как прислали.
        composition: 'Мужская, Ментальная', co_leader: 'Анна Петрова', co_leader_phone: '+79210001144', open_to_new: 'По требованию',
        training: 'Да', feedback_at: '2026-09-10', no: 85, checked: true, campaign_registered: true,
      });
    } finally { app.server.close(); }
  });

  test('правка заявки меняет поля из таблицы церкви, но не переносит их в регистрацию; плохая дата отклоняется', async () => {
    const userId = (await db.query<{ id: number }>(`INSERT INTO users (platform, platform_user_id, chat_id, full_name) VALUES ('telegram', '1', '1', 'Мария') RETURNING id`)).rows[0]!.id;
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (user_id, type, status, fio, note, extra, origin, responsible) VALUES ($1, 'join_group', 'Новая', 'Мария', 'звонить вечером', 'старое', 'таблица', 'Анна') RETURNING id`, [userId])).rows[0]!.id;
    const app = await startAdmin();
    try {
      const fields = { ministry: 'Колизей 13:00', recommended: 'Иван Петров', recommendedAt: '2026-09-01', attendance: 'ходит', extra: 'новое', source: 'Сайт' };
      expect((await app.post(`requests/${r}/edit`, { fields })).status).toBe(200);
      expect((await db.query(`SELECT ministry, recommended, recommended_at, attendance, extra, source, note, origin FROM requests WHERE id = $1`, [r])).rows[0]).toEqual({
        ministry: 'Колизей 13:00', recommended: 'Иван Петров', recommended_at: '2026-09-01',
        attendance: 'ходит', extra: 'новое', source: 'Сайт', note: 'звонить вечером', origin: 'ui',
      });
      const item = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      // В форму правки заметка и «Дополнительно» приходят порознь, хотя показываются вместе.
      expect(item.table).toEqual({ note: 'звонить вечером', finalGroup: null, ...fields });
      expect(item.log.map((l: { text: string }) => l.text)).toContain('Исправлено вручную: источник, служение, дополнительно, рекомендованная группа, дата рекомендации, контроль посещения · mbv_admin');
      // «Ходит в группу» правкой не меняется: куда человек ходит, задаёт утверждение в группу.
      expect((await app.post(`requests/${r}/edit`, { fields: { finalGroup: 'Иван Петров' } })).status).toBe(400);

      const bad = await app.post(`requests/${r}/edit`, { fields: { recommendedAt: '2026-02-31' } });
      expect(bad.status).toBe(400);
      expect((await bad.json() as { message: string }).message).toContain('Дата рекомендации');
    } finally { app.server.close(); }
  });

  test.each([
    [{ leader: 'Х', district: 'Нет такого', direction: 'Основное служение', status: 'Функционирует' }, 'район'],
    [{ leader: 'Х', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует', people: '500' }, 'Число человек'],
  ])('группа с плохими полями %j отклоняется (%s)', async (fields, fragment) => {
    const app = await startAdmin();
    try {
      const r = await app.post('groups/create', { fields });
      expect(r.status).toBe(400);
      expect((await r.json() as { message: string }).message).toContain(fragment);
    } finally { app.server.close(); }
  });

  test('тело не из строк и слишком длинные значения отклоняются', async () => {
    const app = await startAdmin();
    try {
      expect((await app.post('requests/create', { fields: { fio: 5 } })).status).toBe(400);
      expect((await app.post('requests/create', { fields: { fio: 'я'.repeat(4001) } })).status).toBe(400);
      expect((await app.post('requests/create', { nofields: 1 })).status).toBe(400);
    } finally { app.server.close(); }
  });

  test('справочники форм берутся с сервера, координаторы — из базы', async () => {
    await seedCoordinator(db, 'Анна Координатор', ['Координатор']);
    const app = await startAdmin();
    try {
      const meta = await app.get('form-meta');
      expect(meta.districts).toContain('Приморский');
      expect(meta.requestTypes.map((t: { value: string }) => t.value)).toContain('join_group');
      expect(meta.coordinators).toEqual(['Анна Координатор']);
      expect(meta.ageGroups).toContain('25-40');
      expect(meta.openToNew.map((o: { value: string }) => o.value)).toEqual(['ДА', 'НЕТ', 'По требованию']);
    } finally { app.server.close(); }
  });

  test('то, что вводят при создании, видно в карточках: у человека церковь, ведущий и способ связи, у группы — телефон соведущего', async () => {
    await db.query(
      `INSERT INTO users (platform, platform_user_id, chat_id, full_name, church, mdg_status, leader_name, preferred_contact, registration_no, complete)
       VALUES ('telegram', '7', '7', 'Ирина Состоит', 'МБВ Колизей', 'member', 'Иван Петров', 'call', 4321, true)`);
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, co_leader, co_leader_phone, source) VALUES ('Иван Петров', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'Анна', '+79210001144', 'ui')`);
    const app = await startAdmin();
    try {
      const person = (await app.get('people')).items.find((p: { fio: string }) => p.fio === 'Ирина Состоит');
      expect(person).toMatchObject({ church: 'МБВ Колизей', leaderName: 'Иван Петров', preferredContact: 'звонок' });
      const group = (await app.get('groups')).items.find((g: { leader: string }) => g.leader === 'Иван Петров');
      expect(group).toMatchObject({ coLeader: 'Анна', coLeaderPhone: '+7 921 000-11-44' });
    } finally { app.server.close(); }
  });

  test('справочники форм отдают действующие группы, а не кандидатов в ведущие: ведущего ищут по всем «Людям»', async () => {
    const groupId = (await db.query<{ id: number }>(`INSERT INTO groups (leader, district, direction_id, status, source) VALUES ('Иван Петров', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'ui') RETURNING id`)).rows[0]!.id;
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, source, archived_at) VALUES ('Убранная', 'Приморский', group_direction_id('Основная церковь'), 'Закрыта', 'ui', now())`);
    const app = await startAdmin();
    try {
      const meta = await app.get('form-meta');
      expect(meta.groups).toEqual([{ id: groupId, code: expect.stringMatching(/^ДГ-/), leader: 'Иван Петров' }]);
      expect(meta).not.toHaveProperty('leaderCandidates');
    } finally { app.server.close(); }
  });

  test('улица и время, поправленные координатором, пишутся человеку, меняют понимание заявки сразу и видны в ленте без текста улицы', async () => {
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, people, source) VALUES ('Иван', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui')`);
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, place, origin, responsible) VALUES ('join_group', 'Новая', 'Мария', 'Приморский', 'ui', 'Анна') RETURNING id`)).rows[0]!.id;
    const app = await startAdmin();
    try {
      const before = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      expect(before).toMatchObject({ days: [], slot: null, street: null, scheduleInfo: { source: null } });
      const saved = await app.post(`requests/${r}/params`, { street: 'ул. Рылеева 32', schedule: 'пн, ср вечером' });
      expect(saved.status).toBe(200);
      const after = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      // Улица и время — данные человека (миграция 057): правка пишет в его запись, отдельного слоя «правки координатора» нет.
      expect(after).toMatchObject({ days: ['Пн', 'Ср'], slot: 'вечер', street: 'ул. Рылеева 32', scheduleInfo: { source: 'anketa' }, streetInfo: { source: 'anketa' } });
      expect(after.log.map((l: { text: string }) => l.text)).toContain('Уточнено вручную: улица, удобное время · mbv_admin');
      expect(JSON.stringify(after.log)).not.toContain('Рылеева');
      // «Убрать правку» возвращает пустое.
      await app.post(`requests/${r}/params`, { street: null, schedule: '' });
      const cleared = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      expect(cleared).toMatchObject({ days: [], slot: null, street: null, streetInfo: { source: null } });
    } finally { app.server.close(); }
  });

  test('правка заявки, «в работе у» и итог звонка видны в ленте и меняют заявку; журнал без значений', async () => {
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, phone, place, origin, responsible) VALUES ('join_group', 'Новая', 'Мария', '+79110001122', 'Приморский', 'ui', 'Анна') RETURNING id`)).rows[0]!.id;
    const app = await startAdmin();
    try {
      expect((await app.post(`requests/${r}/edit`, { phone: '8 921 555-00-11', age: '36-45' })).status).toBe(200);
      expect((await app.post(`requests/${r}/assign`, { responsible: 'Анна Смирнова' })).status).toBe(200);
      expect((await app.post(`requests/${r}/call`, { result: 'no_answer', comment: 'занято' })).status).toBe(200);
      const item = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      expect(item).toMatchObject({ phone: '+7 921 555-00-11', ageLabel: '36-45', responsible: 'Анна Смирнова', callback: true });
      const texts = item.log.map((l: { text: string }) => l.text);
      expect(texts).toContain('Исправлено вручную: телефон, возраст · mbv_admin');
      expect(texts).toContain('В работе у: Анна Смирнова · mbv_admin');
      expect(texts).toContain('Звонок: не дозвонились («занято») · mbv_admin');
      expect(JSON.stringify(item.log)).not.toContain('921');
    } finally { app.server.close(); }
  });

  test('плохие тела edit/assign/call отвечают 400 и ничего не меняют', async () => {
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, origin, responsible) VALUES ('join_group', 'Новая', 'Мария', 'ui', 'Анна') RETURNING id`)).rows[0]!.id;
    const app = await startAdmin();
    try {
      for (const [path, body] of [
        ['edit', {}], ['edit', { phone: 5 }], ['edit', { phone: 'позвонить маме' }], ['assign', {}], ['assign', { responsible: 7 }],
        ['call', {}], ['call', { result: 'потом' }], ['call', { result: 'reached', comment: 5 }],
      ] as const) {
        expect((await app.post(`requests/${r}/${path}`, body)).status, `${path} ${JSON.stringify(body)}`).toBe(400);
      }
      expect((await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
    } finally { app.server.close(); }
  });

  test('после правки района закреплённое предложение помечается «данные изменились»', async () => {
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, people, source) VALUES ('Иван', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui')`);
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, place, age, origin, responsible) VALUES ('join_group', 'Новая', 'Мария', 'Приморский', '30', 'ui', 'Анна') RETURNING id`)).rows[0]!.id;
    const app = await startAdmin();
    try {
      await app.post('matching/run', {});
      const pinned = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      expect(pinned.proposal).toMatchObject({ saved: true, dataChanged: false });
      await app.post(`requests/${r}/edit`, { place: 'Выборгский' });
      const after = (await app.get('requests')).items.find((i: { id: number }) => i.id === r);
      expect(after.proposal?.saved ?? false).toBe(false);
      expect(after.proposal?.dataChanged ?? true).toBe(true);
    } finally { app.server.close(); }
  });

  test('«закреплено»: после запуска подбора предложение помечено закреплённым, счётчики сходятся', async () => {
    await db.query(`INSERT INTO groups (leader, district, direction_id, status, people, source) VALUES ('Иван', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, 'ui')`);
    await db.query(`INSERT INTO requests (type, status, fio, place, age, origin) VALUES ('join_group', 'Новая', 'Мария', 'Приморский', '30', 'ui')`);
    const app = await startAdmin();
    try {
      const before = await app.get('requests');
      expect(before.matching).toMatchObject({ waiting: 1, saved: 0 });
      expect(before.items[0].proposal.saved).toBe(false);
      expect((await app.post('matching/run', {})).status).toBe(200);
      const after = await app.get('requests');
      expect(after.matching).toMatchObject({ waiting: 0, saved: 1 });
      expect(after.items[0].proposal.saved).toBe(true);
    } finally { app.server.close(); }
  });
});
