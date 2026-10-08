import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDashboardServer } from '../src/dashboard/server.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';

/**
 * Два входа: super_mbv_admin может всё, включая удаление, mbv_admin — всё, кроме удаления.
 * Запрет проверяется на сервере: спрятанной в странице кнопки мало, запрос можно послать и руками.
 */
const REGULAR = { login: 'mbv_admin', password: 'обычный-пароль' };
const SUPER = { login: 'super_mbv_admin', password: 'супер-пароль-123' };

function memoryStore(): SessionStore {
  const data = new Map<string, string>();
  return {
    async set(k, v) { data.set(k, v); },
    async get(k) { return data.get(k) ?? null; },
    async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
}

let base: string;
let server: ReturnType<typeof createDashboardServer>;
const calls: string[] = [];
let ipCounter = 0;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hg-roles-'));
  const htmlPath = join(dir, 'home-groups.html');
  writeFileSync(htmlPath, '<h1>страница</h1>\n<script>\nconst DATA = {};\n</script>');
  server = createDashboardServer({
    auth: new SessionService(memoryStore(), {
      password: REGULAR.password, login: REGULAR.login,
      superPassword: SUPER.password, superLogin: SUPER.login,
      ttlSeconds: 600, maxAttempts: 50,
    }),
    htmlPath,
    sessionTtlSeconds: 600,
    secureCookie: false,
    data: async () => ({ groups: [], requests: [], coordinators: [] }),
    deleteGroup: async (id) => { calls.push(`group:${id}`); return true; },
    deleteRequest: async (id) => { calls.push(`request:${id}`); return true; },
    deleteCoordinator: async (id) => { calls.push(`coordinator:${id}`); return true; },
    deleteRegistration: async (id) => { calls.push(`registration:${id}`); return true; },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/groups`;
});
afterAll(() => { server.close(); });

const login = (fields: Record<string, string>) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': `10.1.0.${++ipCounter}` },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });

const sessionOf = async (who: { login: string; password: string }) =>
  (await login({ login: who.login, password: who.password })).headers.get('set-cookie')!.split(';')[0]!;

const DELETES: [string, string][] = [
  ['/group/delete', 'group'], ['/leader/delete', 'group'], ['/request/delete', 'request'],
  ['/coordinator/delete', 'coordinator'],
];

describe('вход по логину и паролю', () => {
  test('оба аккаунта входят со своим логином', async () => {
    expect((await login({ login: REGULAR.login, password: REGULAR.password })).status).toBe(303);
    expect((await login({ login: SUPER.login, password: SUPER.password })).status).toBe(303);
  });

  test('пароль одного с логином другого не пускает', async () => {
    expect((await login({ login: SUPER.login, password: REGULAR.password })).status).toBe(401);
    expect((await login({ login: REGULAR.login, password: SUPER.password })).status).toBe(401);
  });

  test('чужой логин и пустой логин не пускают', async () => {
    expect((await login({ login: 'admin', password: REGULAR.password })).status).toBe(401);
    expect((await login({ login: '', password: REGULAR.password })).status).toBe(401);
  });

  test('на странице входа есть поле логина', async () => {
    expect(await (await fetch(base)).text()).toContain('name="login"');
  });
});

describe('удаление только у super_mbv_admin', () => {
  test.each(DELETES)('%s: обычный вход получает 403, ничего не удаляется', async (path) => {
    calls.length = 0;
    const cookie = await sessionOf(REGULAR);
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ id: '7' }),
    });
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test.each(DELETES)('%s: super_mbv_admin удаляет', async (path, kind) => {
    calls.length = 0;
    const cookie = await sessionOf(SUPER);
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ id: '7' }),
    });
    expect(r.status).toBe(200);
    expect(calls).toEqual([`${kind}:7`]);
  });

  test('удаление регистрации тоже закрыто для обычного входа', async () => {
    calls.length = 0;
    const origin = base.replace('/groups', '/registration');
    const reg = async (who: typeof REGULAR) => {
      const r = await fetch(`${origin}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': `10.2.0.${++ipCounter}` },
        body: new URLSearchParams({ login: who.login, password: who.password }), redirect: 'manual',
      });
      return r.headers.get('set-cookie')!.split(';')[0]!;
    };
    const del = (cookie: string) => fetch(`${origin}/delete`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ id: '5' }),
    });
    expect((await del(await reg(REGULAR))).status).toBe(403);
    expect(calls).toEqual([]);
    expect((await del(await reg(SUPER))).status).toBe(200);
    expect(calls).toEqual(['registration:5']);
  });

  test('без сессии по-прежнему 401, а не 403', async () => {
    const r = await fetch(`${base}/group/delete`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id: '7' }),
    });
    expect(r.status).toBe(401);
  });

  test('остальные действия обычному входу доступны: страница открывается', async () => {
    const html = await (await fetch(base, { headers: { cookie: await sessionOf(REGULAR) } })).text();
    expect(html).toContain('страница');
    expect(html).toContain('window.HG_CAN_DELETE = false');
  });

  test('super_mbv_admin страница сообщает, что удалять можно', async () => {
    const html = await (await fetch(base, { headers: { cookie: await sessionOf(SUPER) } })).text();
    expect(html).toContain('window.HG_CAN_DELETE = true');
  });
});
