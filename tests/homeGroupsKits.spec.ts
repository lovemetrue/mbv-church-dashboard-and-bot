import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { kitPayload } from '../src/core/qr.js';
import { createKits, kitSearchWords, parseKitCode } from '../src/home-groups/kits.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

describe('разбор того, что прочитал сканер', () => {
  test('понимает все три вида QR и номер, введённый руками', () => {
    // Карточка из Telegram: диплинк на бота; из MAX и ручной регистрации — только текст с номером.
    expect(parseKitCode(`https://t.me/church40bot?start=${kitPayload(1042)}`)).toBe(1042);
    expect(parseKitCode('Регистрация №1042')).toBe(1042);
    expect(parseKitCode('  регистрация № 7 ')).toBe(7);
    expect(parseKitCode('kit_15')).toBe(15);
    expect(parseKitCode('1042')).toBe(1042);
    expect(parseKitCode('№1042')).toBe(1042);
  });

  test('чужие QR и мусор номером не считаются', () => {
    expect(parseKitCode('https://mbv.spb.ru/?page=1042')).toBeNull();
    expect(parseKitCode('https://t.me/church40bot?start=kit_12abc')).toBeNull();
    expect(parseKitCode('WIFI:S:church;P:1042;;')).toBeNull();
    expect(parseKitCode('0')).toBeNull();
    expect(parseKitCode('12345678901')).toBeNull();
    expect(parseKitCode('')).toBeNull();
    expect(parseKitCode(1042)).toBeNull();
  });
});

describe('слова запроса для поиска по ФИО', () => {
  test('нижний регистр, «ё» как «е», лишние пробелы не мешают', () => {
    expect(kitSearchWords('  Королёв   ИВАН ')).toEqual(['королев', 'иван']);
  });

  test('короче трёх букв — пустой запрос, а не пол-списка', () => {
    expect(kitSearchWords('Ан')).toEqual([]);
    expect(kitSearchWords('  ')).toEqual([]);
    expect(kitSearchWords(null)).toEqual([]);
    expect(kitSearchWords('Ан Бо')).toEqual(['ан', 'бо']);
  });

  test('спецсимволы LIKE экранируются: «%» не находит всех подряд', () => {
    expect(kitSearchWords('%%%')).toEqual(['\\%\\%\\%']);
    expect(kitSearchWords('а_б')).toEqual(['а\\_б']);
  });
});

describe('выдача наборов', () => {
  let db: Pool;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => { await truncateAll(db); });

  const kits = () => createKits({ users: new UsersRepo(db), audit: new AuditRepo(db), timeZone: 'Europe/Moscow' });
  const register = (fio: string) => new UsersRepo(db).createManual({ fio, phone: '+79110001122', platform: 'telegram', byAdminId: 'x' });

  test('по QR находится участник с телефоном, набор ещё не выдан', async () => {
    const u = await register('Иван Петров');
    const out = await kits().find({ code: `Регистрация №${u.registration_no}` });
    expect(out).toEqual({
      ok: true,
      person: { userId: u.id, registrationNo: u.registration_no, fio: 'Иван Петров', phone: '+7 911 000-11-22', issuedAt: null, issuedBy: null },
    });
  });

  test('неизвестный номер и не-QR отвечают понятной ошибкой', async () => {
    expect(await kits().find({ code: '999' })).toMatchObject({ ok: false, error: 'not_found', message: 'Регистрации №999 нет.' });
    expect(await kits().find({ code: 'привет' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await kits().find(null)).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('выдача ставит дату и автора, повторная не перетирает первую', async () => {
    const u = await register('Иван Петров');
    const first = await kits().issue({ userId: u.id }, 'p_ivanova');
    expect(first).toMatchObject({ ok: true, changed: true, person: { issuedBy: 'p_ivanova', issuedAt: expect.any(String) } });
    const again = await kits().issue({ userId: u.id }, 'p_sidorov');
    expect(again).toMatchObject({ ok: true, changed: false, person: { issuedBy: 'p_ivanova' } });
    if (!first.ok || !again.ok) throw new Error('выдача не прошла');
    expect(again.person.issuedAt).toBe(first.person.issuedAt);
  });

  test('отмена снимает отметку; в журнале только номер регистрации, без имени и телефона', async () => {
    const u = await register('Иван Петров');
    await kits().issue({ userId: u.id }, 'p_ivanova');
    expect(await kits().undo({ userId: u.id }, 'p_ivanova')).toMatchObject({ ok: true, changed: true, person: { issuedAt: null, issuedBy: null } });
    expect(await kits().undo({ userId: u.id }, 'p_ivanova')).toMatchObject({ ok: true, changed: false });
    const { rows } = await db.query("SELECT actor, action, after::text AS after FROM audit_log WHERE action LIKE 'kit.%' ORDER BY id");
    expect(rows.map((r) => [r.actor, r.action, JSON.parse(r.after)])).toEqual([
      ['p_ivanova', 'kit.issue', { registrationNo: u.registration_no }],
      ['p_ivanova', 'kit.undo', { registrationNo: u.registration_no }],
    ]);
    expect(rows.map((r) => r.after).join()).not.toMatch(/Иван|911/);
  });

  test('выданное через бота видно как «бот», а не id служителя', async () => {
    const u = await register('Иван Петров');
    await new UsersRepo(db).markKitIssued(u.id, '27637540');
    expect(await kits().find({ code: String(u.registration_no) })).toMatchObject({ person: { issuedBy: 'бот' } });
  });

  test('без участника и с чужим id — ошибка, ничего не меняется', async () => {
    expect(await kits().issue({ userId: 'x' }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await kits().issue({ userId: 999 }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect((await db.query("SELECT 1 FROM audit_log WHERE action LIKE 'kit.%'")).rowCount).toBe(0);
  });

  test('поиск по ФИО: слова в любом порядке, «ё» не мешает, телефон только хвостом, видно, выдан ли набор', async () => {
    const a = await register('Иван Королёв');
    await register('Ивана Петрова');
    await new UsersRepo(db).createManual({ fio: 'Анна Королева', platform: 'telegram', byAdminId: 'x' });
    await kits().issue({ userId: a.id }, 'p');
    const out = await kits().search({ query: 'королев иван' });
    expect(out).toEqual({
      ok: true, more: false,
      items: [{ userId: a.id, registrationNo: a.registration_no, fio: 'Иван Королёв', phoneTail: '1122', issuedAt: expect.any(String) }],
    });
    const byLast = await kits().search({ query: 'Королев' });
    if (!byLast.ok) throw new Error('поиск не прошёл');
    expect(byLast.items.map((i) => [i.fio, i.phoneTail])).toEqual([['Анна Королева', null], ['Иван Королёв', '1122']]);
  });

  test('поиск: незарегистрированных нет в выдаче, «%» не находит всех, короткий запрос — ошибка', async () => {
    await register('Иван Петров');
    await db.query("INSERT INTO users (platform, platform_user_id, chat_id, full_name) VALUES ('telegram', '777', '777', 'Иван Незарегистрированный')");
    const out = await kits().search({ query: 'иван' });
    if (!out.ok) throw new Error('поиск не прошёл');
    expect(out.items.map((i) => i.fio)).toEqual(['Иван Петров']);
    expect(await kits().search({ query: '%%%' })).toEqual({ ok: true, items: [], more: false });
    expect(await kits().search({ query: 'Ив' })).toMatchObject({ ok: false, error: 'bad_request', message: 'Введите хотя бы 3 буквы имени или фамилии.' });
  });

  test('поиск: больше десяти совпадений — показаны десять и признак «уточните»', async () => {
    for (let i = 0; i < 11; i++) await register(`Иванов ${i}`);
    const out = await kits().search({ query: 'иванов' });
    if (!out.ok) throw new Error('поиск не прошёл');
    expect(out.items).toHaveLength(10);
    expect(out.more).toBe(true);
  });

  test('счётчики: всего, выдано и выдано сегодня по Москве; последние выдачи свежие сверху', async () => {
    const a = await register('Анна');
    const b = await register('Борис');
    await register('Вера');
    await kits().issue({ userId: a.id }, 'p');
    await kits().issue({ userId: b.id }, 'p');
    // Выдача позавчера: в «всего» входит, в «сегодня» — нет.
    await db.query("UPDATE users SET kit_issued_at = now() - interval '2 days' WHERE id = $1", [a.id]);
    const view = await kits().view();
    expect(view).toMatchObject({ registered: 3, issued: 2, issuedToday: 1 });
    expect(view.recent.map((p) => p.fio)).toEqual(['Борис', 'Анна']);
  });
});
