import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { composeViews, engine as realEngine } from '../src/home-groups/composition.js';
import { createHomeGroupsServer } from '../src/home-groups/server.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Представления из живых репозиториев на настоящей тестовой базе. Движок поддельный
 * (настоящий проверяется своими тестами), но всё остальное — репозитории, SQL, сервер — боевое.
 */

const SECRET_ADDRESS = 'ул. Секретная, дом 7, кв. 12';
const SECRET_PHONE = '+79990001122';
const SECRET_SURVEY_ADDRESS = 'пр. Анкетный, 3';

let db: Pool;
let groups: GroupsRepo;
let requests: RequestsRepo;
let users: UsersRepo;
let coordinators: CoordinatorsRepo;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => {
  await truncateAll(db);
  groups = new GroupsRepo(db);
  requests = new RequestsRepo(db);
  users = new UsersRepo(db);
  coordinators = new CoordinatorsRepo(db);
});

const GROUP = { format: 'Молодежная' as const, status: 'Функционирует' as const };

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(d);
}

async function seed() {
  const maria = await groups.create({
    ...GROUP, leader: 'Мария Иванова', phones: ['+79111234567'], phone: '8 (911) 123-45-67; Мария',
    district: 'Приморский', metro: 'Беговая', address: SECRET_ADDRESS, coLeader: 'Пётр', coLeaderPhone: SECRET_PHONE,
    day: 'Вторник', time: '19:00', age: '25-40', people: 4, coordinator: 'Анна Смирнова', feedbackAt: isoDaysAgo(5),
    comment: 'Собираются у метро',
  }, 'таблица');
  const closed = await groups.create({ ...GROUP, leader: 'Закрытый', district: 'Невский' }, 'ui');
  // «Закрыта» приходит из импорта таблицы, формы дашборда такого статуса не знают.
  await db.query(`UPDATE groups SET status = 'Закрыта' WHERE id = $1`, [closed.id]);
  const gone = await groups.create({ ...GROUP, leader: 'Удалённый', district: 'Приморский' }, 'ui');
  await groups.archive(gone.id);

  await coordinators.create({ name: 'Анна Смирнова', role: 'Координатор' });
  const retired = await coordinators.create({ name: 'Ушедший', role: 'Координатор' });
  await coordinators.archive(retired.id);

  const tg = await seedUser(db, { id: '1', fio: 'Дарья Ефимова', mdgStatus: 'join', platform: 'telegram' });
  await db.query(`UPDATE users SET location = 'Приморский', age = 31 WHERE id = $1`, [tg]);
  const mx = await seedUser(db, { id: '2', fio: 'Борис Калинин', mdgStatus: 'open', platform: 'max' });
  await users.createManual({
    platform: 'telegram', byAdminId: 'дашборд', fio: 'Из формы', phone: '+79001112299', mdgStatus: 'member',
  });

  const botRequest = await requests.create(tg, 'join_group');
  const tableRequestId = await requests.createFromDashboard({
    fio: 'Станислав Ким', type: 'join_group', status: 'Новая', phones: ['+79041234567'], age: '26-35',
    place: 'Невский', note: 'Хочет вечером', requestedAt: isoDaysAgo(3),
  });
  await db.query(`UPDATE requests SET origin = 'таблица', source = 'Таблица' WHERE id = $1`, [tableRequestId]);
  const doneId = await requests.createFromDashboard({
    fio: 'Утверждённый', type: 'join_group', status: 'Исполнена', groupId: maria.id, finalGroup: 'Мария Иванова',
    recommended: 'Мария Иванова', recommendedAt: isoDaysAgo(2), requestedAt: isoDaysAgo(9),
  });
  await requests.createFromDashboard({ fio: 'Отказник', type: 'join_group', status: 'Аннулирована', cancelReason: 'переехал' });
  const lead = await requests.createFromDashboard({ fio: 'Хочет открыть', type: 'lead_group', status: 'Новая' });
  const archived = await requests.createFromDashboard({ fio: 'Убранная', type: 'join_group', status: 'Новая' });
  await requests.archive(archived);
  // Секреты анкеты участника, которым в ответе делать нечего.
  await db.query(`UPDATE users SET address_raw = $2, schedule_raw = 'вечером' WHERE id = $1`, [tg, SECRET_SURVEY_ADDRESS]);

  return { maria, closed, gone, tg, mx, botRequest, tableRequestId, doneId, lead, archived };
}

function liveViews() {
  const { engine, calls } = createFakeEngine();
  return { get: composeViews(db, engine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' }), calls };
}

describe('представления из живых репозиториев', () => {
  test('группы: убранная в архив не видна, закрытая видна, поля собраны', async () => {
    const s = await seed();
    const { groups: view } = await liveViews().get();

    expect(view.items.map((g) => g.leader).sort()).toEqual(['Закрытый', 'Мария Иванова']);
    const maria = view.items.find((g) => g.id === s.maria.id)!;
    expect(maria).toMatchObject({
      code: `ДГ-${String(s.maria.id).padStart(4, '0')}`, leader: 'Мария Иванова', coLeader: 'Пётр',
      phone: '+7 911 123-45-67', district: 'Приморский', metro: 'Беговая', day: 'Вт', slot: 'вечер',
      whenText: 'Вт, вечер', people: 4, capacity: 10, free: 6, status: 'Функционирует', acceptsNew: true,
      doNotRefer: false, coordinator: 'Анна Смирнова', verifiedDaysAgo: 5, comment: 'Собираются у метро',
    });
    // Все шесть пунктов здоровья заполнены.
    expect(maria.health.score).toBe(100);
  });

  test('закрытый адрес группы, второй телефон ведущего и ответы анкеты нигде не появляются', async () => {
    await seed();
    const json = JSON.stringify(await liveViews().get());
    expect(json).not.toContain(SECRET_ADDRESS);
    expect(json).not.toContain('Секретная');
    expect(json).not.toContain(SECRET_PHONE);
    expect(json).not.toContain(SECRET_SURVEY_ADDRESS);
    expect(json).not.toContain('address');
  });

  test('заявки: открытые и исполненные, отказ только в счётчике, убранные и чужие виды не видны', async () => {
    const s = await seed();
    const { requests: view, today } = await liveViews().get();

    expect(view.items.map((i) => i.fio).sort()).toEqual(['Дарья Ефимова', 'Станислав Ким', 'Утверждённый'].sort());
    expect(view.counters).toEqual({ ready: 1, callback: 0, human: 1, done: 1, cancelled: 1 });
    expect(today.assigned).toBe(2);
    expect(today.total).toBe(3);

    const table = view.items.find((i) => i.id === s.tableRequestId)!;
    expect(table).toMatchObject({
      phone: '+7 904 123-45-67', ageLabel: '26-35', place: 'Невский', district: 'Невский', source: 'Таблица',
      waitingDays: 3, note: 'Хочет вечером', bucket: 'human',
    });
    expect(table.noPlan?.code).toBe('nogroup');
    expect(table.log[0]).toEqual({ at: isoDaysAgo(3), text: 'Заявка создана (Таблица)' });

    const done = view.items.find((i) => i.id === s.doneId)!;
    expect(done.bucket).toBe('done');
    expect(done.finalGroup?.id).toBe(s.maria.id);
    expect(done.finalGroupText).toBeNull();
    expect(done.log.map((l) => l.text)).toEqual([
      'Заявка создана (Дашборд)', 'Рекомендована группа: Мария Иванова', 'Утверждена: Мария Иванова',
    ]);
  });

  test('заявка из бота берёт имя и телефон участника и подписана ботом', async () => {
    const s = await seed();
    const { requests: view } = await liveViews().get();
    const bot = view.items.find((i) => i.id === s.botRequest.id)!;
    expect(bot).toMatchObject({ fio: 'Дарья Ефимова', source: 'Бот', district: 'Приморский', ageLabel: '31' });
    expect(bot.phone).toMatch(/^\+7 900 000-00-01$/);
    expect(bot.bucket).toBe('ready');
    expect(bot.proposal?.main.group.id).toBe(s.maria.id);
  });

  test('люди: участники по платформам, заведённый вручную, и заявки без участника', async () => {
    const s = await seed();
    const { people } = await liveViews().get();
    const byFio = (fio: string) => people.items.find((p) => p.fio === fio)!;

    expect(byFio('Дарья Ефимова')).toMatchObject({
      key: `u${s.tg}`, from: 'Бот · Telegram', mdgLabel: 'Хочет в группу', district: 'Приморский',
      requestId: s.botRequest.id,
    });
    expect(byFio('Борис Калинин')).toMatchObject({ key: `u${s.mx}`, from: 'Бот · MAX', mdgLabel: 'Откроет свою группу', requestId: null });
    expect(byFio('Из формы')).toMatchObject({ from: 'Форма регистрации', mdgLabel: 'Уже в группе' });
    expect(byFio('Станислав Ким')).toMatchObject({
      key: `r${s.tableRequestId}`, from: 'Таблица', mdgLabel: 'Заявка: нужна помощь в сопоставлении', requestId: s.tableRequestId,
    });
    // Заявка участника отдельной строкой не дублируется, убранная и «хочет открыть» в людях не видны.
    expect(people.items.filter((p) => p.fio === 'Дарья Ефимова')).toHaveLength(1);
    expect(people.items.some((p) => p.fio === 'Убранная' || p.fio === 'Хочет открыть')).toBe(false);
  });

  test('координаторы: убранный не виден, группы и участники считаются по имени', async () => {
    await seed();
    const { coordinators: view } = await liveViews().get();
    expect(view.items).toMatchObject([{ name: 'Анна Смирнова', role: 'Координатор', groups: 1, people: 4, verified30: 1 }]);
  });

  test('в движок попадают открытые заявки, все группы справочника и вместимость по умолчанию', async () => {
    await seed();
    const live = liveViews();
    await live.get();
    const input = live.calls.plan[0]!;
    expect(input.requests.map((r) => r.fio).sort()).toEqual(['Дарья Ефимова', 'Станислав Ким']);
    expect(input.groups.map((g) => g.leader).sort()).toEqual(['Закрытый', 'Мария Иванова']);
    expect(input.groups.every((g) => g.capacity === 10)).toBe(true);
  });

  test('пустая база собирается без ошибок', async () => {
    const view = await liveViews().get();
    expect(view.today.total).toBe(0);
    expect(view.groups.items).toEqual([]);
  });
});

describe('с настоящим движком на живой базе', () => {
  // Дымовая проверка стыка: типы и формы данных сервиса и движка сходятся на реальных строках базы.
  test('представления собираются, а заявка с районом получает план в существующую группу', async () => {
    const s = await seed();
    const views = await composeViews(db, realEngine, { defaultCapacity: 10, ttlMs: 0 })();

    const bot = views.requests.items.find((i) => i.id === s.botRequest.id)!;
    expect(['ready', 'human']).toContain(bot.bucket);
    if (bot.proposal) expect(bot.proposal.main.group.id).toBe(s.maria.id);
    expect(views.today.counters.done).toBe(1);
    expect(views.today.ageColumns.length).toBeGreaterThan(0);
    expect(JSON.stringify(views)).not.toContain(SECRET_ADDRESS);
  });
});

describe('через HTTP на живой базе', () => {
  test('API отдаёт представления, и закрытые поля в ответах не видны', async () => {
    await seed();
    const store = new Map<string, string>();
    const memory: SessionStore = {
      async set(k, v) { store.set(k, v); }, async get(k) { return store.get(k) ?? null; },
      async del(k) { store.delete(k); }, async incr(k) { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    };
    const web = mkdtempSync(join(tmpdir(), 'hg-int-'));
    writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
    const server = createHomeGroupsServer({
      auth: new SessionService(memory, { password: 'интеграционный-пароль', ttlSeconds: 60, maxAttempts: 5 }),
      views: liveViews().get, sessionTtlSeconds: 60, secureCookie: false, webDir: web,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const login = await fetch(`${base}/login`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.3.0.1' },
        body: new URLSearchParams({ login: 'mbv_admin', password: 'интеграционный-пароль' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;

      let all = '';
      for (const name of ['today', 'requests', 'groups', 'people', 'coordinators']) {
        const r = await fetch(`${base}/api/v1/${name}`, { headers: { cookie } });
        expect(r.status, name).toBe(200);
        all += await r.text();
      }
      expect(all).toContain('Мария Иванова');
      expect(all).toContain('Станислав Ким');
      for (const secret of [SECRET_ADDRESS, 'Секретная', SECRET_PHONE, SECRET_SURVEY_ADDRESS, '"address"']) {
        expect(all).not.toContain(secret);
      }
    } finally { server.close(); }
  });
});
