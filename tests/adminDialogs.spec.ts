import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { CB } from '../src/core/texts.js';
import { ADMIN_CB } from '../src/admin/menu.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;
let router: Router;

const ADMIN = '999';
const USER = '555';

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const text = (t: string, id = ADMIN): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const tap = (data: string, id = ADMIN): IncomingUpdate => ({
  kind: 'callback',
  ctx: ctx(id),
  data,
  callbackId: 'cb-1',
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

const toAdmin = () => tg.textsTo(ADMIN).join('\n');
const adminState = async () => {
  const { rows } = await db.query(
    `SELECT a.state FROM admin_sessions a JOIN users u ON u.id = a.user_id WHERE u.platform_user_id = $1`,
    [ADMIN],
  );
  return (rows[0] as { state: string } | undefined)?.state ?? 'idle';
};

describe('клавиатура служителя в диалоге', () => {
  test('служитель, прошедший анкету, получает клавиатуру при /start', async () => {
    await seedUser(db, { id: ADMIN });
    await router.handle({ kind: 'start', ctx: ctx(ADMIN) });
    expect(tg.actionMenus.filter((m) => m.chatId === ADMIN).length).toBeGreaterThan(0);
  });

  test('на шаге телефона клавиатура служителя не затирает кнопку «поделиться номером»', async () => {
    // В Telegram reply-клавиатура одна на чат: меню служителя, отправленное после
    // запроса контакта, забрало бы кнопку телефона с собой.
    await router.handle({ kind: 'start', ctx: ctx(ADMIN) });
    await router.handle(tap(CB.consentYes));
    tg.actionMenus.length = 0;

    await router.handle(text('Петров Пётр Петрович'));

    expect(tg.contactRequests).toContain(ADMIN);
    expect(tg.actionMenus.filter((m) => m.chatId === ADMIN)).toEqual([]);
  });

  test('обычный участник клавиатуру служителя не получает', async () => {
    await router.handle({ kind: 'start', ctx: ctx(USER) });
    expect(tg.actionMenus.filter((m) => m.chatId === USER)).toEqual([]);
  });

  test('подпись кнопки от обычного участника не выполняет команду', async () => {
    await router.handle(text('📊 Статистика', USER));
    expect(tg.textsTo(USER).join('\n')).not.toContain('Участники кампании');
  });

  test('нажатие снятой кнопки объясняет, куда всё переехало', async () => {
    // Клавиатура живёт в клиенте: у служителя она останется старой, пока бот
    // не пришлёт новую. Такое нажатие не должно попасть в анкету как ответ.
    await seedUser(db, { id: ADMIN });
    await router.handle(text('📊 Статистика'));

    const said = tg.textsTo(ADMIN).join('\n');
    expect(said).toContain('дашборд');
    const { rows } = await db.query('SELECT full_name FROM users WHERE platform_user_id = $1', [ADMIN]);
    expect(rows[0]!.full_name).not.toBe('📊 Статистика');
  });

  test('снятая кнопка у обычного участника ничего не объясняет: у него её и не было', async () => {
    await router.handle(text('📇 Ведущие', USER));
    expect(tg.textsTo(USER).join('\n')).not.toContain('дашборд');
  });
});

describe('разметка сообщений служителю', () => {
  // Telegram отвергает сообщение целиком, если в HTML попадёт «<номер заявки>»:
  // «can't parse entities: Unsupported start tag». Такое ловим тестом, а не в бою.
  const ALLOWED_TAGS = /<\/?(b|i|code|pre)>/g;
  const hasRawTag = (t: string) => t.replace(ALLOWED_TAGS, '').includes('<');

  const sentToAdmin = () => tg.sent.filter((m) => m.chatId === ADMIN).map((m) => m.text);

  test('в справке нет сырых угловых скобок', async () => {
    await router.handle(text('/help'));
    expect(sentToAdmin().filter(hasRawTag)).toEqual([]);
  });

  test('подсказка про формат /setday безопасна', async () => {
    await router.handle(text('/setday непонятно'));
    expect(sentToAdmin().filter(hasRawTag)).toEqual([]);
  });

  test('все экраны служителя проходят проверку на сырые теги', async () => {
    await seedUser(db, { id: USER });
    await deps.campaign.setDay(1, 'Материал первого дня');
    for (const cmd of ['/stats', '/requests', '/days', '/getday 1', '/help']) {
      await router.handle(text(cmd));
    }
    expect(sentToAdmin().filter(hasRawTag)).toEqual([]);
  });
});

describe('простые кнопки', () => {

  test('«Выгрузить участников» присылает файл', async () => {
    await seedUser(db, { id: USER });
    await router.handle(text('/export'));
    expect(tg.files).toHaveLength(1);
  });

  // «Старт» — не команда служителя, а вход в анкету. Разбор админских кнопок её не
  // знает, и без подмены нажатие в MAX молчало, а в Telegram уходило в анкету ответом.
  test('«Старт» инлайн-кнопкой (так приходит в MAX) начинает анкету', async () => {
    await router.handle(tap(`${ADMIN_CB}/start`));
    expect(toAdmin()).toContain('согласие на обработку персональных данных');
  });

  test('«Старт» подписью кнопки (так приходит в Telegram) начинает анкету', async () => {
    await router.handle(text('▶️ Старт'));
    expect(toAdmin()).toContain('согласие на обработку персональных данных');
  });

  test('«Старт» посреди анкеты не уходит ответом на вопрос', async () => {
    await router.handle({ kind: 'start', ctx: ctx(ADMIN) });
    await router.handle(tap(CB.consentYes));
    tg.sent.length = 0;

    await router.handle(text('▶️ Старт'));

    expect(toAdmin()).not.toContain('Похоже, это не ФИО');
    expect(toAdmin()).toContain('согласие на обработку персональных данных');
  });
});

describe('диалог «Загрузить день»', () => {
  test('кнопка спрашивает номер дня, потом текст, потом сохраняет', async () => {
    await router.handle(text('/setday'));
    expect(await adminState()).toBe('setday:day');

    await router.handle(text('3'));
    expect(await adminState()).toBe('setday:text');

    await router.handle(text('Слово третьего дня'));
    const { rows } = await db.query('SELECT content FROM campaign_days WHERE day = 3');
    expect(rows[0]).toMatchObject({ content: 'Слово третьего дня' });
    expect(await adminState()).toBe('idle');
  });

  test('нажатие кнопки на клавиатуре начинает тот же диалог', async () => {
    // Служитель не набирает /setday, а жмёт кнопку: в Telegram это приходит текстом подписи.
    await router.handle(text('✏️ Загрузить день'));
    expect(await adminState()).toBe('setday:day');

    await router.handle(text('4'));
    await router.handle(text('Слово четвёртого дня'));
    const { rows } = await db.query('SELECT content FROM campaign_days WHERE day = 4');
    expect(rows[0]).toMatchObject({ content: 'Слово четвёртого дня' });
  });

  test('номер вне кампании переспрашивают, диалог не рвётся', async () => {
    await router.handle(text('/setday'));
    await router.handle(text('99'));
    expect(await adminState()).toBe('setday:day');
  });

  test('«Отмена» прекращает диалог, ничего не сохраняя', async () => {
    await router.handle(text('/setday'));
    await router.handle(text('3'));
    await router.handle(text('Отмена'));

    expect(await adminState()).toBe('idle');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM campaign_days');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('команда посреди диалога выполняется, а не пишется в материал дня', async () => {
    await router.handle(text('/setday'));
    await router.handle(text('/days'));

    expect(toAdmin()).toContain('день пока не загружен');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM campaign_days');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('команда с данными по-прежнему работает одной строкой', async () => {
    await router.handle(text('/setday 5 Материал пятого дня'));
    const { rows } = await db.query('SELECT content FROM campaign_days WHERE day = 5');
    expect(rows[0]).toMatchObject({ content: 'Материал пятого дня' });
    expect(await adminState()).toBe('idle');
  });
});


describe('массовые рассылки требуют подтверждения', () => {
  const twoParticipants = async () => {
    await seedUser(db, { id: '101' });
    await seedUser(db, { id: '102' });
  };

  test('«Объявление» спрашивает текст, затем подтверждение, и только потом отправляет', async () => {
    await twoParticipants();

    await router.handle(text('/broadcast'));
    expect(await adminState()).toBe('broadcast:text');

    await router.handle(text('Завтра сбор в 10:00'));
    expect(await adminState()).toBe('broadcast:confirm');
    expect(toAdmin()).toContain('2');
    expect(tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00')).toEqual([]);

    await router.handle(tap(`${ADMIN_CB}confirm`));
    const delivered = tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00').map((m) => m.chatId);
    expect(delivered.sort()).toEqual(['101', '102']);
    expect(await adminState()).toBe('idle');
  });

  test('кнопка «Объявление» начинает тот же диалог, что и команда', async () => {
    await twoParticipants();

    await router.handle(text('📣 Объявление'));
    expect(await adminState()).toBe('broadcast:text');

    await router.handle(text('Служение в субботу'));
    expect(await adminState()).toBe('broadcast:confirm');
    // Подтверждение обязательно и для кнопки: до нажатия «Отправить» никто не получил.
    expect(tg.sent.filter((m) => m.text === 'Служение в субботу')).toEqual([]);

    await router.handle(tap(`${ADMIN_CB}confirm`));
    expect(tg.sent.filter((m) => m.text === 'Служение в субботу').map((m) => m.chatId).sort())
      .toEqual(['101', '102']);
  });

  test('отчёт объясняет, что копия пришла служителю как участнику', async () => {
    // Служитель сам прошёл анкету, значит он в списке получателей.
    await seedUser(db, { id: ADMIN });
    await router.handle(text('/broadcast'));
    await router.handle(text('Завтра сбор в 10:00'));
    await router.handle(tap(`${ADMIN_CB}confirm`));

    expect(toAdmin()).toMatch(/копия/i);
  });

  test('служителю вне списка участников про копию не пишут', async () => {
    await seedUser(db, { id: '101' });
    await router.handle(text('/broadcast'));
    await router.handle(text('Завтра сбор в 10:00'));
    await router.handle(tap(`${ADMIN_CB}confirm`));

    expect(toAdmin()).not.toMatch(/копия/i);
  });

  test('отмена на подтверждении никому ничего не отправляет', async () => {
    await twoParticipants();
    await router.handle(text('/broadcast'));
    await router.handle(text('Завтра сбор в 10:00'));

    await router.handle(tap(`${ADMIN_CB}cancel`));

    expect(tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00')).toEqual([]);
    expect(await adminState()).toBe('idle');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM broadcasts');
    expect(rows[0]).toMatchObject({ n: 0 });
  });

  test('команда /broadcast тоже спрашивает подтверждение', async () => {
    await twoParticipants();
    await router.handle(text('/broadcast Завтра сбор в 10:00'));

    expect(tg.sent.filter((m) => m.text === 'Завтра сбор в 10:00')).toEqual([]);
    expect(await adminState()).toBe('broadcast:confirm');
  });

  test('«Отправить день сейчас» подтверждается и уходит участникам', async () => {
    await twoParticipants();
    await deps.campaign.setDay(7, 'Материал седьмого дня');

    await router.handle(text('/sendday'));
    await router.handle(text('7'));
    expect(await adminState()).toBe('sendday:confirm');

    await router.handle(tap(`${ADMIN_CB}confirm`));
    const delivered = tg.sent.filter((m) => m.text === 'Материал седьмого дня');
    expect(delivered).toHaveLength(2);
  });

  test('незагруженный день отправить нельзя', async () => {
    await twoParticipants();
    await router.handle(text('/sendday'));
    await router.handle(text('7'));

    expect(toAdmin()).toMatch(/не загружен/i);
    expect(await adminState()).toBe('sendday:day');
  });
});

describe('диалог служителя и его собственная анкета', () => {
  test('админский диалог не сбивает регистрацию служителя', async () => {
    await router.handle({ kind: 'start', ctx: ctx(ADMIN) });
    await router.handle(tap(CB.consentYes));

    // Служитель посреди своей анкеты нажал админскую кнопку.
    await router.handle(text('/setday'));
    await router.handle(text('3'));
    await router.handle(text('Слово третьего дня'));

    // Анкета ждёт там же, где и ждала: на вопросе про ФИО.
    const state = async () =>
      (
        await db.query(
          `SELECT s.state FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.platform_user_id = $1`,
          [ADMIN],
        )
      ).rows[0];
    expect(await state()).toMatchObject({ state: 'await_fio' });

    await router.handle(text('Петров Пётр Петрович'));
    expect(await state()).toMatchObject({ state: 'await_phone' });
  });

  test('после шага с телефоном клавиатура служителя возвращается', async () => {
    await router.handle({ kind: 'start', ctx: ctx(ADMIN) });
    await router.handle(tap(CB.consentYes));
    await router.handle(text('Петров Пётр Петрович'));
    const before = tg.actionMenus.length;

    await router.handle({ kind: 'contact', ctx: ctx(ADMIN), phone: '79001234567', isOwn: true });

    expect(tg.actionMenus.length).toBeGreaterThan(before);
  });
});
