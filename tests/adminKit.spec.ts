import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { Router } from '../src/core/router.js';
import { createDeps, type Deps } from '../src/deps.js';
import { ADMIN_CB } from '../src/admin/menu.js';
import { kitPayload } from '../src/core/qr.js';
import type { IncomingUpdate, PlatformName, Platform, UpdateCtx } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;
let router: Router;

const ADMIN = '999';
const USER = '555';

const ctx = (id: string): UpdateCtx => ({ platform: 'telegram', platformUserId: id, chatId: id });
const text = (t: string, id = ADMIN): IncomingUpdate => ({ kind: 'text', ctx: ctx(id), text: t });
const tap = (data: string, id = ADMIN): IncomingUpdate => ({ kind: 'callback', ctx: ctx(id), data, callbackId: 'cb' });
const startWith = (payload: string, id = ADMIN): IncomingUpdate => ({ kind: 'start', ctx: ctx(id), payload });

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

/** Заводит участника с присвоенным номером регистрации. */
async function seedRegistered(no: number, fio = 'Иванов Иван Иванович', platformUserId = USER): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (platform, platform_user_id, chat_id, phone, full_name, church, mdg_status,
                        registration_no, complete, registered_at)
     VALUES ('telegram', $1, $1, '+79001234567', $2, 'МБВ (Колизей)', 'member', $3, true, now())
     RETURNING id`,
    [platformUserId, fio, no],
  );
  return rows[0]!.id;
}

describe('выдача набора служителем', () => {
  test('по номеру регистрации набор отмечается выданным', async () => {
    const userId = await seedRegistered(42);

    await router.handle(text('/kit'));
    await router.handle(text('42'));

    const { rows } = await db.query('SELECT kit_issued_at, kit_issued_by FROM users WHERE id = $1', [userId]);
    expect(rows[0]).toMatchObject({ kit_issued_by: ADMIN });
    expect((rows[0] as { kit_issued_at: Date }).kit_issued_at).toBeInstanceOf(Date);
    expect(toAdmin()).toContain('Иванов Иван Иванович');
  });

  test('кнопка на клавиатуре начинает тот же диалог, что и команда', async () => {
    const userId = await seedRegistered(43);

    // Служитель жмёт кнопку: в Telegram это приходит текстом подписи.
    await router.handle(text('📦 Выдать набор'));
    expect(toAdmin()).toContain('Номер регистрации или ФИО');

    await router.handle(text('43'));
    const { rows } = await db.query('SELECT kit_issued_by FROM users WHERE id = $1', [userId]);
    expect(rows[0]).toMatchObject({ kit_issued_by: ADMIN });
  });

  test('QR-код участника сразу отмечает выдачу', async () => {
    const userId = await seedRegistered(7);

    // Служитель навёл камеру на QR: бот открывается ссылкой с payload.
    await router.handle(startWith(kitPayload(7)));

    const { rows } = await db.query('SELECT kit_issued_at FROM users WHERE id = $1', [userId]);
    expect((rows[0] as { kit_issued_at: Date | null }).kit_issued_at).toBeInstanceOf(Date);
  });

  test('обычный участник по QR-ссылке набор себе не выдаст', async () => {
    const userId = await seedRegistered(7, 'Иванов Иван', '777');

    await router.handle(startWith(kitPayload(7), '777'));

    const { rows } = await db.query('SELECT kit_issued_at FROM users WHERE id = $1', [userId]);
    expect((rows[0] as { kit_issued_at: Date | null }).kit_issued_at).toBeNull();
  });

  test('повторная выдача сообщает, что набор уже получен', async () => {
    await seedRegistered(42);
    await router.handle(text('/kit'));
    await router.handle(text('42'));
    await router.handle(text('/kit'));
    await router.handle(text('42'));

    expect(toAdmin()).toMatch(/уже (выдан|получил)/i);
  });

  test('неизвестный номер не выдаёт ничего и не рвёт диалог', async () => {
    await router.handle(text('/kit'));
    await router.handle(text('404'));

    expect(toAdmin()).toMatch(/не найден/i);
  });

  test('поиск по ФИО находит участника', async () => {
    const userId = await seedRegistered(15, 'Петров Пётр Петрович');

    await router.handle(text('/kit'));
    await router.handle(text('Петров'));

    const { rows } = await db.query('SELECT kit_issued_at FROM users WHERE id = $1', [userId]);
    expect((rows[0] as { kit_issued_at: Date | null }).kit_issued_at).toBeInstanceOf(Date);
  });

  test('если по ФИО нашлось несколько, служителю показывают список', async () => {
    await seedRegistered(1, 'Иванов Иван', '101');
    await seedRegistered(2, 'Иванов Пётр', '102');

    await router.handle(text('/kit'));
    await router.handle(text('Иванов'));

    expect(toAdmin()).toContain('Иванов Иван');
    expect(toAdmin()).toContain('Иванов Пётр');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE kit_issued_at IS NOT NULL`);
    expect(rows[0]).toMatchObject({ n: 0 });
  });
});

