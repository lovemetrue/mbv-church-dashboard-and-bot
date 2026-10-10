import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { StaffRepo } from '../src/db/repos/staff.repo.js';
import { PersonalAuth } from '../src/platform/auth/personalAuth.js';
import { hashToken } from '../src/platform/auth/password.js';
import { createStaffService, RESET_PER_HOUR } from '../src/platform/auth/staffService.js';
import type { MailMessage, Mailer } from '../src/platform/mail/mailer.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

function memoryStore(): SessionStore {
  const data = new Map<string, string>();
  return {
    async set(k, v) { data.set(k, v); }, async get(k) { return data.get(k) ?? null; }, async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
}

function recordingMailer(opts: { fail?: boolean } = {}): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { configured: true, sent, async send(m) { if (opts.fail) throw new Error('SMTP недоступен'); sent.push(m); } };
}
const noMail: Mailer = { configured: false, async send() { throw new Error('нет'); } };

function setup(over: { mailer?: Mailer; publicUrl?: string | null } = {}) {
  const store = memoryStore();
  const staff = new StaffRepo(db);
  const settings = new SettingsRepo(db);
  const reported: string[] = [];
  const service = createStaffService({
    staff, settings, store, mailer: over.mailer ?? noMail,
    publicUrl: over.publicUrl === undefined ? 'https://hg.example' : over.publicUrl,
    reportError: (_s, err) => { reported.push(err instanceof Error ? err.message : String(err)); },
  });
  const session = new SessionService(store, { password: 'общий-обычный-пароль', login: 'mbv_admin', superPassword: 'общий-полный-пароль', superLogin: 'super_mbv_admin', ttlSeconds: 600, maxAttempts: 5 });
  const auth = new PersonalAuth(session, store, staff, settings, { sharedLogin: 'mbv_admin', sharedSuperLogin: 'super_mbv_admin', maxAttempts: 3, cacheMs: 0 });
  return { store, staff, settings, service, session, auth, reported, mailer: over.mailer };
}
type Ctx = ReturnType<typeof setup>;

const tokenFrom = (path: string | undefined): string => new URL(`http://x${path}`).searchParams.get('token')!;
const POLINA = { fullName: 'Полина Иванова', email: 'polina@church.example', role: 'admin' as const };
const PASSWORD = 'сиреневый-туман-42';

/** Завести человека и сразу задать ему пароль — как после перехода по ссылке. */
async function activePerson(c: Ctx, over: Partial<typeof POLINA> & { login?: string } = {}) {
  const made = await c.service.create({ ...POLINA, ...over }, 'super_mbv_admin');
  if (!made.ok) throw new Error(made.message);
  // Письмо ушло — токен берём из него, иначе ссылка пришла на экран.
  const sent = (c.mailer as ReturnType<typeof recordingMailer> | undefined)?.sent;
  const token = made.path ? tokenFrom(made.path) : new URL(/https:\/\/\S+/.exec(sent!.at(-1)!.text)![0]).searchParams.get('token')!;
  const done = await c.service.completePassword(token, PASSWORD, PASSWORD, '1.1.1.1');
  expect(done).toEqual({ ok: true });
  return made;
}

describe('заведение человека', () => {
  test('логин подбирается по ФИО, ссылка на пароль выдаётся, пароля у человека ещё нет', async () => {
    const c = setup();
    const r = await c.service.create(POLINA, 'super_mbv_admin');
    expect(r).toMatchObject({ ok: true, login: 'p_ivanova', delivery: 'link', email: 'polina@church.example' });
    const row = await c.staff.byLogin('p_ivanova');
    expect(row).toMatchObject({ role: 'admin', active: true, password_hash: null, created_at: expect.any(Date) });
    const view = await c.service.view();
    expect(view.items[0]).toMatchObject({ login: 'p_ivanova', status: 'invited', hasPendingLink: true, lastLoginAt: null });
  });

  test('второй человек с тем же именем получает логин с цифрой', async () => {
    const c = setup();
    await c.service.create(POLINA, 'a');
    const r = await c.service.create({ ...POLINA, email: 'other@church.example' }, 'a');
    expect(r).toMatchObject({ ok: true, login: 'p_ivanova2' });
  });

  test('логин можно задать вручную: приводится к нижнему регистру, неподходящий отклоняется', async () => {
    const c = setup();
    expect(await c.service.create({ ...POLINA, login: 'Polina.I' }, 'a')).toMatchObject({ ok: true, login: 'polina.i' });
    const bad = await c.service.create({ ...POLINA, email: 'x@church.example', login: 'я плохой' }, 'a');
    expect(bad).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('занятые почта и логин — conflict, и ничего не создаётся', async () => {
    const c = setup();
    await c.service.create(POLINA, 'a');
    expect(await c.service.create({ ...POLINA, fullName: 'Другая Особа', login: 'novyj' }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await c.service.create({ ...POLINA, email: 'POLINA@CHURCH.EXAMPLE', fullName: 'Иная Особа' }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await c.service.create({ ...POLINA, email: 'new@church.example', login: 'P_IVANOVA' }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
    expect((await c.service.view()).items).toHaveLength(1);
  });

  test.each([
    [{ ...POLINA, fullName: ' ' }, 'ФИО'],
    [{ ...POLINA, email: 'не-почта' }, 'почту'],
    [{ ...POLINA, role: 'root' }, 'Роль'],
    [{ ...POLINA, fullName: 'Полина' }, 'через пробел'],
    [null, 'Нужны'],
  ])('некорректные данные %j отклоняются (%s)', async (body, fragment) => {
    const c = setup();
    const r = await c.service.create(body, 'a');
    expect(r).toMatchObject({ ok: false, error: 'bad_request' });
    expect((r as { message: string }).message).toContain(fragment);
    expect((await c.service.view()).items).toHaveLength(0);
  });

  test('подсказка логина совпадает с тем, что подберёт заведение', async () => {
    const c = setup();
    expect(await c.service.suggestLogin({ fullName: 'Полина Иванова' })).toEqual({ ok: true, login: 'p_ivanova' });
    await c.service.create(POLINA, 'a');
    expect(await c.service.suggestLogin({ fullName: 'Полина Иванова' })).toEqual({ ok: true, login: 'p_ivanova2' });
  });
});

describe('доставка ссылки', () => {
  test('почта настроена: письмо уходит на адрес человека, ссылка в письме, на экран ссылка не возвращается', async () => {
    const mailer = recordingMailer();
    const c = setup({ mailer });
    const r = await c.service.create(POLINA, 'a');
    expect(r).toMatchObject({ ok: true, delivery: 'sent', email: 'polina@church.example' });
    expect((r as { path?: string }).path).toBeUndefined();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'polina@church.example', subject: 'Домашние группы: задайте пароль' });
    expect(mailer.sent[0]!.text).toContain('https://hg.example/set-password?token=');
    expect(mailer.sent[0]!.text).toContain('p_ivanova');
  });

  test('публичный адрес не задан: письмо не отправляется, ссылка показывается на экране', async () => {
    const mailer = recordingMailer();
    const c = setup({ mailer, publicUrl: null });
    const r = await c.service.create(POLINA, 'a');
    expect(r).toMatchObject({ ok: true, delivery: 'link' });
    expect(mailer.sent).toHaveLength(0);
  });

  test('письмо не ушло (почта сломана): человек всё равно заведён, ссылка не теряется, ошибка в журнале', async () => {
    const c = setup({ mailer: recordingMailer({ fail: true }) });
    const r = await c.service.create(POLINA, 'a');
    expect(r).toMatchObject({ ok: true, delivery: 'link' });
    expect(tokenFrom((r as { path?: string }).path)).toBeTruthy();
    expect(c.reported).toEqual(['SMTP недоступен']);
  });

  test('в базе лежит только хеш токена, а не сам токен', async () => {
    const c = setup();
    const r = await c.service.create(POLINA, 'a');
    const token = tokenFrom((r as { path?: string }).path);
    const rows = (await db.query('SELECT token_hash FROM staff_tokens')).rows;
    expect(rows).toEqual([{ token_hash: hashToken(token) }]);
    expect(JSON.stringify((await db.query('SELECT * FROM audit_log')).rows)).not.toContain(token);
  });

  test('новая ссылка гасит прежнюю: старое письмо перестаёт работать', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const first = tokenFrom((made as { path?: string }).path);
    const again = await c.service.invite({ id: (made as { id?: number }).id }, 'a');
    const second = tokenFrom((again as { path?: string }).path);
    expect(await c.service.tokenInfo(first)).toBeNull();
    expect(await c.service.tokenInfo(second)).toMatchObject({ login: 'p_ivanova', fullName: 'Полина Иванова' });
  });

  test('приглашение тому, кто уже задал пароль, отклоняется; сбросить ему можно', async () => {
    const c = setup();
    const made = await activePerson(c);
    expect(await c.service.invite({ id: made.id }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await c.service.reset({ id: made.id }, 'a')).toMatchObject({ ok: true, delivery: 'link' });
  });

  test('отключённому человеку ссылки не выдаются', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    await c.service.update({ id: made.id, active: false }, 'a');
    expect(await c.service.invite({ id: made.id }, 'a')).toMatchObject({ ok: false });
    expect(await c.service.reset({ id: made.id }, 'a')).toMatchObject({ ok: false });
  });

  test('ссылка отключённого человека не работает', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const token = tokenFrom((made as { path?: string }).path);
    await c.service.update({ id: made.id, active: false }, 'a');
    expect(await c.service.tokenInfo(token)).toBeNull();
    expect(await c.service.completePassword(token, PASSWORD, PASSWORD, '2.2.2.2')).toMatchObject({ ok: false });
  });
});

describe('задание пароля по ссылке', () => {
  test('человек сам задаёт пароль: хеш сохранён, статус «активен», ссылка одноразовая', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const token = tokenFrom((made as { path?: string }).path);
    expect(await c.service.completePassword(token, PASSWORD, PASSWORD, '1.1.1.1')).toEqual({ ok: true });
    const row = await c.staff.byLogin('p_ivanova');
    expect(row!.password_hash).toMatch(/^scrypt\$/);
    expect(row!.password_hash).not.toContain(PASSWORD);
    expect((await c.service.view()).items[0]).toMatchObject({ status: 'active', hasPendingLink: false });
    // Повторно по той же ссылке нельзя.
    expect(await c.service.completePassword(token, 'другой-пароль-12345', 'другой-пароль-12345', '1.1.1.1')).toMatchObject({ ok: false });
  });

  test.each([
    ['несовпадение', 'сиреневый-туман-42', 'сиреневый-туман-43', 'не совпадают'],
    ['короткий', 'короткий1', 'короткий1', 'короткий'],
    ['только цифры', '12345678901234', '12345678901234', 'цифр'],
  ])('слабый или неверный ввод (%s) пароль не меняет и ссылку не тратит', async (_n, a, b, fragment) => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const token = tokenFrom((made as { path?: string }).path);
    const r = await c.service.completePassword(token, a, b, '1.1.1.1');
    expect(r).toMatchObject({ ok: false, error: 'bad_request' });
    expect((r as { message: string }).message).toContain(fragment);
    expect((await c.staff.byLogin('p_ivanova'))!.password_hash).toBeNull();
    expect(await c.service.tokenInfo(token)).not.toBeNull();
  });

  test('просроченная ссылка не работает', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const token = tokenFrom((made as { path?: string }).path);
    await db.query(`UPDATE staff_tokens SET expires_at = now() - interval '1 minute'`);
    expect(await c.service.tokenInfo(token)).toBeNull();
    expect(await c.service.completePassword(token, PASSWORD, PASSWORD, '1.1.1.1')).toMatchObject({ ok: false });
  });

  test.each(['', 'мусор', 'x'.repeat(500)])('негодный токен «%s» отклоняется без обращения к базе паролей', async (token) => {
    const c = setup();
    expect(await c.service.tokenInfo(token)).toBeNull();
    expect(await c.service.completePassword(token, PASSWORD, PASSWORD, '1.1.1.1')).toMatchObject({ ok: false });
  });

  test('два одновременных нажатия по одной ссылке задают пароль один раз', async () => {
    const c = setup();
    const made = await c.service.create(POLINA, 'a');
    const token = tokenFrom((made as { path?: string }).path);
    const results = await Promise.all([
      c.service.completePassword(token, PASSWORD, PASSWORD, '1.1.1.1'),
      c.service.completePassword(token, 'иной-пароль-12345', 'иной-пароль-12345', '1.1.1.2'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test('слишком много попыток с одного адреса блокируются', async () => {
    const c = setup();
    let last: unknown;
    for (let i = 0; i < 31; i += 1) last = await c.service.completePassword('мусор', PASSWORD, PASSWORD, '9.9.9.9');
    expect(last).toMatchObject({ ok: false, message: expect.stringContaining('Слишком много') });
  });

  test('в журнале есть создание, приглашение и задание пароля — без почты и пароля', async () => {
    const c = setup();
    await activePerson(c);
    const rows = (await db.query(`SELECT action, actor FROM audit_log WHERE entity_type = 'staff' ORDER BY id`)).rows;
    expect(rows.map((r) => r.action)).toEqual(['staff.create', 'staff.invite', 'staff.password_set']);
    const dump = JSON.stringify((await db.query('SELECT * FROM audit_log')).rows);
    expect(dump).not.toContain('polina@church.example');
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('scrypt');
  });
});

describe('«забыли пароль»', () => {
  const polinaWithMail = async () => {
    const mailer = recordingMailer();
    const c = setup({ mailer });
    await activePerson(c);
    mailer.sent.length = 0;
    return { c, mailer };
  };

  test('по логину и по почте (в любом регистре) известному человеку уходит письмо со ссылкой', async () => {
    const { c, mailer } = await polinaWithMail();
    await c.service.requestReset('p_ivanova', '3.3.3.3');
    await c.service.requestReset('POLINA@church.example', '3.3.3.3');
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]).toMatchObject({ to: 'polina@church.example', subject: 'Домашние группы: смена пароля' });
  });

  test('неизвестному логину ничего не уходит и ошибки не видно', async () => {
    const { c, mailer } = await polinaWithMail();
    await expect(c.service.requestReset('nobody', '3.3.3.3')).resolves.toBeUndefined();
    await expect(c.service.requestReset('', '3.3.3.3')).resolves.toBeUndefined();
    await expect(c.service.requestReset('я'.repeat(300), '3.3.3.3')).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(0);
  });

  test('отключённому человеку письмо не уходит', async () => {
    const { c, mailer } = await polinaWithMail();
    const row = await c.staff.byLogin('p_ivanova');
    await c.service.update({ id: row!.id, active: false }, 'super_mbv_admin');
    await c.service.requestReset('p_ivanova', '3.3.3.3');
    expect(mailer.sent).toHaveLength(0);
  });

  test(`не больше ${RESET_PER_HOUR} писем в час на одного человека`, async () => {
    const { c, mailer } = await polinaWithMail();
    for (let i = 0; i < 6; i += 1) await c.service.requestReset('p_ivanova', `4.4.4.${i}`);
    expect(mailer.sent.length).toBe(RESET_PER_HOUR - 1);
  });

  test('не больше десяти запросов в час с одного адреса, даже по разным людям', async () => {
    const mailer = recordingMailer();
    const c = setup({ mailer });
    const logins: string[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const made = await activePerson(c, { fullName: `Имя Фамилия${'абвгдежзиклмн'[i]}`, email: `p${i}@church.example` });
      logins.push(made.login as string);
    }
    mailer.sent.length = 0;
    for (const login of logins) await c.service.requestReset(login, '5.5.5.5');
    expect(mailer.sent).toHaveLength(10);
  });

  test('почта не настроена: письма нет, а просьба остаётся в журнале для администратора', async () => {
    const c = setup();
    await activePerson(c);
    await c.service.requestReset('p_ivanova', '6.6.6.6');
    const rows = (await db.query(`SELECT action, actor FROM audit_log WHERE action = 'staff.reset_requested_no_mail'`)).rows;
    expect(rows).toEqual([{ action: 'staff.reset_requested_no_mail', actor: 'p_ivanova' }]);
  });

  test('сброс по ссылке меняет пароль, а прежние входы закрываются', async () => {
    const mailer = recordingMailer();
    const c = setup({ mailer });
    await activePerson(c);
    await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin');
    const old = await c.auth.login(PASSWORD, '7.7.7.7', 'p_ivanova');
    expect(old.ok).toBe(true);
    mailer.sent.length = 0;
    await c.service.requestReset('p_ivanova', '7.7.7.7');
    const token = new URL(/https:\/\/\S+/.exec(mailer.sent[0]!.text)![0]).searchParams.get('token')!;
    expect(await c.service.completePassword(token, 'новый-сложный-пароль-7', 'новый-сложный-пароль-7', '7.7.7.7')).toEqual({ ok: true });
    expect(await c.auth.verify(old.sid)).toBe(false);
    expect((await c.auth.login(PASSWORD, '7.7.7.8', 'p_ivanova')).ok).toBe(false);
    expect((await c.auth.login('новый-сложный-пароль-7', '7.7.7.8', 'p_ivanova')).ok).toBe(true);
  });
});

describe('включение личных входов', () => {
  test('пока никто не задал пароль, включить нельзя', async () => {
    const c = setup();
    await c.service.create(POLINA, 'a');
    expect(await c.service.setPersonalMode({ enabled: true }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await c.service.personalState())).toMatchObject({ enabled: false, canEnable: false, activeWithPassword: 0 });
  });

  test('после того как пароль задан, включение проходит и пишется в журнал', async () => {
    const c = setup();
    await activePerson(c);
    expect(await c.service.personalState()).toMatchObject({ canEnable: true, activeWithPassword: 1 });
    expect(await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin')).toEqual({ ok: true });
    expect((await c.service.personalState()).enabled).toBe(true);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'auth.personal_on'`)).rowCount).toBe(1);
    expect(await c.service.setPersonalMode({ enabled: false }, 'super_mbv_admin')).toEqual({ ok: true });
    expect((await c.service.personalState()).enabled).toBe(false);
  });

  test('некорректное значение отклоняется', async () => {
    const c = setup();
    for (const body of [null, {}, { enabled: 'да' }]) expect(await c.service.setPersonalMode(body, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('почта «настроена» только когда есть и отправитель, и публичный адрес', async () => {
    expect((await setup({ mailer: recordingMailer() }).service.personalState()).mailConfigured).toBe(true);
    expect((await setup({ mailer: recordingMailer(), publicUrl: null }).service.personalState()).mailConfigured).toBe(false);
    expect((await setup().service.personalState()).mailConfigured).toBe(false);
  });
});

describe('правка и отключение', () => {
  test('роль, имя и почта меняются; отключение закрывает вход сразу, включение возвращает', async () => {
    const c = setup();
    const made = await activePerson(c);
    // Второй действующий человек нужен, иначе отключить последнего нельзя (отдельная проверка ниже).
    await activePerson(c, { fullName: 'Пётр Сидоров', email: 'petr@church.example' });
    await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin');
    const login = await c.auth.login(PASSWORD, '8.8.8.8', 'p_ivanova');
    expect(await c.auth.roleOf(login.sid)).toBe('admin');

    await c.service.update({ id: made.id, role: 'super' }, 'super_mbv_admin');
    expect(await c.auth.verify(login.sid)).toBe(false);
    const again = await c.auth.login(PASSWORD, '8.8.8.8', 'p_ivanova');
    expect(await c.auth.roleOf(again.sid)).toBe('super');

    await c.service.update({ id: made.id, active: false }, 'super_mbv_admin');
    expect(await c.auth.verify(again.sid)).toBe(false);
    expect((await c.auth.login(PASSWORD, '8.8.8.9', 'p_ivanova')).ok).toBe(false);
    await c.service.update({ id: made.id, active: true }, 'super_mbv_admin');
    expect((await c.auth.login(PASSWORD, '8.8.8.9', 'p_ivanova')).ok).toBe(true);
  });

  test('самого себя отключить или понизить нельзя', async () => {
    const c = setup();
    const made = await activePerson(c, { role: 'super' });
    expect(await c.service.update({ id: made.id, active: false }, 'p_ivanova')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await c.service.update({ id: made.id, role: 'admin' }, 'P_IVANOVA')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await c.service.update({ id: made.id, fullName: 'Полина Новая' }, 'p_ivanova')).toEqual({ ok: true });
  });

  test('при включённых личных входах последнего действующего пользователя отключить нельзя', async () => {
    const c = setup();
    const made = await activePerson(c);
    await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin');
    expect(await c.service.update({ id: made.id, active: false }, 'super_mbv_admin')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await c.staff.byId(made.id as number))!.active).toBe(true);
  });

  test('почта, занятая другим, — conflict; неизвестный пользователь — not_found', async () => {
    const c = setup();
    await activePerson(c);
    const other = await c.service.create({ fullName: 'Пётр Сидоров', email: 'petr@church.example', role: 'admin' }, 'a');
    expect(await c.service.update({ id: other.id, email: 'polina@church.example' }, 'a')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await c.service.update({ id: 99999, active: false }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('журнал правки хранит факт изменения, а не новую почту', async () => {
    const c = setup();
    const made = await activePerson(c);
    await c.service.update({ id: made.id, email: 'new@church.example', role: 'super' }, 'super_mbv_admin');
    const dump = JSON.stringify((await db.query(`SELECT after FROM audit_log WHERE action = 'staff.update'`)).rows);
    expect(dump).toContain('"email":true');
    expect(dump).not.toContain('new@church.example');
  });
});

describe('вход', () => {
  async function personal(c: Ctx) {
    await activePerson(c);
    await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin');
  }

  test('пока личные входы выключены, работают только общие, личный логин не пускает', async () => {
    const c = setup();
    await activePerson(c);
    expect((await c.auth.login(PASSWORD, '1.2.3.4', 'p_ivanova')).ok).toBe(false);
    const shared = await c.auth.login('общий-обычный-пароль', '1.2.3.4', 'mbv_admin');
    expect(shared).toMatchObject({ ok: true, role: 'admin' });
    expect(await c.auth.verify(shared.sid)).toBe(true);
    expect(await c.auth.identityOf(shared.sid)).toBeNull();
  });

  test('после включения человек входит под своим логином с ролью из базы, а в журнале виден его логин', async () => {
    const c = setup();
    await personal(c);
    const r = await c.auth.login(PASSWORD, '1.2.3.4', 'p_ivanova');
    expect(r).toMatchObject({ ok: true, role: 'admin' });
    expect(await c.auth.verify(r.sid)).toBe(true);
    expect(await c.auth.roleOf(r.sid)).toBe('admin');
    expect(await c.auth.identityOf(r.sid)).toEqual({ login: 'p_ivanova' });
    expect((await c.staff.byLogin('p_ivanova'))!.last_login_at).toBeInstanceOf(Date);
    expect((await db.query(`SELECT actor FROM audit_log WHERE action = 'staff.login'`)).rows).toEqual([{ actor: 'p_ivanova' }]);
  });

  test('логин принимается в любом регистре', async () => {
    const c = setup();
    await personal(c);
    expect((await c.auth.login(PASSWORD, '1.2.3.4', 'P_Ivanova')).ok).toBe(true);
  });

  test('общий обычный вход после включения закрыт: и новый, и уже выданный', async () => {
    const c = setup();
    await activePerson(c);
    const before = await c.auth.login('общий-обычный-пароль', '1.1.1.1', 'mbv_admin');
    expect(await c.auth.verify(before.sid)).toBe(true);
    await c.service.setPersonalMode({ enabled: true }, 'super_mbv_admin');
    c.auth.invalidate();
    expect(await c.auth.verify(before.sid)).toBe(false);
    expect((await c.auth.login('общий-обычный-пароль', '1.1.1.2', 'mbv_admin')).ok).toBe(false);
  });

  test('общий полный вход остаётся запасным и после включения', async () => {
    const c = setup();
    await personal(c);
    const r = await c.auth.login('общий-полный-пароль', '1.2.3.4', 'super_mbv_admin');
    expect(r).toMatchObject({ ok: true, role: 'super' });
    expect(await c.auth.verify(r.sid)).toBe(true);
    expect(await c.auth.roleOf(r.sid)).toBe('super');
  });

  test('выключение личных входов закрывает личные сессии, общий вход снова работает', async () => {
    const c = setup();
    await personal(c);
    const r = await c.auth.login(PASSWORD, '1.2.3.4', 'p_ivanova');
    await c.service.setPersonalMode({ enabled: false }, 'super_mbv_admin');
    c.auth.invalidate();
    expect(await c.auth.verify(r.sid)).toBe(false);
    expect((await c.auth.login('общий-обычный-пароль', '1.2.3.5', 'mbv_admin')).ok).toBe(true);
  });

  test.each([
    ['неверный пароль', 'p_ivanova', 'неверный-пароль-123'],
    ['пустой пароль', 'p_ivanova', ''],
    ['несуществующий логин', 'nobody', PASSWORD],
    ['пустой логин', '', PASSWORD],
    ['чужой общий логин с личным паролем', 'mbv_admin', PASSWORD],
  ])('вход не проходит: %s', async (_n, login, password) => {
    const c = setup();
    await personal(c);
    expect((await c.auth.login(password, '1.2.3.4', login)).ok).toBe(false);
  });

  test('человек без заданного пароля войти не может, даже с пустым хешем и любым паролем', async () => {
    const c = setup();
    await activePerson(c);
    await c.service.create({ fullName: 'Пётр Сидоров', email: 'petr@church.example', role: 'admin' }, 'a');
    await c.service.setPersonalMode({ enabled: true }, 'a');
    expect((await c.auth.login(PASSWORD, '1.2.3.4', 'p_sidorov')).ok).toBe(false);
    expect((await c.auth.login('', '1.2.3.4', 'p_sidorov')).ok).toBe(false);
  });

  test('после нескольких неудач вход блокируется — и по адресу, и по логину; верный пароль в блокировке тоже не пускает', async () => {
    const c = setup();
    await personal(c);
    for (let i = 0; i < 3; i += 1) expect((await c.auth.login('нет', `9.9.9.${i}`, 'p_ivanova')).ok).toBe(false);
    // Новый адрес, но логин уже заблокирован.
    expect(await c.auth.login(PASSWORD, '8.8.8.8', 'p_ivanova')).toMatchObject({ ok: false, lockedOut: true });
    // Другой логин с того же адреса тоже блокируется по адресу.
    for (let i = 0; i < 3; i += 1) await c.auth.login('нет', '7.7.7.7', 'nobody');
    expect(await c.auth.login(PASSWORD, '7.7.7.7', 'p_ivanova2')).toMatchObject({ ok: false, lockedOut: true });
  });

  test('успешный вход сбрасывает счётчик неудач', async () => {
    const c = setup();
    await personal(c);
    await c.auth.login('нет', '1.1.1.1', 'p_ivanova');
    await c.auth.login('нет', '1.1.1.1', 'p_ivanova');
    expect((await c.auth.login(PASSWORD, '1.1.1.1', 'p_ivanova')).ok).toBe(true);
    await c.auth.login('нет', '1.1.1.1', 'p_ivanova');
    await c.auth.login('нет', '1.1.1.1', 'p_ivanova');
    expect((await c.auth.login(PASSWORD, '1.1.1.1', 'p_ivanova')).ok).toBe(true);
  });

  test('выход закрывает сессию', async () => {
    const c = setup();
    await personal(c);
    const r = await c.auth.login(PASSWORD, '1.2.3.4', 'p_ivanova');
    await c.auth.logout(r.sid);
    expect(await c.auth.verify(r.sid)).toBe(false);
  });
});
