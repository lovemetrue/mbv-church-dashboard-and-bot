import type { Pool } from 'pg';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { StaffRepo } from '../src/db/repos/staff.repo.js';
import { PersonalAuth } from '../src/platform/auth/personalAuth.js';
import type { MailMessage, Mailer } from '../src/platform/mail/mailer.js';
import { createActions } from '../src/home-groups/actions.js';
import { composeService } from '../src/home-groups/composition.js';
import { createHomeGroupsServer } from '../src/home-groups/server.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Личные входы от начала до конца через HTTP на настоящей базе: заведение, письмо, пароль по ссылке,
 * включение режима, вход, права, сброс. Почта подставная — запоминает письма.
 */

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const SHARED = { regular: 'общий-обычный-пароль', super: 'общий-полный-пароль' };
const PASSWORD = 'сиреневый-туман-42';
let ipCounter = 0;
const nextIp = () => `10.7.0.${++ipCounter}`;

async function start() {
  const data = new Map<string, string>();
  const store: SessionStore = {
    async set(k, v) { data.set(k, v); }, async get(k) { return data.get(k) ?? null; }, async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
  const sent: MailMessage[] = [];
  const mailer: Mailer = { configured: true, async send(m) { sent.push(m); } };
  const sessions = new SessionService(store, { password: SHARED.regular, login: 'mbv_admin', superPassword: SHARED.super, superLogin: 'super_mbv_admin', ttlSeconds: 600, maxAttempts: 50 });
  const auth = new PersonalAuth(sessions, store, new StaffRepo(db), new SettingsRepo(db), { sharedLogin: 'mbv_admin', sharedSuperLogin: 'super_mbv_admin', maxAttempts: 50, cacheMs: 0 });
  const composed = composeService(db, createFakeEngine().engine, {
    defaultCapacity: 10, ttlMs: 0, store, mailer, publicUrl: 'https://hg.example', onStaffChange: () => auth.invalidate(),
  });
  const web = mkdtempSync(join(tmpdir(), 'hg-staff-'));
  writeFileSync(join(web, 'index.html'), '<div id="root"></div>');
  const server = createHomeGroupsServer({
    auth, staff: composed.staff, views: composed.views, actions: createActions(composed.placement, { defaultCapacity: 10 }),
    matching: composed.matching, settings: composed.settings,
    reportError: () => undefined, invalidateViews: () => composed.views.invalidate(),
    actorName: (role) => (role === 'super' ? 'super_mbv_admin' : 'mbv_admin'),
    sessionTtlSeconds: 600, secureCookie: false, webDir: web,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = async (name: string, password: string) => {
    const r = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
      body: new URLSearchParams({ login: name, password }),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null };
  };
  const api = (cookie: string, path: string, body?: unknown) => fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const linkFromLastMail = (): string => new URL(/https:\/\/\S+/.exec(sent.at(-1)!.text)![0]).pathname + new URL(/https:\/\/\S+/.exec(sent.at(-1)!.text)![0]).search;
  const setPassword = (link: string, password = PASSWORD) => fetch(`${base}${link}`.replace(/\?.*/, ''), {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
    body: new URLSearchParams({ token: new URL(`http://x${link}`).searchParams.get('token')!, password, password2: password }),
  });
  return { server, base, sent, login, api, linkFromLastMail, setPassword, auth };
}

describe('личные входы целиком', () => {
  test('заведение → письмо → пароль по ссылке → включение → вход; общий обычный вход закрывается', async () => {
    const app = await start();
    try {
      const boss = (await app.login('super_mbv_admin', SHARED.super)).cookie!;
      const created = await app.api(boss, 'settings/staff/create', { fullName: 'Полина Иванова', email: 'polina@church.example', role: 'admin' });
      expect(await created.json()).toMatchObject({ ok: true, delivery: 'sent', login: 'p_ivanova', email: 'polina@church.example' });
      expect(app.sent).toHaveLength(1);
      expect(app.sent[0]).toMatchObject({ to: 'polina@church.example' });

      // До включения личный логин не пускает.
      expect((await app.login('p_ivanova', PASSWORD)).status).toBe(401);

      const link = app.linkFromLastMail();
      const page = await (await fetch(`${app.base}${link}`)).text();
      expect(page).toContain('Полина Иванова');
      const done = await app.setPassword(link);
      expect(done.status).toBe(302);
      expect(done.headers.get('location')).toBe('/login?notice=password_set');
      // Ссылка одноразовая.
      expect((await app.setPassword(link, 'другой-пароль-12345')).status).toBe(410);

      const view = await (await app.api(boss, 'settings/staff')).json() as { items: { status: string }[]; personal: { canEnable: boolean; enabled: boolean } };
      expect(view.items[0]!.status).toBe('active');
      expect(view.personal).toMatchObject({ canEnable: true, enabled: false });

      expect((await app.api(boss, 'settings/staff/personal-mode', { enabled: true })).status).toBe(200);

      const polina = await app.login('p_ivanova', PASSWORD);
      expect(polina.status).toBe(302);
      expect(await (await app.api(polina.cookie!, 'me')).json()).toEqual({ role: 'admin' });
      // Обычный сотрудник раздел «Настройки» не видит.
      expect((await app.api(polina.cookie!, 'settings/staff')).status).toBe(403);
      expect((await app.api(polina.cookie!, 'requests')).status).toBe(200);

      // Общий обычный вход закрыт, запасной полный работает.
      expect((await app.login('mbv_admin', SHARED.regular)).status).toBe(401);
      expect((await app.login('super_mbv_admin', SHARED.super)).status).toBe(302);
    } finally { app.server.close(); }
  });

  test('действия личного входа в журнале подписаны логином человека', async () => {
    const app = await start();
    try {
      const boss = (await app.login('super_mbv_admin', SHARED.super)).cookie!;
      await app.api(boss, 'settings/staff/create', { fullName: 'Пётр Сидоров', email: 'petr@church.example', role: 'super' });
      await app.setPassword(app.linkFromLastMail());
      await app.api(boss, 'settings/staff/personal-mode', { enabled: true });
      const petr = (await app.login('p_sidorov', PASSWORD)).cookie!;
      expect((await app.api(petr, 'matching/run', {})).status).toBe(200);
      const audit = await (await app.api(petr, 'settings/audit')).json() as { items: { actor: string; action: string }[] };
      expect(audit.items.find((i) => i.action === 'matching.run')!.actor).toBe('p_sidorov');
      // Полный личный вход видит раздел «Настройки».
      expect((await app.api(petr, 'settings/staff')).status).toBe(200);
    } finally { app.server.close(); }
  });

  test('отключённого человека выбрасывает из системы сразу', async () => {
    const app = await start();
    try {
      const boss = (await app.login('super_mbv_admin', SHARED.super)).cookie!;
      for (const [name, email] of [['Полина Иванова', 'polina@church.example'], ['Пётр Сидоров', 'petr@church.example']]) {
        await app.api(boss, 'settings/staff/create', { fullName: name, email, role: 'admin' });
        await app.setPassword(app.linkFromLastMail());
      }
      await app.api(boss, 'settings/staff/personal-mode', { enabled: true });
      const polina = (await app.login('p_ivanova', PASSWORD)).cookie!;
      expect((await app.api(polina, 'requests')).status).toBe(200);
      const list = await (await app.api(boss, 'settings/staff')).json() as { items: { id: number; login: string }[] };
      const id = list.items.find((i) => i.login === 'p_ivanova')!.id;
      expect((await app.api(boss, 'settings/staff/update', { id, active: false })).status).toBe(200);
      expect((await app.api(polina, 'requests')).status).toBe(401);
      expect((await app.login('p_ivanova', PASSWORD)).status).toBe(401);
    } finally { app.server.close(); }
  });

  test('«забыли пароль»: письмо со ссылкой, новый пароль работает, старый и прежние входы — нет', async () => {
    const app = await start();
    try {
      const boss = (await app.login('super_mbv_admin', SHARED.super)).cookie!;
      await app.api(boss, 'settings/staff/create', { fullName: 'Полина Иванова', email: 'polina@church.example', role: 'admin' });
      await app.setPassword(app.linkFromLastMail());
      await app.api(boss, 'settings/staff/personal-mode', { enabled: true });
      const old = (await app.login('p_ivanova', PASSWORD)).cookie!;

      const before = app.sent.length;
      const r = await fetch(`${app.base}/forgot`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
        body: new URLSearchParams({ identifier: 'polina@church.example' }),
      });
      expect(r.status).toBe(200);
      // Письмо уходит в фоне: ждём его появления.
      for (let i = 0; i < 40 && app.sent.length === before; i += 1) await new Promise((res) => setTimeout(res, 25));
      expect(app.sent).toHaveLength(before + 1);
      expect(app.sent.at(-1)!.subject).toBe('Домашние группы: смена пароля');

      expect((await app.setPassword(app.linkFromLastMail(), 'новый-сложный-пароль-77')).status).toBe(302);
      expect((await app.api(old, 'requests')).status).toBe(401);
      expect((await app.login('p_ivanova', PASSWORD)).status).toBe(401);
      expect((await app.login('p_ivanova', 'новый-сложный-пароль-77')).status).toBe(302);
    } finally { app.server.close(); }
  });

  test('«забыли пароль» для неизвестного адреса ничего не отправляет и выглядит так же', async () => {
    const app = await start();
    try {
      const r = await fetch(`${app.base}/forgot`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
        body: new URLSearchParams({ identifier: 'nobody@church.example' }),
      });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('Если такой пользователь есть');
      await new Promise((res) => setTimeout(res, 100));
      expect(app.sent).toHaveLength(0);
    } finally { app.server.close(); }
  });

  test('пока личные входы выключены, всё работает как раньше', async () => {
    const app = await start();
    try {
      const regular = await app.login('mbv_admin', SHARED.regular);
      expect(regular.status).toBe(302);
      expect(await (await app.api(regular.cookie!, 'me')).json()).toEqual({ role: 'admin' });
    } finally { app.server.close(); }
  });
});
