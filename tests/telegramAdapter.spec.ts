import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { TelegramAdapter } from '../src/adapters/telegram.adapter.js';
import { Router } from '../src/core/router.js';
import { CB } from '../src/core/texts.js';
import { createDeps } from '../src/deps.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { startFakeTelegram, tgUpdate, type FakeTelegram } from './helpers/fakeTelegramApi.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Сквозной прогон через настоящий стек grammY: подставной Bot API на localhost,
 * реальный polling, реальный разбор апдейтов, реальная база.
 * Это проверяет прослойку адаптера, которую не видят тесты роутера.
 */

let db: Pool;
let api: FakeTelegram;
let adapter: TelegramAdapter;
let processed: number;
let waiters: (() => void)[];

const USER = 555;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
  processed = 0;
  waiters = [];
  api = await startFakeTelegram();
  adapter = new TelegramAdapter('123456:TEST', undefined, { apiRoot: api.apiRoot });

  const platforms = new Map<PlatformName, Platform>([['telegram', adapter]]);
  const deps = createDeps({
    db,
    platforms,
    admins: new Map([['telegram', ['999']]]),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
  });
  const router = new Router(deps);

  adapter.onUpdate(async (update) => {
    await router.handle(update);
    processed += 1;
    waiters.splice(0).forEach((resolve) => resolve());
  });

  await adapter.start();
});

afterEach(async () => {
  await adapter.stop();
  await api.close();
});

/** Ждёт, пока бот обработает заданное число апдейтов. */
async function waitProcessed(count: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processed < count) {
    if (Date.now() > deadline) throw new Error(`обработано ${processed} апдейтов из ${count}`);
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
      setTimeout(resolve, 50);
    });
  }
}

const sentTexts = () => api.callsOf('sendMessage').map((b) => String(b['text'] ?? ''));
const lastMarkup = () => {
  const calls = api.callsOf('sendMessage');
  const raw = calls.at(-1)?.['reply_markup'];
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown> | undefined);
};

describe('сквозной прогон через настоящий Telegram-стек', () => {
  test('бот проверяет токен при старте', () => {
    expect(api.callsOf('getMe')).toHaveLength(1);
  });

  test('/start показывает согласие на обработку данных со ссылками', async () => {
    api.push(tgUpdate.command(1, USER, '/start'));
    await waitProcessed(1);

    expect(sentTexts().join('\n')).toContain('mbv.spb.ru');
    const rows = lastMarkup()?.['inline_keyboard'] as { callback_data: string }[][];
    expect(rows.flat().map((b) => b.callback_data)).toContain(CB.consentYes);
  });

  test('после согласия и ФИО приходит кнопка «поделиться номером»', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
    );
    await waitProcessed(3);

    const keyboard = lastMarkup()?.['keyboard'] as { text: string; request_contact?: boolean }[][];
    expect(keyboard[0]?.[0]?.request_contact).toBe(true);
  });

  /** Черновик анкеты до её завершения: лежит в sessions, а не в users. */
  const draft = async (): Promise<Record<string, unknown>> => {
    const { rows } = await db.query(
      `SELECT s.state, s.data FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.platform_user_id = $1`,
      [String(USER)],
    );
    return rows[0] ?? {};
  };

  test('присланный контакт сохраняется и бот переходит к вопросу про церковь', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+7 900 123-45-67'),
    );
    await waitProcessed(4);

    const session = await draft();
    expect(session['state']).toBe('await_church');
    expect(session['data']).toMatchObject({ phone: '+79001234567' });
  });

  test('чужой контакт не принимается', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79007654321', 12345),
    );
    await waitProcessed(4);

    const session = await draft();
    expect(session['state']).toBe('await_phone');
    expect(session['data']).not.toHaveProperty('phone');
  });

  test('вся анкета проходится настоящими апдейтами до номера регистрации', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79001234567'),
      tgUpdate.callback(5, USER, 'church:0'),
      tgUpdate.callback(6, USER, CB.mdgLeader),
      tgUpdate.callback(7, USER, CB.confirm),
    );
    await waitProcessed(7);

    const { rows } = await db.query('SELECT * FROM users WHERE platform_user_id = $1', [String(USER)]);
    expect(rows[0]).toMatchObject({
      phone: '+79001234567',
      full_name: 'Иванов Иван Иванович',
      church: 'МБВ Колизей',
      mdg_status: 'leader',
      complete: true,
      username: 'ivan',
    });
    expect(rows[0].registration_no).toBeGreaterThanOrEqual(1000);
    expect(rows[0].registration_no).toBeLessThanOrEqual(9999);
  });

  test('QR-код с номером регистрации уходит настоящей картинкой', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79001234567'),
      tgUpdate.callback(5, USER, 'church:0'),
      tgUpdate.callback(6, USER, CB.mdgLeader),
      tgUpdate.callback(7, USER, CB.confirm),
    );
    await waitProcessed(7);

    expect(api.callsOf('sendPhoto')).toHaveLength(1);
  });

  test('нажатие кнопки подтверждается через answerCallbackQuery', async () => {
    api.push(tgUpdate.command(1, USER, '/start'), tgUpdate.callback(2, USER, CB.consentYes, 'cb-777'));
    await waitProcessed(2);

    expect(api.callsOf('answerCallbackQuery').map((b) => b['callback_query_id'])).toContain('cb-777');
  });

  test('меню участника приходит инлайн-кнопками с нужными данными', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79001234567'),
      tgUpdate.callback(5, USER, 'church:0'),
      tgUpdate.callback(6, USER, CB.mdgLeader),
      tgUpdate.callback(7, USER, CB.confirm),
      tgUpdate.command(8, USER, '/menu'),
    );
    await waitProcessed(8);

    const rows = lastMarkup()?.['inline_keyboard'] as { callback_data: string }[][];
    const data = rows.flat().map((b) => b.callback_data);
    expect(data).toEqual([CB.menuStatus]);
  });

  test('выгрузка участников уходит админу настоящим документом', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79001234567'),
      tgUpdate.callback(5, USER, 'church:0'),
      tgUpdate.callback(6, USER, CB.mdgLeader),
      tgUpdate.callback(7, USER, CB.confirm),
      tgUpdate.command(8, 999, '/export'),
    );
    await waitProcessed(8);

    expect(api.callsOf('sendDocument')).toHaveLength(1);
  });

  test('обычный участник не получает выгрузку', async () => {
    api.push(tgUpdate.command(1, USER, '/start'), tgUpdate.command(2, USER, '/export'));
    await waitProcessed(2);

    expect(api.callsOf('sendDocument')).toHaveLength(0);
  });

  test('QR-ссылка выдаёт набор, когда её открывает служитель', async () => {
    api.push(
      tgUpdate.command(1, USER, '/start'),
      tgUpdate.callback(2, USER, CB.consentYes),
      tgUpdate.command(3, USER, 'Иванов Иван Иванович'),
      tgUpdate.contact(4, USER, '+79001234567'),
      tgUpdate.callback(5, USER, 'church:0'),
      tgUpdate.callback(6, USER, CB.mdgLeader),
      tgUpdate.callback(7, USER, CB.confirm),
    );
    await waitProcessed(7);

    // Номер теперь случайный: узнаём его из базы, а не подставляем заранее.
    const before = await db.query<{ registration_no: number }>(
      'SELECT registration_no FROM users WHERE platform_user_id = $1', [String(USER)],
    );
    const no = before.rows[0]!.registration_no;

    // Служитель навёл камеру на QR участника: открывается бот со ссылкой.
    api.push(tgUpdate.command(8, 999, `/start kit_${no}`));
    await waitProcessed(8);

    const { rows } = await db.query('SELECT kit_issued_at FROM users WHERE registration_no = $1', [no]);
    expect((rows[0] as { kit_issued_at: Date | null }).kit_issued_at).toBeInstanceOf(Date);
  });
});
