import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB } from '../src/core/texts.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;
let router: Router;

const USER = '555';
const ADMIN = '999';

const ctx = (id = USER): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const start = (id = USER): IncomingUpdate => ({ kind: 'start', ctx: ctx(id) });
const text = (t: string, id = USER): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const contact = (phone: string, id = USER): IncomingUpdate => ({ kind: 'contact', ctx: ctx(id), phone, isOwn: true });
const tap = (data: string, id = USER, callbackId = 'cb-1'): IncomingUpdate => ({
  kind: 'callback',
  ctx: ctx(id),
  data,
  callbackId,
});

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  tg = new FakePlatform('telegram');
  deps = createDeps({
    db,
    platforms: new Map<PlatformName, Platform>([['telegram', tg]]),
    admins: new Map([['telegram', [ADMIN]]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
  });
  router = new Router(deps);
});

/** Обязательные вопросы: согласие, ФИО, телефон, церковь. */
async function answerRequired(id = USER): Promise<void> {
  await router.handle(start(id));
  await router.handle(tap(CB.consentYes, id));
  await router.handle(text('Иванов Иван Иванович', id));
  await router.handle(contact('79001234567', id));
  await router.handle(tap('church:0', id));
}

/** Полная регистрация ведущего МДГ: у него нет уточняющих вопросов. */
async function registerLeader(id = USER): Promise<void> {
  await answerRequired(id);
  await router.handle(tap(CB.mdgLeader, id));
  await router.handle(tap(CB.confirm, id));
}

const dbUser = async (id = USER) =>
  (await db.query('SELECT * FROM users WHERE platform_user_id = $1', [id])).rows[0] as Record<string, unknown>;

describe('регистрация через роутер', () => {
  test('согласие на обработку данных фиксируется в базе', async () => {
    await router.handle(start());
    await router.handle(tap(CB.consentYes));

    expect((await dbUser())['consent_at']).toBeInstanceOf(Date);
  });

  test('без согласия ничего не сохраняется', async () => {
    await router.handle(start());
    await router.handle(tap(CB.consentNo));

    const u = await dbUser();
    expect(u['consent_at']).toBeNull();
    expect(u['full_name']).toBeNull();
  });

  test('ответы пишутся по шагам, а не только в конце', async () => {
    await answerRequired();

    // Номера ещё нет: анкета не подтверждена. Но контакт у церкви уже есть.
    const u = await dbUser();
    expect(u).toMatchObject({
      full_name: 'Иванов Иван Иванович',
      phone: '+79001234567',
      church: 'МБВ Колизей',
    });
    expect(u['registration_no']).toBeNull();
  });

  test('подтверждение присваивает номер регистрации', async () => {
    await registerLeader();

    const u = await dbUser();
    expect(u['registration_no']).toBe(1);
    expect(u['registered_at']).toBeInstanceOf(Date);
    expect(u).toMatchObject({ mdg_status: 'leader', complete: true });
  });

  test('после регистрации приходит QR-код с номером', async () => {
    await registerLeader();

    expect(tg.photos).toHaveLength(1);
    expect(tg.photos[0]?.name).toBe('registration-1.png');
    expect(tg.textsTo(USER).join('\n')).toContain('1');
  });

  test('номера регистрации не повторяются', async () => {
    await registerLeader(USER);
    await registerLeader('777');

    const { rows } = await db.query('SELECT registration_no FROM users ORDER BY registration_no');
    expect(rows.map((r) => (r as { registration_no: number }).registration_no)).toEqual([1, 2]);
  });

  test('ветка «ищу группу» сохраняет район и возрастную категорию', async () => {
    await answerRequired();
    await router.handle(tap(CB.mdgJoin));
    await router.handle(text('улица Ленина, 5'));
    await router.handle(tap('age:2'));
    await router.handle(tap(CB.confirm));

    expect(await dbUser()).toMatchObject({
      mdg_status: 'join',
      location: 'улица Ленина, 5',
      age: '25-40',
    });
  });

  test('«готов предоставить дом» пишется отдельным статусом', async () => {
    await answerRequired();
    await router.handle(tap(CB.mdgHome));
    await router.handle(text('Приморский, м. Пионерская'));
    await router.handle(tap('age:3'));
    await router.handle(tap(CB.confirm));

    expect(await dbUser()).toMatchObject({ mdg_status: 'home', age: '40-55' });
  });

  test('заявка координатору создаётся для того, кто ищет группу', async () => {
    await answerRequired();
    await router.handle(tap(CB.mdgJoin));
    await router.handle(text('улица Ленина, 5'));
    await router.handle(tap('age:2'));
    await router.handle(tap(CB.confirm));

    const { rows } = await db.query('SELECT type, status FROM requests');
    expect(rows).toEqual([{ type: 'join_group', status: 'Новая' }]);
  });

  test('«вернуться» возвращает к выбору, не теряя обязательных ответов', async () => {
    await answerRequired();
    await router.handle(tap(CB.mdgJoin));
    await router.handle(tap(CB.back));
    await router.handle(tap(CB.mdgLeader));
    await router.handle(tap(CB.confirm));

    const u = await dbUser();
    expect(u).toMatchObject({ mdg_status: 'leader', complete: true, registration_no: 1 });
    expect(u['location']).toBeNull();
  });

  test('состояние диалога переживает перезапуск процесса', async () => {
    await router.handle(start());
    await router.handle(tap(CB.consentYes));
    await router.handle(text('Иванов Иван Иванович'));

    const afterRestart = new Router(createDeps({ ...deps.raw, db }));
    await afterRestart.handle(contact('79001234567'));

    const { rows } = await db.query('SELECT state FROM sessions');
    expect(rows[0]).toMatchObject({ state: 'await_church' });
  });

  test('нажатие кнопки подтверждается платформе', async () => {
    await router.handle(start());
    await router.handle(tap(CB.consentYes, USER, 'cb-42'));

    expect(tg.acked).toContain('cb-42');
  });

  test('повторный /start не создаёт второго участника', async () => {
    await registerLeader();
    await router.handle(start());

    const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0]).toMatchObject({ n: 1 });
  });
});

describe('заявки служителям', () => {
  test('заявка на свою МДГ уходит админу с телефоном и номером', async () => {
    await registerLeader();
    await router.handle(tap(CB.menuLead));

    const toAdmin = tg.textsTo(ADMIN).join('\n');
    expect(toAdmin).toContain('+7 900 123-45-67');
    expect(toAdmin).toContain('Иванов Иван Иванович');
    expect(toAdmin).toContain('№1');
  });


  test('участнику при закрытии заявки бот ничего не пишет: переписки нет', async () => {
    await registerLeader();
    await router.handle(tap(CB.menuLead));
    const { rows } = await db.query('SELECT id FROM requests');
    const before = tg.textsTo(USER).length;

    await router.handle(text(`/close ${(rows[0] as { id: number }).id}`, ADMIN));

    expect(tg.textsTo(USER).length).toBe(before);
  });


  test('повторное нажатие кнопки не создаёт вторую заявку того же вида', async () => {
    await registerLeader();
    await router.handle(tap(CB.menuLead));
    await router.handle(tap(CB.menuLead));
    await router.handle(tap(CB.menuLead));

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM requests WHERE type = 'lead_group'`);
    expect(rows[0]).toMatchObject({ n: 1 });
  });


});

describe('админские команды', () => {
  test('/export отдаёт CSV файлом', async () => {
    await seedUser(db, { id: '101' });
    await seedUser(db, { id: '102' });
    await router.handle(text('/export', ADMIN));

    expect(tg.files).toHaveLength(1);
    expect(tg.files[0]?.name).toMatch(/\.csv$/);
  });


  test('/setday сохраняет контент дня, /days показывает загруженные дни', async () => {
    await router.handle(text('/setday 3 Слово третьего дня', ADMIN));
    await router.handle(text('/days', ADMIN));

    const day = await db.query('SELECT content FROM campaign_days WHERE day = 3');
    expect(day.rows[0]).toMatchObject({ content: 'Слово третьего дня' });
    expect(tg.textsTo(ADMIN).join('\n')).toContain('3');
  });

  test('/setday с номером вне кампании отклоняется', async () => {
    await router.handle(text('/setday 99 текст', ADMIN));

    const { rows } = await db.query('SELECT count(*)::int AS n FROM campaign_days');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('/broadcast отправляет объявление всем участникам после подтверждения', async () => {
    await seedUser(db, { id: '101' });
    await seedUser(db, { id: '102' });
    tg.sent.length = 0;

    await router.handle(text('/broadcast Завтра сбор в 10:00', ADMIN));
    expect(tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00')).toEqual([]);

    await router.handle(tap('admin:confirm', ADMIN));

    const recipients = tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00').map((m) => m.chatId);
    expect(recipients.sort()).toEqual(['101', '102']);
  });

  test('обычный участник не может выгрузить базу', async () => {
    await registerLeader();
    tg.files.length = 0;

    await router.handle(text('/export'));

    expect(tg.files).toEqual([]);
  });

  test('/whoami сообщает id, чтобы можно было прописать админа', async () => {
    await router.handle(text('/whoami'));
    expect(tg.textsTo(USER).join('\n')).toContain(USER);
  });
});
