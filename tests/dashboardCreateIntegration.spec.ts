import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { createDashboardServer } from '../src/dashboard/server.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { usersToCsv } from '../src/core/csv.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Сквозная проверка форм: запрос по HTTP, разбор, запись в настоящую базу.
 * Заглушек здесь нет нигде, кроме хранилища сессий — Redis для этого не нужен.
 */
let db: Pool;
let base: string;
let server: ReturnType<typeof createDashboardServer>;
let htmlPath: string;
let requests: RequestsRepo;
let groupsRepo: GroupsRepo;
let coordinatorsRepo: CoordinatorsRepo;

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
  db = await setupTestDb();
  const { writeFileSync, mkdirSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  htmlPath = join(mkdtempSync(join(tmpdir(), 'hg-int-')), 'page.html');
  writeFileSync(htmlPath, '<h1>дашборд</h1>\n<script>\nconst DATA = window.HG_LIVE;\n</script>');
  // Фавикон лежит рядом с home-groups.html — так же, как в /app/dashboard в продовом образе.
  mkdirSync(join(dirname(htmlPath), 'assets'));
  writeFileSync(join(dirname(htmlPath), 'assets', 'computer.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const groups = new GroupsRepo(db);
  groupsRepo = groups;
  requests = new RequestsRepo(db);
  const coordinators = new CoordinatorsRepo(db);
  coordinatorsRepo = coordinators;
  const users = new UsersRepo(db);

  server = createDashboardServer({
    auth: new SessionService(memoryStore(), { password: 'пароль-для-теста', ttlSeconds: 600, maxAttempts: 5 }),
    htmlPath,
    sessionTtlSeconds: 600,
    secureCookie: false,
    data: async () => ({
      groups: await groups.forDashboard(),
      requests: await requests.forDashboard(),
      coordinators: await coordinators.listActive(),
      leaderCandidates: await users.leaderCandidates(),
    }),
    createGroup: async (input) => (await groups.create(input as never, 'ui')).id,
    createRequest: (input) => requests.createFromDashboard(input as never),
    updateRequest: (id, patch) => requests.updateFromDashboard(id, patch as never),
    deleteGroup: async (id) => (await groups.archive(id)) !== null,
    updateGroup: async (id, input) => (await groups.update(id, input as never)) !== null,
    deleteRequest: (id) => requests.archive(id),
    setRequestStatus: (id, status, responsible, groupId) => requests.setStatus(id, status as never, responsible, groupId),
    createCoordinator: async (input) => (await coordinators.create(input as never)).id,
    updateCoordinator: async (id, input) => (await coordinators.update(id, input as never)) !== null,
    deleteCoordinator: (id) => coordinators.archive(id),
    exportUsers: async () => usersToCsv(await users.exportRows()),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/groups`;
});

afterAll(async () => {
  server.close();
  await db.end();
});

beforeEach(async () => { await truncateAll(db); });

const login = async () => {
  const r = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.0.0.2' },
    body: new URLSearchParams({ password: 'пароль-для-теста' }),
    redirect: 'manual',
  });
  return r.headers.get('set-cookie')!.split(';')[0]!;
};

const post = (path: string, fields: Record<string, string>, cookie: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(fields),
  });

describe('форма группы пишет в базу', () => {
  test('все поля доходят до таблицы и обратно на страницу', async () => {
    const cookie = await login();
    const r = await post('/group/create', {
      leader: 'Иванова Мария Петровна',
      district: 'Невский',
      format: 'Молодежная',
      status: 'Функционирует',
      phone: '+7 900 111-22-33',
      metro: 'Пионерская',
      address: 'ул. Есенина, д. 1',
      people: '8',
      day: 'Четверг',
      time: '19:00',
      age: '35-50',
      composition: 'Смешанная',
      openToNew: 'ДА',
      coordinator: 'Петрова Мария',
      training: 'Да',
      feedbackAt: '2026-08-20',
      no: '85',
      comment: 'Собираются раз в две недели',
      checked: 'on',
    }, cookie);
    expect(r.status).toBe(200);

    const { rows } = await db.query('SELECT * FROM groups');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      leader: 'Иванова Мария Петровна',
      district: 'Невский',
      format: 'Молодежная',
      status: 'Функционирует',
      phone: '+79001112233',
      phones: ['+79001112233'],
      metro: 'Пионерская',
      address: 'ул. Есенина, д. 1',
      people: 8,
      day: 'Четверг',
      time: '19:00',
      age: '35-50',
      composition: 'Смешанная',
      open_to_new: 'ДА',
      coordinator: 'Петрова Мария',
      training: 'Да',
      no: 85,
      comment: 'Собираются раз в две недели',
      checked: true,
      // Заведённое в дашборде помечается своим источником: импорт такие не затирает.
      source: 'ui',
    });

    // И сразу видно на странице.
    const html = await (await fetch(base, { headers: { cookie } })).text();
    expect(html).toContain('Иванова Мария Петровна');
    expect(html).toContain('ул. Есенина, д. 1');
  });

  test('созданную запись можно убрать со страницы', async () => {
    const cookie = await login();
    await post('/group/create', {
      leader: 'Ошибочная Запись', district: 'Невский', format: 'Служение', status: 'Потенциальная',
    }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM groups');
    const del = await post('/leader/delete', { id: String(rows[0]!.id) }, cookie);
    expect(del.status).toBe(200);

    const after = await db.query('SELECT archived_at FROM groups');
    expect(after.rows[0]!.archived_at).not.toBeNull();
    const html = await (await fetch(base, { headers: { cookie } })).text();
    expect(html).not.toContain('Ошибочная Запись');
  });

  test('отказ формы ничего не пишет', async () => {
    const cookie = await login();
    const r = await post('/group/create', {
      leader: 'Кто-то', district: 'Марсианский', format: 'Молодежная', status: 'Функционирует',
    }, cookie);
    expect(r.status).toBe(400);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM groups');
    expect(rows[0]).toMatchObject({ n: 0 });
  });
});

describe('форма заявки пишет в базу', () => {
  test('заявка без участника в боте сохраняется и видна на странице', async () => {
    const cookie = await login();
    const r = await post('/request/create', {
      fio: 'Петров Пётр Петрович',
      type: 'join_group',
      status: 'В работе',
      phone: '8 (921) 000-11-22',
      place: 'Дыбенко',
      responsible: 'Юлия Комарская',
      source: 'Сайт церкви',
      requestedAt: '2026-08-01',
      note: 'Связывались в вацапе',
    }, cookie);
    expect(r.status).toBe(200);

    const { rows } = await db.query('SELECT * FROM requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fio: 'Петров Пётр Петрович',
      type: 'join_group',
      status: 'В работе',
      phone: '+79210001122',
      place: 'Дыбенко',
      responsible: 'Юлия Комарская',
      origin: 'ui',
      user_id: null,
    });

    const html = await (await fetch(base, { headers: { cookie } })).text();
    expect(html).toContain('Петров Пётр Петрович');
  });
});

describe('выгрузка участников', () => {
  test('отдаёт заголовки и строки из базы', async () => {
    const cookie = await login();
    const { seedUser } = await import('./helpers/testDb.js');
    await seedUser(db, { id: '4242', registered: true, fio: 'Сидоров Сидор' });

    const r = await fetch(`${base}/export.csv`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const csv = await r.text();
    expect(csv).toContain('Сидоров Сидор');
    expect(r.headers.get('content-disposition')).toContain('attachment');
  });
});

describe('ведение заявки в дашборде', () => {
  test('статус меняется, и это фиксируется как обработка', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Сидоров Сидор', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');
    const id = rows[0]!.id;

    const r = await post('/request/status', { id: String(id), status: 'Исполнена' }, cookie);
    expect(r.status).toBe(200);

    const after = await db.query('SELECT status, handled_by, handled_at FROM requests WHERE id = $1', [id]);
    expect(after.rows[0]).toMatchObject({ status: 'Исполнена', handled_by: 'дашборд' });
    expect(after.rows[0]!.handled_at).not.toBeNull();
  });

  test('перевод в работу не считается обработкой', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Сидоров Сидор', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');

    await post('/request/status', { id: String(rows[0]!.id), status: 'В работе', responsible: 'Юлия' }, cookie);
    const after = await db.query('SELECT status, responsible, handled_at FROM requests WHERE id = $1', [rows[0]!.id]);
    expect(after.rows[0]).toMatchObject({ status: 'В работе', responsible: 'Юлия' });
    // Заявка ещё открыта, поэтому отметки об обработке быть не должно.
    expect(after.rows[0]!.handled_at).toBeNull();
  });

  test('заявка бота закрывается так же, как своя', async () => {
    const cookie = await login();
    const { seedUser } = await import('./helpers/testDb.js');
    const userId = await seedUser(db, { id: '777', registered: true });
    const created = await requests.create(userId, 'question', 'А можно с ребёнком?');

    await post('/request/status', { id: String(created.id), status: 'Исполнена' }, cookie);
    const after = await db.query('SELECT status FROM requests WHERE id = $1', [created.id]);
    expect(after.rows[0]).toMatchObject({ status: 'Исполнена' });
  });

  test('без сессии не меняет', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Сидоров', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');

    const r = await fetch(`${base}/request/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id: String(rows[0]!.id), status: 'Исполнена' }),
    });
    expect(r.status).toBe(401);
    const after = await db.query('SELECT status FROM requests WHERE id = $1', [rows[0]!.id]);
    expect(after.rows[0]).toMatchObject({ status: 'Новая' });
  });

  test('придуманный статус отвергается', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Сидоров', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');
    const r = await post('/request/status', { id: String(rows[0]!.id), status: 'Придумано' }, cookie);
    expect(r.status).toBe(400);
  });

  test('несуществующая заявка отвечает 404, а не молчаливым успехом', async () => {
    const cookie = await login();
    const r = await post('/request/status', { id: '999999', status: 'Исполнена' }, cookie);
    expect(r.status).toBe(404);
  });

  test('быстрое назначение группы через переключатель статуса', async () => {
    const cookie = await login();
    await post('/group/create', {
      leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная', status: 'Функционирует',
    }, cookie);
    const { rows: g } = await db.query<{ id: number }>('SELECT id FROM groups');

    await post('/request/create', { fio: 'Сидоров Сидор', type: 'join_group', status: 'Новая' }, cookie);
    const { rows: r } = await db.query<{ id: number }>('SELECT id FROM requests');

    const res = await post('/request/status', {
      id: String(r[0]!.id), status: 'В работе', groupId: String(g[0]!.id),
    }, cookie);
    expect(res.status).toBe(200);

    const after = await db.query('SELECT group_id FROM requests WHERE id = $1', [r[0]!.id]);
    expect(after.rows[0]).toMatchObject({ group_id: g[0]!.id });
  });
});

describe('правка и удаление в списках', () => {
  const GROUP = { leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная', status: 'Функционирует' };

  test('группу можно исправить прямо из списка', async () => {
    const cookie = await login();
    await post('/group/create', { ...GROUP, people: '5' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM groups');
    const id = rows[0]!.id;

    const r = await post('/group/update', {
      id: String(id), ...GROUP, leader: 'Иванова Мария Сергеевна',
      status: 'На паузе', people: '9', comment: 'Перенесли на пятницу',
    }, cookie);
    expect(r.status).toBe(200);

    const after = await db.query('SELECT leader, status, people, comment FROM groups WHERE id = $1', [id]);
    expect(after.rows[0]).toMatchObject({
      leader: 'Иванова Мария Сергеевна', status: 'На паузе', people: 9, comment: 'Перенесли на пятницу',
    });
  });

  test('правка группы из выгрузки переводит её под дашборд', async () => {
    const cookie = await login();
    const created = await groupsRepo.create({ ...GROUP, no: 5, leader: 'Из Выгрузки' } as never, 'таблица');
    const r = await post('/group/update', { id: String(created.id), ...GROUP, no: '5', leader: 'Правленая' }, cookie);
    expect(r.status).toBe(200);
    const after = await db.query('SELECT leader, source FROM groups WHERE id = $1', [created.id]);
    expect(after.rows[0]).toMatchObject({ leader: 'Правленая', source: 'ui' });
  });

  test('любую группу можно убрать, включая пришедшую из выгрузки', async () => {
    const cookie = await login();
    const created = await groupsRepo.create({ ...GROUP, leader: 'Лишняя' } as never, 'таблица');
    const r = await post('/group/delete', { id: String(created.id) }, cookie);
    expect(r.status).toBe(200);
    const html = await (await fetch(base, { headers: { cookie } })).text();
    expect(html).not.toContain('Лишняя');
  });

  test('заявку можно исправить целиком, не только статус', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Петров Пётр', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');

    const r = await post('/request/update', {
      id: String(rows[0]!.id), fio: 'Петров Пётр Петрович', type: 'question',
      status: 'На контроле', place: 'Купчино', responsible: 'Марина', note: 'перезвонить',
    }, cookie);
    expect(r.status).toBe(200);
    const after = await db.query('SELECT fio, type, status, place, responsible, note FROM requests WHERE id = $1', [rows[0]!.id]);
    expect(after.rows[0]).toMatchObject({
      fio: 'Петров Пётр Петрович', type: 'question', status: 'На контроле',
      place: 'Купчино', responsible: 'Марина', note: 'перезвонить',
    });
  });

  test('заявку можно убрать, и она пропадает со страницы', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Ошибочная Заявка', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');

    const r = await post('/request/delete', { id: String(rows[0]!.id) }, cookie);
    expect(r.status).toBe(200);
    const html = await (await fetch(base, { headers: { cookie } })).text();
    expect(html).not.toContain('Ошибочная Заявка');
    // Мягко: след обращения остаётся в базе.
    const after = await db.query('SELECT archived_at FROM requests WHERE id = $1', [rows[0]!.id]);
    expect(after.rows[0]!.archived_at).not.toBeNull();
  });

  test('повторное удаление заявки отвечает 404', async () => {
    const cookie = await login();
    await post('/request/create', { fio: 'Раз', type: 'join_group', status: 'Новая' }, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM requests');
    await post('/request/delete', { id: String(rows[0]!.id) }, cookie);
    expect((await post('/request/delete', { id: String(rows[0]!.id) }, cookie)).status).toBe(404);
  });

  test('без сессии не правит и не удаляет', async () => {
    const cookie = await login();
    await post('/group/create', GROUP, cookie);
    const { rows } = await db.query<{ id: number }>('SELECT id FROM groups');
    const bare = (path: string, fields: Record<string, string>) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    expect((await bare('/group/update', { id: String(rows[0]!.id), ...GROUP })).status).toBe(401);
    expect((await bare('/group/delete', { id: String(rows[0]!.id) })).status).toBe(401);
    expect((await bare('/request/delete', { id: '1' })).status).toBe(401);
  });
});

describe('участники (координаторы) через дашборд', () => {
  test('заведённый участник доходит до базы', async () => {
    const cookie = await login();
    const r = await post('/coordinator/create', { name: 'Петрова Мария', role: 'Координатор малых групп' }, cookie);
    expect(r.status).toBe(200);

    const { rows } = await db.query('SELECT name, role, source FROM coordinators');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Петрова Мария', role: 'Координатор малых групп', source: 'ui' });
  });

  test('отказ формы ничего не пишет', async () => {
    const cookie = await login();
    const r = await post('/coordinator/create', { name: '  ', role: 'Координатор' }, cookie);
    expect(r.status).toBe(400);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM coordinators');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('участника можно исправить', async () => {
    const cookie = await login();
    const created = await coordinatorsRepo.create({ name: 'Петрова Мария', role: 'Координатор' });

    const r = await post('/coordinator/update', {
      id: String(created.id), name: 'Петрова Мария Ивановна', role: 'Старший координатор',
    }, cookie);
    expect(r.status).toBe(200);

    const after = await db.query('SELECT name, role FROM coordinators WHERE id = $1', [created.id]);
    expect(after.rows[0]).toMatchObject({ name: 'Петрова Мария Ивановна', role: 'Старший координатор' });
  });

  test('правка несуществующего участника отвечает 404', async () => {
    const cookie = await login();
    const r = await post('/coordinator/update', { id: '999999', name: 'Кто-то', role: 'Координатор' }, cookie);
    expect(r.status).toBe(404);
  });

  test('участника можно убрать, и он пропадает из списка', async () => {
    const cookie = await login();
    const created = await coordinatorsRepo.create({ name: 'Лишний', role: 'Координатор' });

    const r = await post('/coordinator/delete', { id: String(created.id) }, cookie);
    expect(r.status).toBe(200);
    expect(await coordinatorsRepo.listActive()).toEqual([]);
  });

  test('повторное удаление участника отвечает 404', async () => {
    const cookie = await login();
    const created = await coordinatorsRepo.create({ name: 'Раз', role: 'Координатор' });
    await post('/coordinator/delete', { id: String(created.id) }, cookie);
    expect((await post('/coordinator/delete', { id: String(created.id) }, cookie)).status).toBe(404);
  });

  test('без сессии не заводит, не правит и не удаляет', async () => {
    const created = await coordinatorsRepo.create({ name: 'Петрова Мария', role: 'Координатор' });
    const bare = (path: string, fields: Record<string, string>) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    expect((await bare('/coordinator/create', { name: 'Новый', role: 'Координатор' })).status).toBe(401);
    expect((await bare('/coordinator/update', { id: String(created.id), name: 'Правка', role: 'Координатор' })).status).toBe(401);
    expect((await bare('/coordinator/delete', { id: String(created.id) })).status).toBe(401);
  });
});

describe('фавикон', () => {
  test('отдаётся без входа: браузер запрашивает его до формы логина', async () => {
    const r = await fetch(`${base}/assets/computer.png`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  test('другой файл под /assets не отдаётся: маршрут знает только про иконку', async () => {
    const r = await fetch(`${base}/assets/other.png`);
    expect(r.status).toBe(404);
  });
});
