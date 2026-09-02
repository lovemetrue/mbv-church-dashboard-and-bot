import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDashboardServer } from '../src/dashboard/server.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';

const MARKER = 'СЕКРЕТНЫЙ-ДАШБОРД-116-ГРУПП';
let base: string;
let live: unknown = [];
let liveRequests: Record<string, unknown>[] = [];
let liveCoordinators: Record<string, unknown>[] = [];
let deleted: number[] = [];
let deleteResult = true;
let createdGroups: unknown[] = [];
let createdRequests: unknown[] = [];
let exportRows = 'номер,фио\n1,Иванов\n';
let server: ReturnType<typeof createDashboardServer>;

function memoryStore(): SessionStore {
  const data = new Map<string, string>();
  return {
    async set(k, v) { data.set(k, v); },
    async get(k) { return data.get(k) ?? null; },
    async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hg-'));
  const htmlPath = join(dir, 'home-groups.html');
  writeFileSync(htmlPath, `<h1>${MARKER}</h1>\n<script>\nconst DATA = {"groups":[]};\n</script>`);

  server = createDashboardServer({
    auth: new SessionService(memoryStore(), { password: 'очень-секретно', ttlSeconds: 600, maxAttempts: 5 }),
    htmlPath,
    sessionTtlSeconds: 600,
    secureCookie: false,
    data: async () => {
      if (live === 'boom') throw new Error('база недоступна');
      return { groups: live as Record<string, unknown>[], requests: liveRequests, coordinators: liveCoordinators };
    },
    deleteGroup: async (id: number) => {
      deleted.push(id);
      return deleteResult;
    },
    createGroup: async (input: unknown) => {
      createdGroups.push(input);
      return 42;
    },
    createRequest: async (input: unknown) => {
      createdRequests.push(input);
      return 43;
    },
    exportUsers: async () => exportRows,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/groups`;
});

afterAll(() => { server.close(); });

const login = (password: string) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.0.0.1' },
    body: new URLSearchParams({ password }),
    redirect: 'manual',
  });

describe('доступ к дашборду', () => {
  test('без входа отдаётся форма, а не данные', async () => {
    const r = await fetch(base);
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).toContain('Пароль');
    expect(body).not.toContain(MARKER);
  });

  test('неверный пароль данных не открывает', async () => {
    const r = await login('мимо');
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(MARKER);
  });

  test('верный пароль выдаёт сессионную куку', async () => {
    const r = await login('очень-секретно');
    expect(r.status).toBe(303);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('hg_sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  test('с сессией отдаётся сам дашборд', async () => {
    const cookie = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(base, { headers: { cookie } });
    expect(await r.text()).toContain(MARKER);
  });

  test('после выхода данные снова закрыты', async () => {
    const cookie = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    await fetch(`${base}/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });

    const r = await fetch(base, { headers: { cookie } });
    expect(await r.text()).not.toContain(MARKER);
  });

  test('подделанная кука не открывает дашборд', async () => {
    // Идентификаторы сессий — base64url, поэтому и подделка берётся из того же алфавита.
    const r = await fetch(base, { headers: { cookie: 'hg_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    expect(await r.text()).not.toContain(MARKER);
  });

  test('страница закрыта от поисковиков и от встраивания во фрейм', async () => {
    const r = await fetch(base);
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  test('проверка живости отвечает без пароля', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  test('чужие пути не отдают данные', async () => {
    const r = await fetch(`${base}/../etc/passwd`);
    expect(await r.text()).not.toContain(MARKER);
  });

  test('огромное тело запроса не роняет сервис', async () => {
    const r = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=' + 'x'.repeat(20000),
      redirect: 'manual',
    }).catch(() => null);
    // Соединение может быть оборвано по лимиту — важно, что сервис остался жив.
    expect((await fetch(`${base}/health`)).status).toBe(200);
    if (r) expect(r.status).not.toBe(303);
  });
});

describe('кнопка выхода', () => {
  test('вживляется в отданный дашборд и ведёт на POST /groups/logout', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    expect(html).toContain(MARKER);
    expect(html).toContain('action="/groups/logout"');
    expect(html).toContain('method="post"');
    expect(html).toContain('Выйти');
  });

  test('вживление не мешает выходу закрыть доступ', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const out = await fetch(`${base}/logout`, { method: 'POST', headers: { cookie: sid }, redirect: 'manual' });
    expect(out.status).toBe(303);
    expect(await (await fetch(base, { headers: { cookie: sid } })).text()).not.toContain(MARKER);
  });
});

describe('живые данные из базы', () => {
  test('страница получает группы, заявки и координаторов', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = [{ leader: 'Ведущий Из Базы' }];
    liveRequests = [{ fio: 'Заявка Из Базы' }];
    liveCoordinators = [{ name: 'Координатор Из Базы', role: 'Координатор малых групп' }];
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    expect(html).toContain('Ведущий Из Базы');
    expect(html).toContain('Заявка Из Базы');
    expect(html).toContain('Координатор Из Базы');
    expect(html.indexOf('window.HG_LIVE')).toBeLessThan(html.indexOf('const DATA'));
    liveRequests = [];
    liveCoordinators = [];
  });

  test('подмешиваются в страницу отдельным блоком', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = [{ leader: 'Новый Ведущий', district: 'Невский', source: 'бот' }];
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    expect(html).toContain(MARKER);
    expect(html).toContain('window.HG_LIVE');
    expect(html).toContain('Новый Ведущий');
    // блок должен идти до основного скрипта, иначе страница его не увидит
    expect(html.indexOf('window.HG_LIVE')).toBeLessThan(html.indexOf('const DATA'));
  });

  test('без живых данных страница остаётся прежней', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = [];
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    expect(html).toContain('"groups":[]');
    expect(html).toContain('"requests":[]');
    expect(html).toContain('"coordinators":[]');
  });

  test('падение базы не роняет дашборд', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = 'boom';
    const r = await fetch(base, { headers: { cookie: sid } });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain(MARKER);
    expect(html).toContain('"groups":[]');
    expect(html).toContain('"requests":[]');
    expect(html).toContain('"coordinators":[]');
  });

  test('данные экранируются: закрывающий тег скрипта не ломает страницу', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = [{ leader: '</script><img onerror=alert(1)>' }];
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    const from = html.indexOf('window.HG_LIVE');
    const block = html.slice(from, html.indexOf('</script>', from));
    expect(block).not.toContain('</script>');
    expect(block).toContain('\\u003c/script');
  });
});

describe('удаление ведущего со страницы', () => {
  test('без сессии не удаляет и данных не отдаёт', async () => {
    deleted = [];
    const r = await fetch(`${base}/leader/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id: '7' }),
      redirect: 'manual',
    });
    expect(r.status).toBe(401);
    expect(deleted).toEqual([]);
    expect(await r.text()).not.toContain(MARKER);
  });

  test('с сессией удаляет и отвечает успехом', async () => {
    deleted = [];
    deleteResult = true;
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/leader/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: sid },
      body: new URLSearchParams({ id: '7' }),
      redirect: 'manual',
    });
    expect(r.status).toBe(200);
    expect(deleted).toEqual([7]);
  });

  test('уже удалённая запись отвечает 404, а не молчаливым успехом', async () => {
    deleted = [];
    deleteResult = false;
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/leader/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: sid },
      body: new URLSearchParams({ id: '99' }),
      redirect: 'manual',
    });
    expect(r.status).toBe(404);
    deleteResult = true;
  });

  test('нечисловой id отвергается', async () => {
    deleted = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/leader/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: sid },
      body: new URLSearchParams({ id: 'сотри-всё' }),
      redirect: 'manual',
    });
    expect(r.status).toBe(400);
    expect(deleted).toEqual([]);
  });

  test('GET не удаляет: так картинка со страницы не сотрёт запись', async () => {
    deleted = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/leader/delete?id=7`, { headers: { cookie: sid } });
    expect(r.status).toBe(404);
    expect(deleted).toEqual([]);
  });
});

describe('адрес монтирования для страницы', () => {
  test('сервер сообщает странице свой префикс', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    live = [];
    const html = await (await fetch(base, { headers: { cookie: sid } })).text();
    // Без этого fetch со страницы уходит от корня: адрес «/groups» без косой черты
    // разрешает относительный путь в «/leader/delete», и запрос не доходит до сервиса.
    expect(html).toContain('window.HG_BASE = "/groups/"');
    expect(html.indexOf('window.HG_BASE')).toBeLessThan(html.indexOf('const DATA'));
  });
});

describe('создание группы со страницы', () => {
  const body = (o: Record<string, string>) => new URLSearchParams(o);
  const MIN = { leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная', status: 'Функционирует' };

  const post = (path: string, params: URLSearchParams, cookie?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: params,
      redirect: 'manual',
    });

  test('без сессии не создаёт', async () => {
    createdGroups = [];
    const r = await post('/group/create', body(MIN));
    expect(r.status).toBe(401);
    expect(createdGroups).toEqual([]);
  });

  test('GET не создаёт', async () => {
    createdGroups = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/group/create?leader=Х`, { headers: { cookie: sid } });
    expect(r.status).toBe(404);
    expect(createdGroups).toEqual([]);
  });

  test('с сессией создаёт и возвращает номер записи', async () => {
    createdGroups = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await post('/group/create', body({ ...MIN, people: '7' }), sid);
    expect(r.status).toBe(200);
    expect(createdGroups).toHaveLength(1);
    expect(createdGroups[0]).toMatchObject({ leader: 'Иванова Мария', people: 7 });
  });

  test('несуществующий район отвергается с объяснением', async () => {
    createdGroups = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await post('/group/create', body({ ...MIN, district: 'Марсианский' }), sid);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('район');
    expect(createdGroups).toEqual([]);
  });

  test('длинный комментарий не обрезается лимитом тела', async () => {
    createdGroups = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const comment = 'а'.repeat(5000);
    const r = await post('/group/create', body({ ...MIN, comment }), sid);
    expect(r.status).toBe(200);
    expect(createdGroups[0]).toMatchObject({ comment });
  });
});

describe('создание заявки со страницы', () => {
  const post = (params: URLSearchParams, cookie?: string) =>
    fetch(`${base}/request/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: params,
      redirect: 'manual',
    });

  test('без сессии не создаёт', async () => {
    createdRequests = [];
    expect((await post(new URLSearchParams({ fio: 'Петров' }))).status).toBe(401);
    expect(createdRequests).toEqual([]);
  });

  test('с сессией создаёт', async () => {
    createdRequests = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await post(new URLSearchParams({ fio: 'Петров Пётр', type: 'join_group', status: 'В работе' }), sid);
    expect(r.status).toBe(200);
    expect(createdRequests[0]).toMatchObject({ fio: 'Петров Пётр', status: 'В работе' });
  });

  test('без ФИО отвергается', async () => {
    createdRequests = [];
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await post(new URLSearchParams({ fio: '', type: 'join_group', status: 'В работе' }), sid);
    expect(r.status).toBe(400);
    expect(createdRequests).toEqual([]);
  });
});

describe('выгрузка участников', () => {
  test('без сессии не отдаётся', async () => {
    const r = await fetch(`${base}/export.csv`);
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain('Иванов');
  });

  test('с сессией отдаёт файл', async () => {
    const sid = (await login('очень-секретно')).headers.get('set-cookie')!.split(';')[0]!;
    const r = await fetch(`${base}/export.csv`, { headers: { cookie: sid } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(await r.text()).toContain('Иванов');
  });
});
