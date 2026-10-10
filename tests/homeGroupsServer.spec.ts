import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHomeGroupsServer } from '../src/home-groups/server.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { buildViews } from '../src/home-groups/api/views.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import type { ActionOutcome } from '../src/db/repos/placement.repo.js';

/**
 * HTTP-слой сервиса «Домашние группы» на хранилище сессий в памяти: вход и выход, куки,
 * заголовки безопасности, JSON API без сессии и со статикой собранного интерфейса.
 */

const REGULAR = { login: 'mbv_admin', password: 'обычный-пароль' };
const SUPER = { login: 'super_mbv_admin', password: 'супер-пароль-123' };
const INDEX_MARKER = 'ИНТЕРФЕЙС-ДОМАШНИХ-ГРУПП';
const SECRET = 'СЕКРЕТ-ВНЕ-КАТАЛОГА-ИНТЕРФЕЙСА';

function memoryStore(): SessionStore {
  const data = new Map<string, string>();
  return {
    async set(k, v) { data.set(k, v); },
    async get(k) { return data.get(k) ?? null; },
    async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
}

const { engine } = createFakeEngine();
const sampleViews = () => buildViews({
  groups: [], requests: [], participants: [], coordinators: [{ id: 1, name: 'Анна', role: 'Координатор', source: 'ui' }],
}, engine, new Date('2026-10-10T09:00:00Z'));

let root: string;
let ipCounter = 0;
const nextIp = () => `10.2.0.${++ipCounter}`;

interface ActionCall { name: string; id: number; body: unknown; actor: string }
interface Started {
  base: string; viewsCalls: () => number; close: () => void; setViews: (f: () => Promise<ReturnType<typeof sampleViews>>) => void;
  actionCalls: ActionCall[]; invalidations: () => number; setOutcome: (o: ActionOutcome) => void;
  matchingCalls: { name: string; actor: string; enabled?: boolean }[];
}

async function start(opts: { secureCookie?: boolean; webDir?: string; maxAttempts?: number } = {}): Promise<Started> {
  let calls = 0;
  let invalidations = 0;
  let outcome: ActionOutcome = { ok: true };
  const actionCalls: ActionCall[] = [];
  const matchingCalls: { name: string; actor: string; enabled?: boolean }[] = [];
  const record = (name: string) => async (id: number, body: unknown, actor: string): Promise<ActionOutcome> => {
    actionCalls.push({ name, id, body, actor });
    return outcome;
  };
  let views: () => Promise<ReturnType<typeof sampleViews>> = async () => sampleViews();
  const server = createHomeGroupsServer({
    actions: { approve: record('approve'), reject: record('reject'), setNeedCall: record('need-call') },
    matching: {
      run: async (actor) => { matchingCalls.push({ name: 'run', actor }); return { ok: true, created: 2, replaced: 1, unchanged: 3 }; },
      setAuto: async (enabled, actor) => { matchingCalls.push({ name: 'auto', actor, enabled }); },
    },
    invalidateViews: () => { invalidations += 1; },
    actorName: (role) => (role === 'super' ? SUPER.login : REGULAR.login),
    auth: new SessionService(memoryStore(), {
      password: REGULAR.password, login: REGULAR.login, superPassword: SUPER.password, superLogin: SUPER.login,
      ttlSeconds: 600, maxAttempts: opts.maxAttempts ?? 50,
    }),
    views: () => { calls += 1; return views(); },
    sessionTtlSeconds: 600,
    secureCookie: opts.secureCookie ?? false,
    webDir: opts.webDir ?? join(root, 'web-dist'),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    viewsCalls: () => calls,
    close: () => { server.close(); },
    setViews: (f) => { views = f; },
    actionCalls, matchingCalls, invalidations: () => invalidations, setOutcome: (o) => { outcome = o; },
  };
}

let app: Started;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'hg-web-'));
  const web = join(root, 'web-dist');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), `<!doctype html><title>x</title><div id="root">${INDEX_MARKER}</div>`);
  writeFileSync(join(web, 'assets', 'app.abc123.js'), 'console.log("app");');
  writeFileSync(join(web, 'assets', 'app.abc123.css'), 'body{margin:0}');
  writeFileSync(join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  // Лежит рядом с каталогом интерфейса, а не внутри: до него можно добраться только через «..».
  writeFileSync(join(root, 'secret.txt'), SECRET);
  app = await start();
});
afterAll(() => { app.close(); });

const post = (base: string, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp(), ...headers },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });

async function signIn(creds = REGULAR, base = app.base): Promise<string> {
  const r = await post(base, '/login', { login: creds.login, password: creds.password });
  expect(r.status).toBe(302);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

/** Сырой запрос: fetch сам «схлопывает» «..» в адресе, а проверить нужно именно то, что дошло до сервера. */
function raw(base: string, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const u = new URL(base);
    const req = httpRequest({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const API_ROUTES = ['me', 'today', 'requests', 'groups', 'people', 'coordinators'];

describe('вход и выход', () => {
  test('страница входа отдаётся без сессии, по-русски, без подсказки логина', async () => {
    const r = await fetch(`${app.base}/login`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('lang="ru"');
    expect(html).toContain('name="login"');
    expect(html).toContain('name="password"');
    expect(html).toContain('Войти');
    expect(html).not.toContain(REGULAR.login);
    expect(html).not.toContain(SUPER.login);
  });

  test('верный пароль: переход на корень и кука сессии с нужными атрибутами', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: REGULAR.password });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^mbv_sid=[A-Za-z0-9_-]{20,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Path=/groups');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain('Secure');
  });

  test('с настройкой «Secure» кука помечается защищённой', async () => {
    const secure = await start({ secureCookie: true });
    try {
      const r = await post(secure.base, '/login', { login: REGULAR.login, password: REGULAR.password });
      expect(r.headers.get('set-cookie')).toContain('; Secure');
    } finally { secure.close(); }
  });

  test('неверный пароль: страница входа с сообщением и без куки', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: 'мимо' });
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
    const html = await r.text();
    expect(html).toContain('Неверный логин или пароль');
    expect(html).toContain('name="password"');
  });

  test('верный пароль от чужого логина не пускает', async () => {
    const r = await post(app.base, '/login', { login: 'кто-то', password: REGULAR.password });
    expect(r.status).toBe(401);
  });

  test('пустой пароль не пускает', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: '' });
    expect(r.status).toBe(401);
  });

  test('перебор пароля блокирует адрес на 429, даже когда потом введён верный', async () => {
    const locked = await start({ maxAttempts: 3 });
    try {
      const ip = { 'x-real-ip': '10.9.9.9' };
      for (let i = 0; i < 3; i += 1) {
        expect((await post(locked.base, '/login', { login: REGULAR.login, password: 'мимо' }, ip)).status).toBe(401);
      }
      const blocked = await post(locked.base, '/login', { login: REGULAR.login, password: REGULAR.password }, ip);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('set-cookie')).toBeNull();
      expect(await blocked.text()).toContain('Слишком много попыток');
      // Другой адрес не блокируется.
      expect((await post(locked.base, '/login', { login: REGULAR.login, password: REGULAR.password }, { 'x-real-ip': '10.9.9.8' })).status).toBe(302);
    } finally { locked.close(); }
  });

  test('слишком большое тело формы отклоняется кодом 413', async () => {
    const r = await post(app.base, '/login', { login: 'a', password: 'я'.repeat(40_000) });
    expect(r.status).toBe(413);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  test('тело чуть меньше лимита читается', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: 'x'.repeat(60_000) });
    expect(r.status).toBe(401);
  });

  test('не форма (другой тип содержимого) не принимается', async () => {
    const r = await fetch(`${app.base}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': nextIp() },
      body: JSON.stringify({ login: REGULAR.login, password: REGULAR.password }), redirect: 'manual',
    });
    expect(r.status).toBe(415);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  test('текст ошибки на странице входа экранируется', async () => {
    const { homeGroupsLoginPage } = await import('../src/home-groups/loginPage.js');
    expect(homeGroupsLoginPage('<script>alert(1)</script>')).not.toContain('<script>');
  });

  test('вход со сверхправами: роль super', async () => {
    const cookie = await signIn(SUPER);
    const me = await (await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).json();
    expect(me).toEqual({ role: 'super' });
  });

  test('выход — только POST: сессия гаснет, кука стирается, переход на вход', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login');
    expect(r.headers.get('set-cookie')).toMatch(/^mbv_sid=;.*Max-Age=0/);

    const after = await fetch(`${app.base}/api/v1/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  test('GET /logout не выходит: 404, а сессия остаётся живой', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/logout`, { headers: { cookie }, redirect: 'manual' });
    expect(r.status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
  });

  test('кука старого дашборда (hg_sid) сессией этого сервиса не считается', async () => {
    const cookie = (await signIn()).replace('mbv_sid=', 'hg_sid=');
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(401);
  });
});

describe('JSON API', () => {
  test.each(API_ROUTES)('/api/v1/%s без сессии отвечает 401 JSON', async (name) => {
    const r = await fetch(`${app.base}/api/v1/${name}`);
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual({ error: 'unauthorized' });
  });

  test('без сессии данные не загружаются вовсе', async () => {
    const fresh = await start();
    try {
      for (const name of API_ROUTES) await fetch(`${fresh.base}/api/v1/${name}`);
      expect(fresh.viewsCalls()).toBe(0);
    } finally { fresh.close(); }
  });

  test('с сессией /me отдаёт роль', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/api/v1/me`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ role: 'admin' });
  });

  test.each([
    ['today', 'counters'], ['requests', 'items'], ['groups', 'items'], ['people', 'items'], ['coordinators', 'items'],
  ])('с сессией /%s отдаёт своё представление', async (name, field) => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/api/v1/${name}`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty(field);
    expect(body).toHaveProperty('generatedAt');
  });

  test('координаторы приходят из представления', async () => {
    const cookie = await signIn();
    const body = await (await fetch(`${app.base}/api/v1/coordinators`, { headers: { cookie } })).json() as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(['Анна']);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s к API — 404 и с сессией, и без неё', async (method) => {
    const cookie = await signIn();
    const before = app.viewsCalls();
    for (const headers of [{}, { cookie }]) {
      for (const name of API_ROUTES) {
        const r = await fetch(`${app.base}/api/v1/${name}`, { method, headers });
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({ error: 'not_found' });
      }
    }
    expect(app.viewsCalls()).toBe(before);
  });

  test('неизвестный путь под /api — 404 JSON', async () => {
    const cookie = await signIn();
    for (const path of ['/api', '/api/', '/api/v1', '/api/v1/nope', '/api/v2/today', '/api/v1/today/extra', '/api/v1/constructor']) {
      const r = await fetch(`${app.base}${path}`, { headers: { cookie } });
      expect(r.status, path).toBe(404);
      expect(r.headers.get('content-type')).toContain('application/json');
    }
  });

  test('ошибка расчёта: клиенту 500 JSON без внутренностей', async () => {
    const broken = await start();
    try {
      broken.setViews(async () => { throw new Error('connection to 10.0.0.5:5432 refused, пароль=hunter2'); });
      const cookie = await signIn(REGULAR, broken.base);
      const r = await fetch(`${broken.base}/api/v1/today`, { headers: { cookie } });
      expect(r.status).toBe(500);
      const text = await r.text();
      expect(JSON.parse(text)).toEqual({ error: 'internal' });
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('5432');
    } finally { broken.close(); }
  });
});

describe('заголовки безопасности', () => {
  const expectBase = (r: Response) => {
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  };

  test('страница входа', async () => {
    const r = await fetch(`${app.base}/login`);
    expectBase(r);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toBeTruthy();
  });

  test('JSON API', async () => {
    const cookie = await signIn();
    for (const r of [
      await fetch(`${app.base}/api/v1/today`, { headers: { cookie } }),
      await fetch(`${app.base}/api/v1/today`),
      await fetch(`${app.base}/api/v1/nope`, { headers: { cookie } }),
    ]) {
      expectBase(r);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('страница интерфейса и переходы', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/`, { headers: { cookie } });
    expectBase(r);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const redirected = await fetch(`${app.base}/`, { redirect: 'manual' });
    expectBase(redirected);
  });

  test('политика содержимого: только свои источники, ничего внешнего', async () => {
    const csp = (await fetch(`${app.base}/login`)).headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:|\*/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  test('статика: запрет угадывать тип и индексацию', async () => {
    const r = await fetch(`${app.base}/assets/app.abc123.js`);
    expectBase(r);
  });
});

describe('интерфейс и статика', () => {
  test('без сессии корень и любые адреса страниц ведут на вход', async () => {
    for (const path of ['/', '/today', '/requests/42', '/reference/groups']) {
      const r = await fetch(`${app.base}${path}`, { redirect: 'manual' });
      expect(r.status, path).toBe(302);
      expect(r.headers.get('location')).toBe('/login');
      expect(await r.text()).not.toContain(INDEX_MARKER);
    }
  });

  test('с сессией корень отдаёт index.html без кэша и с политикой содержимого', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await r.text()).toContain(INDEX_MARKER);
  });

  test('адреса экранов интерфейса (без расширения) тоже отдают index.html — маршруты рисует интерфейс', async () => {
    const cookie = await signIn();
    for (const path of ['/today', '/requests/42', '/reference/groups?view=1']) {
      const r = await fetch(`${app.base}${path}`, { headers: { cookie } });
      expect(r.status, path).toBe(200);
      expect(await r.text()).toContain(INDEX_MARKER);
    }
  });

  test('index.html напрямую не отдаётся: ни по имени, ни без сессии', async () => {
    const cookie = await signIn();
    for (const headers of [{}, { cookie }]) {
      const r = await fetch(`${app.base}/index.html`, { headers });
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain(INDEX_MARKER);
    }
  });

  test('собранные файлы отдаются без сессии, с вечным кэшем и верным типом', async () => {
    const js = await fetch(`${app.base}/assets/app.abc123.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toContain('console.log');

    const css = await fetch(`${app.base}/assets/app.abc123.css`);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(css.headers.get('cache-control')).toContain('immutable');
  });

  test('нет такого файла в assets: 404 без вечного кэша, а не index.html', async () => {
    const r = await fetch(`${app.base}/assets/нет.js`);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).not.toContain(INDEX_MARKER);
  });

  test('каталог вместо файла и «файл как каталог» — 404', async () => {
    for (const path of ['/assets/', '/assets/app.abc123.js/x', '/assets']) {
      const r = await fetch(`${app.base}${path}`, { redirect: 'manual' });
      expect([302, 404], path).toContain(r.status);
    }
  });

  test('значок сайта в корне отдаётся без сессии, но с коротким кэшем', async () => {
    const r = await fetch(`${app.base}/favicon.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  test('неизвестное расширение не отдаётся: сервер не раздаёт всё подряд', async () => {
    writeFileSync(join(root, 'web-dist', 'assets', 'config.env'), 'X=1');
    const r = await fetch(`${app.base}/assets/config.env`);
    expect(r.status).toBe(404);
  });

  test.each([
    '/assets/../secret.txt',
    '/assets/%2e%2e/secret.txt',
    '/assets/%2E%2E/secret.txt',
    '/assets/..%2fsecret.txt',
    '/assets/%2e%2e%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/../secret.txt',
    '/assets/..%5csecret.txt',
    '/assets/%5c..%5csecret.txt',
    '/assets/..%00/secret.txt',
    '/assets/%00.js',
    '/assets/%',
    '//assets/../../secret.txt',
  ])('выход за каталог интерфейса через %s невозможен', async (path) => {
    const r = await raw(app.base, path);
    expect(r.body).not.toContain(SECRET);
    expect(r.status).not.toBe(200);
  });

  test('кодированный обход не срабатывает и для файлов вне assets, с сессией', async () => {
    const cookie = await signIn();
    const r = await raw(app.base, '/%2e%2e/secret.txt', 'GET', { cookie });
    expect(r.body).not.toContain(SECRET);
  });

  test('интерфейс не собран: файлы — 503 «не собран», страницы для своих — тоже, для чужих — вход', async () => {
    const missing = await start({ webDir: join(root, 'нет-такого-каталога') });
    try {
      const cookie = await signIn(REGULAR, missing.base);
      const asset = await fetch(`${missing.base}/assets/app.js`);
      expect(asset.status).toBe(503);
      expect(await asset.text()).toContain('Интерфейс не собран');

      const page = await fetch(`${missing.base}/`, { headers: { cookie } });
      expect(page.status).toBe(503);
      expect(await page.text()).toContain('Интерфейс не собран');

      const anon = await fetch(`${missing.base}/`, { redirect: 'manual' });
      expect(anon.status).toBe(302);
      // API и вход работают и без интерфейса.
      expect((await fetch(`${missing.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
    } finally { missing.close(); }
  });

  test('каталог есть, а index.html нет: тоже «не собран»', async () => {
    const empty = join(root, 'empty-dist');
    mkdirSync(empty, { recursive: true });
    const half = await start({ webDir: empty });
    try {
      const cookie = await signIn(REGULAR, half.base);
      const page = await fetch(`${half.base}/`, { headers: { cookie } });
      expect(page.status).toBe(503);
      expect(await page.text()).toContain('Интерфейс не собран');
      expect((await fetch(`${half.base}/assets/нет.js`)).status).toBe(404);
    } finally { half.close(); }
  });
});

describe('никаких изменений через GET и чужие методы', () => {
  test('здоровье сервиса: ok без сессии, и только на чтение', async () => {
    const r = await fetch(`${app.base}/health`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
    expect((await fetch(`${app.base}/health`, { method: 'POST' })).status).toBe(404);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s на страницы и статику — 404', async (method) => {
    const cookie = await signIn();
    for (const path of ['/', '/today', '/assets/app.abc123.js', '/favicon.svg', '/anything']) {
      const r = await fetch(`${app.base}${path}`, { method, headers: { cookie }, redirect: 'manual' });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  test('обход всех чтений подряд ничего не разлогинивает и не создаёт', async () => {
    const cookie = await signIn();
    for (const name of API_ROUTES) await fetch(`${app.base}/api/v1/${name}`, { headers: { cookie } });
    await fetch(`${app.base}/`, { headers: { cookie } });
    await fetch(`${app.base}/logout`, { headers: { cookie } });
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
  });
});


describe('действия координатора над заявкой', () => {
  const act = (cookie: string | null, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/requests/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('без сессии действие не выполняется: 401 и ничего не вызвано', async () => {
    const before = app.actionCalls.length;
    const r = await act(null, '5/approve', { groupId: 1 });
    expect(r.status).toBe(401);
    expect(app.actionCalls.length).toBe(before);
  });

  test.each([['approve', { groupId: 3, force: true }], ['reject', { groupId: 3, reason: 'far' }], ['need-call', { value: true }]])(
    '%s передаёт заявку, тело и автора (логин входа) и сбрасывает снимок',
    async (name, body) => {
      const cookie = await signIn(SUPER);
      const calls = app.actionCalls.length;
      const inv = app.invalidations();
      const r = await act(cookie, `42/${name}`, body);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
      expect(app.actionCalls.slice(calls)).toEqual([{ name, id: 42, body, actor: SUPER.login }]);
      expect(app.invalidations()).toBe(inv + 1);
    },
  );

  test('обычный вход пишется в журнал под своим логином', async () => {
    const cookie = await signIn(REGULAR);
    await act(cookie, '7/need-call', { value: false });
    expect(app.actionCalls.at(-1)!.actor).toBe(REGULAR.login);
  });

  test.each([
    ['bad_request', 400], ['not_found', 404], ['already_closed', 409], ['group_unavailable', 409], ['group_full', 409],
  ] as const)('ошибка %s отвечает кодом %i и текстом, снимок не сбрасывается', async (error, status) => {
    const cookie = await signIn();
    app.setOutcome({ ok: false, error, message: 'Пояснение.' });
    const inv = app.invalidations();
    try {
      const r = await act(cookie, '1/approve', { groupId: 1 });
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error, message: 'Пояснение.' });
      expect(app.invalidations()).toBe(inv);
    } finally {
      app.setOutcome({ ok: true });
    }
  });

  test('форма с другого сайта (не JSON) отклоняется: 415 и ничего не вызвано', async () => {
    const cookie = await signIn();
    const before = app.actionCalls.length;
    const r = await act(cookie, '1/approve', 'groupId=1', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
    expect(app.actionCalls.length).toBe(before);
  });

  test('сломанный JSON — 400, слишком большое тело — 413', async () => {
    const cookie = await signIn();
    expect((await act(cookie, '1/approve', '{не json')).status).toBe(400);
    expect((await act(cookie, '1/approve', JSON.stringify({ groupId: 1, pad: 'я'.repeat(40_000) }))).status).toBe(413);
  });

  test('чужие адреса действий — 404, а GET по адресу действия не выполняет его', async () => {
    const cookie = await signIn();
    const before = app.actionCalls.length;
    for (const path of ['abc/approve', '1/delete', '1/approve/extra', '1']) {
      expect((await act(cookie, path, { groupId: 1 })).status, path).toBe(404);
    }
    const g = await fetch(`${app.base}/api/v1/requests/1/approve`, { headers: { cookie } });
    expect(g.status).toBe(404);
    expect(app.actionCalls.length).toBe(before);
  });
});


describe('подбор для новых заявок', () => {
  const call = (cookie: string | null, name: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/matching/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('без сессии подбор не запускается', async () => {
    const before = app.matchingCalls.length;
    expect((await call(null, 'run', {})).status).toBe(401);
    expect((await call(null, 'auto', { enabled: true })).status).toBe(401);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('запуск доступен обычному входу и отвечает итогом; автор — логин входа', async () => {
    const cookie = await signIn(REGULAR);
    const r = await call(cookie, 'run', {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, created: 2, replaced: 1, unchanged: 3 });
    expect(app.matchingCalls.at(-1)).toEqual({ name: 'run', actor: REGULAR.login });
  });

  test('автоматический режим обычному входу недоступен: 403 и ничего не вызвано', async () => {
    const cookie = await signIn(REGULAR);
    const before = app.matchingCalls.length;
    const r = await call(cookie, 'auto', { enabled: true });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: 'forbidden' });
    expect(app.matchingCalls.length).toBe(before);
  });

  test.each([true, false])('полный вход переключает автоматический режим (%s)', async (enabled) => {
    const cookie = await signIn(SUPER);
    const r = await call(cookie, 'auto', { enabled });
    expect(r.status).toBe(200);
    expect(app.matchingCalls.at(-1)).toEqual({ name: 'auto', actor: SUPER.login, enabled });
  });

  test.each([{}, { enabled: 'да' }, { enabled: 1 }, null, []])('переключатель с телом %j — 400', async (body) => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    expect((await call(cookie, 'auto', body)).status).toBe(400);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('форма с другого сайта (не JSON) отклоняется: 415', async () => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    const r = await call(cookie, 'run', 'x=1', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('чужие адреса — 404, GET по адресу подбора его не запускает', async () => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    expect((await call(cookie, 'other', {})).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/matching/run`, { headers: { cookie } })).status).toBe(404);
    expect(app.matchingCalls.length).toBe(before);
  });
});
