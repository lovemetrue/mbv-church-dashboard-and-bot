import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHomeGroupsServer, mayEditGroups } from '../src/home-groups/server.js';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';
import type { AuthPort } from '../src/platform/auth/personalAuth.js';
import type { Role } from '../src/home-groups/contracts.js';
import { buildViews } from '../src/home-groups/api/views.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import type { ActionOutcome } from '../src/db/repos/placement.repo.js';

/**
 * HTTP-слой сервиса «Домашние группы» на хранилище сессий в памяти: вход и выход, куки,
 * заголовки безопасности, JSON API без сессии и со статикой собранного интерфейса.
 */

const REGULAR = { login: 'mbv_admin', password: 'обычный-пароль' };
const SUPER = { login: 'super_mbv_admin', password: 'супер-пароль-123' };
/** Личный вход с уровнем «Стойка регистрации»: в бою его выдаёт PersonalAuth по строке staff, здесь — обёртка ниже. */
const DESK = { login: 'stoika', password: 'пароль-стойки' };
/** Личный вход «Только чтение». */
const READER = { login: 'chitatel', password: 'пароль-читателя' };
/** Личный обычный вход человека, у которого в команде только роль распределителя. */
const DISTRIBUTOR = { login: 'raspred', password: 'пароль-распределителя' };
const INDEX_MARKER = 'ИНТЕРФЕЙС-ДОМАШНИХ-ГРУПП';
const SECRET = 'СЕКРЕТ-ВНЕ-КАТАЛОГА-ИНТЕРФЕЙСА';

function memoryStore(): SessionStore {
  const data = new Map<string, string>();
  return {
    async set(k, v) { data.set(k, v); },
    async get(k) { return data.get(k) ?? null; },
    async del(k) { data.delete(k); },
    async incr(k) { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n; },
  };
}

/**
 * Общие входы как есть плюс личные: стойка, «Только чтение» и распределитель. Их сессия обычная, а уровень и логин
 * помнит обёртка — в бою это делает PersonalAuth по строке staff.
 */
function withDesk(inner: SessionService): AuthPort {
  const personal: Record<string, { password: string; role: Role }> = {
    [DESK.login]: { password: DESK.password, role: 'registration' },
    [READER.login]: { password: READER.password, role: 'readonly' },
    [DISTRIBUTOR.login]: { password: DISTRIBUTOR.password, role: 'admin' },
  };
  const sessions = new Map<string, { login: string; role: Role }>();
  return {
    async login(password, ip, username) {
      const who = username ? personal[username] : undefined;
      if (!who || !username) return inner.login(password, ip, username);
      if (password !== who.password) return { ok: false };
      const sid = await inner.startSession(who.role);
      sessions.set(sid, { login: username, role: who.role });
      return { ok: true, sid, role: who.role };
    },
    verify: (sid) => inner.verify(sid),
    roleOf: async (sid) => (sid && sessions.has(sid) ? sessions.get(sid)!.role : inner.roleOf(sid)),
    // Стойка в этих тестах пишет в журнал от общего логина, как было до личных входов.
    identityOf: async (sid) => (sid && sessions.has(sid) && sessions.get(sid)!.login !== DESK.login ? { login: sessions.get(sid)!.login } : null),
    logout: (sid) => inner.logout(sid),
  };
}

const { engine } = createFakeEngine();
const sampleViews = () => buildViews({
  groups: [], requests: [], participants: [], coordinators: [{ id: 1, name: 'Анна', role: 'Координатор', role_ids: [1], role_kinds: ['coordinator'], source: 'ui' }],
}, engine, new Date('2026-10-10T09:00:00Z'));

let root: string;
let ipCounter = 0;
const nextIp = () => `10.2.0.${++ipCounter}`;

interface ActionCall { name: string; id: number; body: unknown; actor: string }
interface Started {
  kitCalls: { name: string; body?: unknown; actor?: string }[];
  base: string; viewsCalls: () => number; close: () => void; setViews: (f: () => Promise<ReturnType<typeof sampleViews>>) => void;
  chatCalls: { body: unknown; actor: string }[]; setChatOutcome: (o: unknown) => void;
  assistantCalls: { name: string; actor: string; enabled?: boolean }[]; setAssistantOutcome: (o: unknown) => void;
  actionCalls: ActionCall[]; auditCalls: { actor: string; action: string; after: unknown }[]; invalidations: () => number; setOutcome: (o: ActionOutcome) => void;
  matchingCalls: { name: string; actor: string; enabled?: boolean }[];
  setSettingsOutcome: (o: ActionOutcome) => void;
  createCalls: { what: string; body: unknown; actor: string }[]; setCreate: (o: { ok: true; id: number } | { ok: false; error: string; message: string }) => void;
  staffCalls: { name: string; args: unknown[] }[]; setTokenInfo: (v: { fullName: string; login: string } | null) => void; setComplete: (v: { ok: true } | { ok: false; error: string; message: string }) => void;
  settingsCalls: { name: string; actor?: string; body?: unknown }[]; reported: { source: string; message: string; context: string }[];
}

async function start(opts: { secureCookie?: boolean; webDir?: string; maxAttempts?: number } = {}): Promise<Started> {
  let calls = 0;
  let invalidations = 0;
  let outcome: ActionOutcome = { ok: true };
  let settingsOutcome: ActionOutcome = { ok: true };
  const actionCalls: ActionCall[] = [];
  const chatCalls: { body: unknown; actor: string }[] = [];
  let chatOutcome: unknown = { ok: true, answer: 'Перебор в ДГ-0001.', queries: [{ sql: 'select 1', ok: true, rows: 1 }], tables: [] };
  const assistantCalls: { name: string; actor: string; enabled?: boolean }[] = [];
  let assistantOutcome: unknown = { ok: true, asked: 3, filled: 2, withQuestions: 1, proposals: 1 };
  const auditCalls: { actor: string; action: string; after: unknown }[] = [];
  const matchingCalls: { name: string; actor: string; enabled?: boolean }[] = [];
  const settingsCalls: { name: string; actor?: string; body?: unknown }[] = [];
  const strangeCalls: { name: string; id?: number; body?: unknown; actor?: string }[] = [];
  const kitCalls: { name: string; body?: unknown; actor?: string }[] = [];
  const kitPerson = { userId: 12, registrationNo: 1042, fio: 'Иван Петров', phone: null, issuedAt: null, issuedBy: null };
  const llmCalls: { name: string; body?: unknown; actor?: string }[] = [];
  let mapKey: string | null = null;
  let llmSaveOutcome: unknown = { ok: true };
  let llmTestResult: unknown = { ok: true, provider: 'DeepSeek', model: 'deepseek-chat', ms: 700 };
  const reconcileCalls: { name: string; id?: number; actor?: string; body?: unknown }[] = [];
  const staffCalls: { name: string; args: unknown[] }[] = [];
  const createCalls: { what: string; body: unknown; actor: string }[] = [];
  let createOutcome: { ok: true; id: number } | { ok: false; error: string; message: string } = { ok: true, id: 77 };
  let tokenInfo: { fullName: string; login: string } | null = { fullName: 'Полина Иванова', login: 'p_ivanova' };
  let complete: { ok: true } | { ok: false; error: string; message: string } = { ok: true };
  const reported: { source: string; message: string; context: string }[] = [];
  const record = (name: string) => async (id: number, body: unknown, actor: string): Promise<ActionOutcome> => {
    actionCalls.push({ name, id, body, actor });
    return outcome;
  };
  let views: () => Promise<ReturnType<typeof sampleViews>> = async () => sampleViews();
  const server = createHomeGroupsServer({
    actions: { approve: record('approve'), reject: record('reject'), setNeedCall: record('need-call'), setParams: record('params'), rematch: async (id: number, actor: string) => { actionCalls.push({ name: 'rematch', id, body: undefined, actor }); return outcome; }, edit: record('edit'), assign: record('assign'), call: record('call'), close: record('close'), reopen: async (id: number, actor: string) => { actionCalls.push({ name: 'reopen', id, body: undefined, actor }); return outcome; }, bulk: async (body: unknown, actor: string) => { actionCalls.push({ name: 'bulk', id: 0, body, actor }); return { ok: true as const, done: 2, skipped: 1 }; } },
    matching: {
      run: async (actor) => { matchingCalls.push({ name: 'run', actor }); return { ok: true, created: 2, replaced: 1, unchanged: 3 }; },
      rerunAll: async (actor) => { matchingCalls.push({ name: 'rerun-all', actor }); return { ok: true, created: 5, replaced: 0, unchanged: 0 }; },
      setAuto: async (enabled, actor) => { matchingCalls.push({ name: 'auto', actor, enabled }); },
    },
    creator: {
      request: async (body: unknown, actor: string) => { createCalls.push({ what: 'request', body, actor }); return createOutcome; },
      group: async (body: unknown, actor: string) => { createCalls.push({ what: 'group', body, actor }); return createOutcome; },
    } as never,
    registrar: {
      register: async (body: unknown, actor: string) => {
        createCalls.push({ what: 'registration', body, actor });
        return createOutcome.ok ? { ok: true as const, id: createOutcome.id, registrationNo: 4242 } : createOutcome;
      },
      qr: async (id: number) => (id === 5 ? Buffer.from('\x89PNG-фейк') : null),
      card: async (id: number) => (id === 5 ? { registrationNo: 4242, fullName: 'Иван Петров', phone: '+79110001122', church: null, mdgStatus: null } : null),
    } as never,
    manager: {
      updateGroup: async (id: number, body: unknown, actor: string) => { actionCalls.push({ name: 'group.update', id, body, actor }); return outcome; },
      deleteGroup: async (id: number, actor: string) => { actionCalls.push({ name: 'group.delete', id, body: undefined, actor }); return outcome; },
      createCoordinator: async (body: unknown, actor: string) => { createCalls.push({ what: 'coordinator', body, actor }); return createOutcome; },
      updateCoordinator: async (id: number, body: unknown, actor: string) => { actionCalls.push({ name: 'coordinator.update', id, body, actor }); return outcome; },
      deleteCoordinator: async (id: number, actor: string) => { actionCalls.push({ name: 'coordinator.delete', id, body: undefined, actor }); return outcome; },
      deletePerson: async (id: number, actor: string) => { actionCalls.push({ name: 'person.delete', id, body: undefined, actor }); return outcome; },
      deleteRequest: async (id: number, actor: string) => { actionCalls.push({ name: 'request.delete', id, body: undefined, actor }); return outcome; },
    } as never,
    campaign: async () => ({ day: { state: 'идёт', number: 3, total: 40, startDate: '2026-11-01' } }) as never,
    members: {
      add: async (id: number, body: unknown, actor: string) => { actionCalls.push({ name: 'member.add', id, body, actor }); return createOutcome.ok ? { ok: true as const, id: createOutcome.id, personKey: 'u1' } : createOutcome; },
      update: async (id: number, body: unknown, actor: string) => { actionCalls.push({ name: 'member.update', id, body, actor }); return outcome; },
      remove: async (id: number, actor: string) => { actionCalls.push({ name: 'member.remove', id, body: undefined, actor }); return outcome; },
      updatePerson: async (id: number, body: unknown, actor: string) => { actionCalls.push({ name: 'person.update', id, body, actor }); return outcome; },
      deletePerson: async (id: number, actor: string) => { actionCalls.push({ name: 'person.delete', id, body: undefined, actor }); return outcome; },
    } as never,
    contacts: {
      update: async (key: string, body: unknown, actor: string) => { actionCalls.push({ name: 'contact.update', key, body, actor } as never); return outcome; },
    } as never,
    chat: {
      ask: async (body: unknown, actor: string) => { chatCalls.push({ body, actor }); return chatOutcome; },
      history: async (actor: string) => { chatCalls.push({ body: 'history', actor }); return { messages: [{ role: 'user', content: 'Где перебор?' }, { role: 'assistant', content: 'В ДГ-0001.' }] }; },
      clear: async (actor: string) => { chatCalls.push({ body: 'clear', actor }); return { ok: true }; },
    } as never,
    assistant: {
      status: async () => ({ available: true, enabled: true, chat: true }),
      run: async (actor: string) => { assistantCalls.push({ name: 'run', actor }); return assistantOutcome; },
      setEnabled: async (enabled: boolean, actor: string) => { assistantCalls.push({ name: 'enabled', actor, enabled }); },
      view: async () => ({ generatedAt: 'g', available: true, enabled: false, model: 'fake', lastRun: null }),
    } as never,
    strange: {
      forRequest: async (id: number, body: unknown, actor: string) => { strangeCalls.push({ name: 'request', id, body, actor }); return { ok: true }; },
      forPerson: async (body: unknown, actor: string) => { strangeCalls.push({ name: 'person', body, actor }); return { ok: true }; },
    } as never,
    genders: {
      set: async (body: unknown, actor: string) => { strangeCalls.push({ name: 'gender', body, actor }); return { ok: true }; },
      fillWithAi: async () => { strangeCalls.push({ name: 'gender-ai' }); return { ok: true, unknownBefore: 3, filled: 2, left: 1 }; },
    } as never,
    teamRoles: {
      view: async () => ({ items: [{ id: 1, name: 'Распределитель', kind: 'distributor', members: 2 }] }),
      create: async (body: unknown, actor: string) => { kitCalls.push({ name: 'role.create', body, actor }); return { ok: true, id: 7 }; },
      update: async (body: unknown, actor: string) => { kitCalls.push({ name: 'role.update', body, actor }); return { ok: true }; },
      delete: async (body: unknown, actor: string) => { kitCalls.push({ name: 'role.delete', body, actor }); return { ok: false, error: 'conflict', message: 'Роль есть у людей в справочнике команды: сначала смените им роль.' }; },
    } as never,
    groupDirections: {
      view: async () => ({ items: [{ id: 1, name: 'Основное служение', groups: 70 }] }),
      create: async (body: unknown, actor: string) => { kitCalls.push({ name: 'direction.create', body, actor }); return { ok: true, id: 5 }; },
      update: async (body: unknown, actor: string) => { kitCalls.push({ name: 'direction.update', body, actor }); return { ok: true }; },
      delete: async (body: unknown, actor: string) => { kitCalls.push({ name: 'direction.delete', body, actor }); return { ok: false, error: 'conflict', message: 'У направления есть группы: сначала смените им направление.' }; },
    } as never,
    kits: {
      view: async () => { kitCalls.push({ name: 'view' }); return { generatedAt: 'g', registered: 3, issued: 1, issuedToday: 1, recent: [] }; },
      find: async (body: unknown) => {
        kitCalls.push({ name: 'find', body });
        return (body as { code?: string }).code === 'нет' ? { ok: false, error: 'not_found', message: 'Регистрации №5 нет.' } : { ok: true, person: kitPerson };
      },
      search: async (body: unknown) => { kitCalls.push({ name: 'search', body }); return { ok: true, items: [], more: false }; },
      issue: async (body: unknown, actor: string) => { kitCalls.push({ name: 'issue', body, actor }); return { ok: true, person: kitPerson, changed: true }; },
      undo: async (body: unknown, actor: string) => { kitCalls.push({ name: 'undo', body, actor }); return { ok: true, person: kitPerson, changed: false }; },
    } as never,
    llmConfig: {
      view: async () => ({ provider: 'deepseek', baseUrl: null, model: 'deepseek-chat', keySet: true, keySource: 'settings', keyHint: 'ABCD', keyUnreadable: false, providers: [] }),
      save: async (body: unknown, actor: string) => { llmCalls.push({ name: 'save', body, actor }); return llmSaveOutcome; },
      test: async (body: unknown) => { llmCalls.push({ name: 'test', body }); return llmTestResult; },
    } as never,
    geocoderConfig: {
      view: async () => ({ keySet: true, keySource: 'settings', keyHint: 'WXYZ', keyUnreadable: false, usedToday: 3, dailyLimit: 900 }),
      save: async (body: unknown, actor: string) => { llmCalls.push({ name: 'geo-save', body, actor }); return { ok: true }; },
      test: async (body: unknown) => { llmCalls.push({ name: 'geo-test', body }); return { ok: true, ms: 5 }; },
    } as never,
    geocodeAddresses: {
      table: async () => ({ generatedAt: 'g', items: [{ address: 'ул. Тест, 1', state: 'missing', lat: null, lon: null, sources: [{ kind: 'group', id: '7', label: 'Группа №7' }] }] }),
      retry: async (body: unknown) => { llmCalls.push({ name: 'geo-retry', body }); return { ok: true }; },
      reject: async (body: unknown) => { llmCalls.push({ name: 'geo-reject', body }); return { ok: true }; },
    } as never,
    mapConfig: {
      view: async () => ({ keySet: mapKey !== null, keyHint: mapKey ? mapKey.slice(-4) : null, keyUnreadable: false, loadsThisMonth: 3, monthlyLimit: 100 }),
      bootstrap: async () => ({ apiKey: mapKey, loadsThisMonth: 3, monthlyLimit: 100 }),
      recordLoad: async () => { llmCalls.push({ name: 'map-loaded' }); return { apiKey: mapKey, loadsThisMonth: 4, monthlyLimit: 100 }; },
      save: async (body: unknown, actor: string) => { llmCalls.push({ name: 'map-save', body, actor }); return { ok: true }; },
    } as never,
    reconciler: {
      apply: async (id: number, body: unknown, actor: string) => { reconcileCalls.push({ name: 'apply', id, body, actor }); return { ok: true, already: false }; },
      applyReady: async (body: unknown, actor: string) => { reconcileCalls.push({ name: 'ready', body, actor }); return { ok: true, applied: 2, skipped: 1 }; },
    } as never,
    botSettings: {
      view: async () => { settingsCalls.push({ name: 'bot.view' }); return { generatedAt: 'g', extraQuestions: { mode: 'off', ids: '', source: 'env', envValue: 'off' } }; },
      setExtraQuestions: async (body: unknown, actor: string) => { settingsCalls.push({ name: 'bot.save', actor, body }); return settingsOutcome; },
      sendExtraInvites: async (body: unknown, actor: string) => { settingsCalls.push({ name: 'bot.invites', actor, body }); return { ok: true, sent: 2, failed: 0, blocked: 0 }; },
    } as never,
    exporter: { requests: async () => '\uFEFF№;ФИО\r\n1;Мария\r\n', people: async () => '\uFEFFномер\r\n' },
    audit: async (actor: string, action: string, after: unknown) => { auditCalls.push({ actor, action, after }); },
    logo: async () => Buffer.from('\x89PNG-логотип'),
    formMeta: async () => ({ districts: ['Приморский'], groupFormats: [], groupStatuses: [], compositions: [], requestStatuses: [], requestTypes: [], ageGroups: [], coordinators: [], churches: [], mdgStatuses: [] }),
    staff: {
      view: async () => { staffCalls.push({ name: 'view', args: [] }); return { generatedAt: 'g', items: [], personal: { enabled: false, canEnable: false, activeWithPassword: 0, mailConfigured: false } }; },
      suggestLogin: async (...a: unknown[]) => { staffCalls.push({ name: 'suggest', args: a }); return { ok: true, login: 'p_ivanova' }; },
      create: async (...a: unknown[]) => { staffCalls.push({ name: 'create', args: a }); return { ok: true, delivery: 'link', email: 'e@e.ee', path: '/set-password?token=T', login: 'p_ivanova', id: 1 }; },
      update: async (...a: unknown[]) => { staffCalls.push({ name: 'update', args: a }); return { ok: true }; },
      invite: async (...a: unknown[]) => { staffCalls.push({ name: 'invite', args: a }); return { ok: true, delivery: 'sent', email: 'e@e.ee' }; },
      reset: async (...a: unknown[]) => { staffCalls.push({ name: 'reset', args: a }); return { ok: true, delivery: 'sent', email: 'e@e.ee' }; },
      setPersonalMode: async (...a: unknown[]) => { staffCalls.push({ name: 'mode', args: a }); return { ok: true }; },
      requestReset: async (...a: unknown[]) => { staffCalls.push({ name: 'requestReset', args: a }); },
      tokenInfo: async (t: string) => { staffCalls.push({ name: 'tokenInfo', args: [t] }); return tokenInfo; },
      completePassword: async (...a: unknown[]) => { staffCalls.push({ name: 'complete', args: a }); return complete; },
      revealPassword: async (...a: unknown[]) => { staffCalls.push({ name: 'reveal', args: a }); return { ok: true, password: 'выданный-пароль' }; },
      personOf: async (login: string) => (login === DISTRIBUTOR.login ? { login, name: 'Ирина Распределитель', teamRole: 'Распределитель', teamKinds: ['distributor'] }
        : login === DESK.login || login === READER.login ? { login, name: login, teamRole: null, teamKinds: [] } : null),
    } as never,
    settings: {
      health: async () => { settingsCalls.push({ name: 'health' }); return { generatedAt: 'g', overall: 'ok', metrics: [] }; },
      errors: async () => { settingsCalls.push({ name: 'errors' }); return { generatedAt: 'g', items: [] }; },
      audit: async () => { settingsCalls.push({ name: 'audit' }); return { generatedAt: 'g', items: [] }; },
      prompts: async () => { settingsCalls.push({ name: 'prompts' }); return { generatedAt: 'g', agents: [] }; },
      savePrompt: async (body: unknown, actor: string) => { settingsCalls.push({ name: 'save', actor, body }); return settingsOutcome; },
      activatePrompt: async (body: unknown, actor: string) => { settingsCalls.push({ name: 'activate', actor, body }); return settingsOutcome; },
    },
    reportError: (source, err, context) => { reported.push({ source, message: err instanceof Error ? err.message : String(err), context }); },
    invalidateViews: () => { invalidations += 1; },
    actorName: (role) => (role === 'super' ? SUPER.login : REGULAR.login),
    auth: withDesk(new SessionService(memoryStore(), {
      password: REGULAR.password, login: REGULAR.login, superPassword: SUPER.password, superLogin: SUPER.login,
      ttlSeconds: 600, maxAttempts: opts.maxAttempts ?? 50,
    })),
    views: () => { calls += 1; return views(); },
    sessionTtlSeconds: 600,
    secureCookie: opts.secureCookie ?? false,
    webDir: opts.webDir ?? join(root, 'web-dist'),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    viewsCalls: () => calls,
    close: () => { server.close(); },
    setViews: (f) => { views = f; },
    actionCalls, auditCalls, assistantCalls, chatCalls, setChatOutcome: (o: unknown) => { chatOutcome = o; }, setAssistantOutcome: (o: unknown) => { assistantOutcome = o; }, matchingCalls, settingsCalls, reconcileCalls, strangeCalls, kitCalls, llmCalls, setMapKey: (k: string | null) => { mapKey = k; }, setLlmSave: (o: unknown) => { llmSaveOutcome = o; }, setLlmTest: (o: unknown) => { llmTestResult = o; }, reported, staffCalls, createCalls, setCreate: (o) => { createOutcome = o; }, setTokenInfo: (v) => { tokenInfo = v; }, setComplete: (v) => { complete = v; }, setSettingsOutcome: (o: ActionOutcome) => { settingsOutcome = o; }, invalidations: () => invalidations, setOutcome: (o) => { outcome = o; },
  };
}

let app: Started;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'hg-web-'));
  const web = join(root, 'web-dist');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), `<!doctype html><title>x</title><div id="root">${INDEX_MARKER}</div>`);
  writeFileSync(join(web, 'assets', 'app.abc123.js'), 'console.log("app");');
  writeFileSync(join(web, 'assets', 'app.abc123.css'), 'body{margin:0}');
  writeFileSync(join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  // Лежит рядом с каталогом интерфейса, а не внутри: до него можно добраться только через «..».
  writeFileSync(join(root, 'secret.txt'), SECRET);
  app = await start();
});
afterAll(() => { app.close(); });

const post = (base: string, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp(), ...headers },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });

async function signIn(creds = REGULAR, base = app.base): Promise<string> {
  const r = await post(base, '/login', { login: creds.login, password: creds.password });
  expect(r.status).toBe(302);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

/** Сырой запрос: fetch сам «схлопывает» «..» в адресе, а проверить нужно именно то, что дошло до сервера. */
function raw(base: string, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const u = new URL(base);
    const req = httpRequest({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const API_ROUTES = ['me', 'team', 'today', 'requests', 'groups', 'people', 'coordinators'];

describe('вход и выход', () => {
  test('страница входа отдаётся без сессии, по-русски, без подсказки логина', async () => {
    const r = await fetch(`${app.base}/login`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('lang="ru"');
    expect(html).toContain('name="login"');
    expect(html).toContain('name="password"');
    expect(html).toContain('Войти');
    expect(html).not.toContain(REGULAR.login);
    expect(html).not.toContain(SUPER.login);
  });

  test('верный пароль: переход на корень и кука сессии с нужными атрибутами', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: REGULAR.password });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^mbv_sid=[A-Za-z0-9_-]{20,};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Path=/groups');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain('Secure');
  });

  test('с настройкой «Secure» кука помечается защищённой', async () => {
    const secure = await start({ secureCookie: true });
    try {
      const r = await post(secure.base, '/login', { login: REGULAR.login, password: REGULAR.password });
      expect(r.headers.get('set-cookie')).toContain('; Secure');
    } finally { secure.close(); }
  });

  test('неверный пароль: страница входа с сообщением и без куки', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: 'мимо' });
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
    const html = await r.text();
    expect(html).toContain('Неверный логин или пароль');
    expect(html).toContain('name="password"');
  });

  test('верный пароль от чужого логина не пускает', async () => {
    const r = await post(app.base, '/login', { login: 'кто-то', password: REGULAR.password });
    expect(r.status).toBe(401);
  });

  test('пустой пароль не пускает', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: '' });
    expect(r.status).toBe(401);
  });

  test('перебор пароля блокирует адрес на 429, даже когда потом введён верный', async () => {
    const locked = await start({ maxAttempts: 3 });
    try {
      const ip = { 'x-real-ip': '10.9.9.9' };
      for (let i = 0; i < 3; i += 1) {
        expect((await post(locked.base, '/login', { login: REGULAR.login, password: 'мимо' }, ip)).status).toBe(401);
      }
      const blocked = await post(locked.base, '/login', { login: REGULAR.login, password: REGULAR.password }, ip);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('set-cookie')).toBeNull();
      expect(await blocked.text()).toContain('Слишком много попыток');
      // Другой адрес не блокируется.
      expect((await post(locked.base, '/login', { login: REGULAR.login, password: REGULAR.password }, { 'x-real-ip': '10.9.9.8' })).status).toBe(302);
    } finally { locked.close(); }
  });

  test('слишком большое тело формы отклоняется кодом 413', async () => {
    const r = await post(app.base, '/login', { login: 'a', password: 'я'.repeat(40_000) });
    expect(r.status).toBe(413);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  test('тело чуть меньше лимита читается', async () => {
    const r = await post(app.base, '/login', { login: REGULAR.login, password: 'x'.repeat(60_000) });
    expect(r.status).toBe(401);
  });

  test('не форма (другой тип содержимого) не принимается', async () => {
    const r = await fetch(`${app.base}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': nextIp() },
      body: JSON.stringify({ login: REGULAR.login, password: REGULAR.password }), redirect: 'manual',
    });
    expect(r.status).toBe(415);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  test('текст ошибки на странице входа экранируется', async () => {
    const { homeGroupsLoginPage } = await import('../src/home-groups/loginPage.js');
    expect(homeGroupsLoginPage('<script>alert(1)</script>')).not.toContain('<script>');
  });

  test('вход со сверхправами: роль super', async () => {
    const cookie = await signIn(SUPER);
    const me = await (await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ role: 'super' });
  });

  test('выход — только POST: сессия гаснет, кука стирается, переход на вход', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login');
    expect(r.headers.get('set-cookie')).toMatch(/^mbv_sid=;.*Max-Age=0/);

    const after = await fetch(`${app.base}/api/v1/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  test('GET /logout не выходит: 404, а сессия остаётся живой', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/logout`, { headers: { cookie }, redirect: 'manual' });
    expect(r.status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
  });

  test('кука старого дашборда (hg_sid) сессией этого сервиса не считается', async () => {
    const cookie = (await signIn()).replace('mbv_sid=', 'hg_sid=');
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(401);
  });
});

describe('JSON API', () => {
  test.each(API_ROUTES)('/api/v1/%s без сессии отвечает 401 JSON', async (name) => {
    const r = await fetch(`${app.base}/api/v1/${name}`);
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual({ error: 'unauthorized' });
  });

  test('без сессии данные не загружаются вовсе', async () => {
    const fresh = await start();
    try {
      for (const name of API_ROUTES) await fetch(`${fresh.base}/api/v1/${name}`);
      expect(fresh.viewsCalls()).toBe(0);
    } finally { fresh.close(); }
  });

  test('с сессией /me отдаёт роль', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/api/v1/me`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ role: 'admin' });
  });

  test.each([
    ['today', 'counters'], ['requests', 'items'], ['groups', 'items'], ['people', 'items'], ['coordinators', 'items'],
  ])('с сессией /%s отдаёт своё представление', async (name, field) => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/api/v1/${name}`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    const body = await r.json() as Record<string, unknown>;
    expect(body).toHaveProperty(field);
    expect(body).toHaveProperty('generatedAt');
  });

  test('координаторы приходят из представления', async () => {
    const cookie = await signIn();
    const body = await (await fetch(`${app.base}/api/v1/coordinators`, { headers: { cookie } })).json() as { items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual(['Анна']);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s к API — 404 и с сессией, и без неё', async (method) => {
    const cookie = await signIn();
    const before = app.viewsCalls();
    for (const headers of [{}, { cookie }]) {
      for (const name of API_ROUTES) {
        const r = await fetch(`${app.base}/api/v1/${name}`, { method, headers });
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({ error: 'not_found' });
      }
    }
    expect(app.viewsCalls()).toBe(before);
  });

  test('неизвестный путь под /api — 404 JSON', async () => {
    const cookie = await signIn();
    for (const path of ['/api', '/api/', '/api/v1', '/api/v1/nope', '/api/v2/today', '/api/v1/today/extra', '/api/v1/constructor']) {
      const r = await fetch(`${app.base}${path}`, { headers: { cookie } });
      expect(r.status, path).toBe(404);
      expect(r.headers.get('content-type')).toContain('application/json');
    }
  });

  test('ошибка расчёта: клиенту 500 JSON без внутренностей', async () => {
    const broken = await start();
    try {
      broken.setViews(async () => { throw new Error('connection to 10.0.0.5:5432 refused, пароль=hunter2'); });
      const cookie = await signIn(REGULAR, broken.base);
      const r = await fetch(`${broken.base}/api/v1/today`, { headers: { cookie } });
      expect(r.status).toBe(500);
      const text = await r.text();
      expect(JSON.parse(text)).toEqual({ error: 'internal' });
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('5432');
    } finally { broken.close(); }
  });
});

describe('заголовки безопасности', () => {
  const expectBase = (r: Response) => {
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  };

  test('страница входа', async () => {
    const r = await fetch(`${app.base}/login`);
    expectBase(r);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toBeTruthy();
  });

  test('JSON API', async () => {
    const cookie = await signIn();
    for (const r of [
      await fetch(`${app.base}/api/v1/today`, { headers: { cookie } }),
      await fetch(`${app.base}/api/v1/today`),
      await fetch(`${app.base}/api/v1/nope`, { headers: { cookie } }),
    ]) {
      expectBase(r);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('страница интерфейса и переходы', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/`, { headers: { cookie } });
    expectBase(r);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const redirected = await fetch(`${app.base}/`, { redirect: 'manual' });
    expectBase(redirected);
  });

  test('политика содержимого: только свои источники, ничего внешнего', async () => {
    const csp = (await fetch(`${app.base}/login`)).headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:|\*/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  test('статика: запрет угадывать тип и индексацию', async () => {
    const r = await fetch(`${app.base}/assets/app.abc123.js`);
    expectBase(r);
  });
});

describe('интерфейс и статика', () => {
  test('без сессии корень и любые адреса страниц ведут на вход', async () => {
    for (const path of ['/', '/today', '/requests/42', '/reference/groups']) {
      const r = await fetch(`${app.base}${path}`, { redirect: 'manual' });
      expect(r.status, path).toBe(302);
      expect(r.headers.get('location')).toBe('/login');
      expect(await r.text()).not.toContain(INDEX_MARKER);
    }
  });

  test('с сессией корень отдаёт index.html без кэша и с политикой содержимого', async () => {
    const cookie = await signIn();
    const r = await fetch(`${app.base}/`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await r.text()).toContain(INDEX_MARKER);
  });

  test('адреса экранов интерфейса (без расширения) тоже отдают index.html — маршруты рисует интерфейс', async () => {
    const cookie = await signIn();
    for (const path of ['/today', '/requests/42', '/reference/groups?view=1']) {
      const r = await fetch(`${app.base}${path}`, { headers: { cookie } });
      expect(r.status, path).toBe(200);
      expect(await r.text()).toContain(INDEX_MARKER);
    }
  });

  test('index.html напрямую не отдаётся: ни по имени, ни без сессии', async () => {
    const cookie = await signIn();
    for (const headers of [{}, { cookie }]) {
      const r = await fetch(`${app.base}/index.html`, { headers });
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain(INDEX_MARKER);
    }
  });

  test('собранные файлы отдаются без сессии, с вечным кэшем и верным типом', async () => {
    const js = await fetch(`${app.base}/assets/app.abc123.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toContain('console.log');

    const css = await fetch(`${app.base}/assets/app.abc123.css`);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(css.headers.get('cache-control')).toContain('immutable');
  });

  test('нет такого файла в assets: 404 без вечного кэша, а не index.html', async () => {
    const r = await fetch(`${app.base}/assets/нет.js`);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).not.toContain(INDEX_MARKER);
  });

  test('каталог вместо файла и «файл как каталог» — 404', async () => {
    for (const path of ['/assets/', '/assets/app.abc123.js/x', '/assets']) {
      const r = await fetch(`${app.base}${path}`, { redirect: 'manual' });
      expect([302, 404], path).toContain(r.status);
    }
  });

  test('значок сайта в корне отдаётся без сессии, но с коротким кэшем', async () => {
    const r = await fetch(`${app.base}/favicon.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  test('неизвестное расширение не отдаётся: сервер не раздаёт всё подряд', async () => {
    writeFileSync(join(root, 'web-dist', 'assets', 'config.env'), 'X=1');
    const r = await fetch(`${app.base}/assets/config.env`);
    expect(r.status).toBe(404);
  });

  test.each([
    '/assets/../secret.txt',
    '/assets/%2e%2e/secret.txt',
    '/assets/%2E%2E/secret.txt',
    '/assets/..%2fsecret.txt',
    '/assets/%2e%2e%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/../secret.txt',
    '/assets/..%5csecret.txt',
    '/assets/%5c..%5csecret.txt',
    '/assets/..%00/secret.txt',
    '/assets/%00.js',
    '/assets/%',
    '//assets/../../secret.txt',
  ])('выход за каталог интерфейса через %s невозможен', async (path) => {
    const r = await raw(app.base, path);
    expect(r.body).not.toContain(SECRET);
    expect(r.status).not.toBe(200);
  });

  test('кодированный обход не срабатывает и для файлов вне assets, с сессией', async () => {
    const cookie = await signIn();
    const r = await raw(app.base, '/%2e%2e/secret.txt', 'GET', { cookie });
    expect(r.body).not.toContain(SECRET);
  });

  test('интерфейс не собран: файлы — 503 «не собран», страницы для своих — тоже, для чужих — вход', async () => {
    const missing = await start({ webDir: join(root, 'нет-такого-каталога') });
    try {
      const cookie = await signIn(REGULAR, missing.base);
      const asset = await fetch(`${missing.base}/assets/app.js`);
      expect(asset.status).toBe(503);
      expect(await asset.text()).toContain('Интерфейс не собран');

      const page = await fetch(`${missing.base}/`, { headers: { cookie } });
      expect(page.status).toBe(503);
      expect(await page.text()).toContain('Интерфейс не собран');

      const anon = await fetch(`${missing.base}/`, { redirect: 'manual' });
      expect(anon.status).toBe(302);
      // API и вход работают и без интерфейса.
      expect((await fetch(`${missing.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
    } finally { missing.close(); }
  });

  test('каталог есть, а index.html нет: тоже «не собран»', async () => {
    const empty = join(root, 'empty-dist');
    mkdirSync(empty, { recursive: true });
    const half = await start({ webDir: empty });
    try {
      const cookie = await signIn(REGULAR, half.base);
      const page = await fetch(`${half.base}/`, { headers: { cookie } });
      expect(page.status).toBe(503);
      expect(await page.text()).toContain('Интерфейс не собран');
      expect((await fetch(`${half.base}/assets/нет.js`)).status).toBe(404);
    } finally { half.close(); }
  });
});

describe('никаких изменений через GET и чужие методы', () => {
  test('здоровье сервиса: ok без сессии, и только на чтение', async () => {
    const r = await fetch(`${app.base}/health`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
    expect((await fetch(`${app.base}/health`, { method: 'POST' })).status).toBe(404);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s на страницы и статику — 404', async (method) => {
    const cookie = await signIn();
    for (const path of ['/', '/today', '/assets/app.abc123.js', '/favicon.svg', '/anything']) {
      const r = await fetch(`${app.base}${path}`, { method, headers: { cookie }, redirect: 'manual' });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  test('обход всех чтений подряд ничего не разлогинивает и не создаёт', async () => {
    const cookie = await signIn();
    for (const name of API_ROUTES) await fetch(`${app.base}/api/v1/${name}`, { headers: { cookie } });
    await fetch(`${app.base}/`, { headers: { cookie } });
    await fetch(`${app.base}/logout`, { headers: { cookie } });
    expect((await fetch(`${app.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
  });
});


describe('действия координатора над заявкой', () => {
  const act = (cookie: string | null, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/requests/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('без сессии действие не выполняется: 401 и ничего не вызвано', async () => {
    const before = app.actionCalls.length;
    const r = await act(null, '5/approve', { groupId: 1 });
    expect(r.status).toBe(401);
    expect(app.actionCalls.length).toBe(before);
  });

  test.each([['approve', { groupId: 3, force: true }], ['reject', { groupId: 3, reason: 'far' }], ['need-call', { value: true }]])(
    '%s передаёт заявку, тело и автора (логин входа) и сбрасывает снимок',
    async (name, body) => {
      const cookie = await signIn(SUPER);
      const calls = app.actionCalls.length;
      const inv = app.invalidations();
      const r = await act(cookie, `42/${name}`, body);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
      expect(app.actionCalls.slice(calls)).toEqual([{ name, id: 42, body, actor: SUPER.login }]);
      expect(app.invalidations()).toBe(inv + 1);
    },
  );

  test('обычный вход пишется в журнал под своим логином', async () => {
    const cookie = await signIn(REGULAR);
    await act(cookie, '7/need-call', { value: false });
    expect(app.actionCalls.at(-1)!.actor).toBe(REGULAR.login);
  });

  test.each([
    ['bad_request', 400], ['not_found', 404], ['already_closed', 409], ['group_unavailable', 409], ['group_full', 409],
  ] as const)('ошибка %s отвечает кодом %i и текстом, снимок не сбрасывается', async (error, status) => {
    const cookie = await signIn();
    app.setOutcome({ ok: false, error, message: 'Пояснение.' });
    const inv = app.invalidations();
    try {
      const r = await act(cookie, '1/approve', { groupId: 1 });
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error, message: 'Пояснение.' });
      expect(app.invalidations()).toBe(inv);
    } finally {
      app.setOutcome({ ok: true });
    }
  });

  test('форма с другого сайта (не JSON) отклоняется: 415 и ничего не вызвано', async () => {
    const cookie = await signIn();
    const before = app.actionCalls.length;
    const r = await act(cookie, '1/approve', 'groupId=1', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
    expect(app.actionCalls.length).toBe(before);
  });

  test('сломанный JSON — 400, слишком большое тело — 413', async () => {
    const cookie = await signIn();
    expect((await act(cookie, '1/approve', '{не json')).status).toBe(400);
    expect((await act(cookie, '1/approve', JSON.stringify({ groupId: 1, pad: 'я'.repeat(40_000) }))).status).toBe(413);
  });

  test('чужие адреса действий — 404, а GET по адресу действия не выполняет его', async () => {
    const cookie = await signIn();
    const before = app.actionCalls.length;
    for (const path of ['abc/approve', '1/remove', '1/approve/extra', '1']) {
      expect((await act(cookie, path, { groupId: 1 })).status, path).toBe(404);
    }
    const g = await fetch(`${app.base}/api/v1/requests/1/approve`, { headers: { cookie } });
    expect(g.status).toBe(404);
    expect(app.actionCalls.length).toBe(before);
  });
});


describe('подбор для новых заявок', () => {
  const call = (cookie: string | null, name: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/matching/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('без сессии подбор не запускается', async () => {
    const before = app.matchingCalls.length;
    expect((await call(null, 'run', {})).status).toBe(401);
    expect((await call(null, 'auto', { enabled: true })).status).toBe(401);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('запуск доступен обычному входу и отвечает итогом; автор — логин входа', async () => {
    const cookie = await signIn(REGULAR);
    const r = await call(cookie, 'run', {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, created: 2, replaced: 1, unchanged: 3 });
    expect(app.matchingCalls.at(-1)).toEqual({ name: 'run', actor: REGULAR.login });
  });

  test('автоматический режим обычному входу недоступен: 403 и ничего не вызвано', async () => {
    const cookie = await signIn(REGULAR);
    const before = app.matchingCalls.length;
    const r = await call(cookie, 'auto', { enabled: true });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: 'forbidden' });
    expect(app.matchingCalls.length).toBe(before);
  });

  test.each([true, false])('полный вход переключает автоматический режим (%s)', async (enabled) => {
    const cookie = await signIn(SUPER);
    const r = await call(cookie, 'auto', { enabled });
    expect(r.status).toBe(200);
    expect(app.matchingCalls.at(-1)).toEqual({ name: 'auto', actor: SUPER.login, enabled });
  });

  test.each([{}, { enabled: 'да' }, { enabled: 1 }, null, []])('переключатель с телом %j — 400', async (body) => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    expect((await call(cookie, 'auto', body)).status).toBe(400);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('форма с другого сайта (не JSON) отклоняется: 415', async () => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    const r = await call(cookie, 'run', 'x=1', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
    expect(app.matchingCalls.length).toBe(before);
  });

  test('чужие адреса — 404, GET по адресу подбора его не запускает', async () => {
    const cookie = await signIn(SUPER);
    const before = app.matchingCalls.length;
    expect((await call(cookie, 'other', {})).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/matching/run`, { headers: { cookie } })).status).toBe(404);
    expect(app.matchingCalls.length).toBe(before);
  });
});


describe('раздел «Настройки»', () => {
  const get = (cookie: string | null, name: string) =>
    fetch(`${app.base}/api/v1/settings/${name}`, { headers: cookie ? { cookie } : {} });
  const post = (cookie: string | null, name: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/settings/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test.each(['health', 'errors', 'audit', 'prompts'])('%s: без сессии 401, обычный вход 403, полный — 200; данные не читаются без прав', async (name) => {
    const before = app.settingsCalls.length;
    expect((await get(null, name)).status).toBe(401);
    expect((await get(await signIn(REGULAR), name)).status).toBe(403);
    expect(app.settingsCalls.length).toBe(before);
    const r = await get(await signIn(SUPER), name);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ generatedAt: 'g' });
    expect(app.settingsCalls.at(-1)!.name).toBe(name);
  });

  test('ответы 403 и 200 не кэшируются', async () => {
    const r = await get(await signIn(SUPER), 'health');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  test.each(['save', 'activate'])('%s: обычному входу 403 и ничего не вызвано', async (name) => {
    const before = app.settingsCalls.length;
    const r = await post(await signIn(REGULAR), `prompts/${name}`, { agent: 'coordinator', block: 'role', text: 'x', version: 1 });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: 'forbidden' });
    expect(app.settingsCalls.length).toBe(before);
  });

  test('сохранение передаёт тело и логин автора, при успехе 200', async () => {
    const body = { agent: 'coordinator', block: 'role', text: 'Новый текст', note: 'п' };
    const r = await post(await signIn(SUPER), 'prompts/save', body);
    expect(r.status).toBe(200);
    expect(app.settingsCalls.at(-1)).toEqual({ name: 'save', actor: SUPER.login, body });
  });

  test('откат передаёт тело и автора', async () => {
    const body = { agent: 'coordinator', block: 'role', version: 2 };
    await post(await signIn(SUPER), 'prompts/activate', body);
    expect(app.settingsCalls.at(-1)).toEqual({ name: 'activate', actor: SUPER.login, body });
  });

  test.each([['bad_request', 400], ['not_found', 404]] as const)('ошибка %s отвечает %i с текстом', async (error, status) => {
    app.setSettingsOutcome({ ok: false, error, message: 'Пояснение.' });
    try {
      const r = await post(await signIn(SUPER), 'prompts/save', { agent: 'coordinator', block: 'role', text: '' });
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error, message: 'Пояснение.' });
    } finally { app.setSettingsOutcome({ ok: true }); }
  });

  test('форма с другого сайта (не JSON) отклоняется: 415', async () => {
    const r = await post(await signIn(SUPER), 'prompts/save', 'text=x', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
  });

  test('чужие адреса — 404, GET по адресу правки её не выполняет', async () => {
    const cookie = await signIn(SUPER);
    const before = app.settingsCalls.length;
    expect((await post(cookie, 'prompts/delete', {})).status).toBe(404);
    expect((await get(cookie, 'prompts/save')).status).toBe(404);
    expect((await get(cookie, 'secrets')).status).toBe(404);
    expect(app.settingsCalls.length).toBe(before);
  });

  test('ошибка обработки запроса записывается в журнал: источник, текст и «метод путь» без строки запроса', async () => {
    const cookie = await signIn();
    app.setViews(async () => { throw new Error('расчёт сломался'); });
    try {
      const r = await fetch(`${app.base}/api/v1/today?x=1`, { headers: { cookie } });
      expect(r.status).toBe(500);
      expect(app.reported.at(-1)).toEqual({ source: 'домашние группы', message: 'расчёт сломался', context: 'GET /api/v1/today' });
    } finally { app.setViews(async () => sampleViews()); }
  });
});


describe('личные входы: страницы по ссылке', () => {
  const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${app.base}${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp(), ...headers },
      body: new URLSearchParams(fields),
    });

  test('страница входа ведёт на «Забыли пароль»', async () => {
    const html = await (await fetch(`${app.base}/login`)).text();
    expect(html).toContain('href="/forgot"');
  });

  test('после смены пароля вход показывает сообщение; неизвестный код сообщения игнорируется', async () => {
    expect(await (await fetch(`${app.base}/login?notice=password_set`)).text()).toContain('Пароль задан');
    expect(await (await fetch(`${app.base}/login?notice=<script>`)).text()).not.toContain('<script>');
  });

  test('«забыли пароль» отвечает одинаково и без сессии, письмо не ждёт', async () => {
    const before = app.staffCalls.length;
    const known = await form('/forgot', { identifier: 'p_ivanova' });
    const unknown = await form('/forgot', { identifier: 'nobody' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text());
    expect(app.staffCalls.slice(before).map((c) => c.name)).toEqual(['requestReset', 'requestReset']);
    expect(app.staffCalls.at(-1)!.args[0]).toBe('nobody');
  });

  test('«забыли пароль»: форма с другого сайта не JSON-типа отклоняется, а JSON не годится вовсе', async () => {
    const r = await fetch(`${app.base}/forgot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(415);
  });

  test('страница по ссылке показывает имя и логин; негодная ссылка — «не работает» без подробностей', async () => {
    const ok = await (await fetch(`${app.base}/set-password?token=T1`)).text();
    expect(ok).toContain('Полина Иванова');
    expect(ok).toContain('p_ivanova');
    expect(ok).toContain('name="token" value="T1"');
    app.setTokenInfo(null);
    try {
      const bad = await fetch(`${app.base}/set-password?token=T1`);
      expect(await bad.text()).toContain('Ссылка не работает');
    } finally { app.setTokenInfo({ fullName: 'Полина Иванова', login: 'p_ivanova' }); }
  });

  test('токен в странице экранируется: подмена атрибута не проходит', async () => {
    const html = await (await fetch(`${app.base}/set-password?token=${encodeURIComponent('"><script>alert(1)</script>')}`)).text();
    expect(html).not.toContain('<script>alert(1)');
  });

  test('страница с токеном не кэшируется и не отдаёт адрес сайтам по ссылке', async () => {
    const r = await fetch(`${app.base}/set-password?token=T1`);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('успешная смена пароля перенаправляет ко входу с сообщением', async () => {
    const r = await form('/set-password', { token: 'T1', password: 'сиреневый-туман-42', password2: 'сиреневый-туман-42' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/login?notice=password_set');
    expect(app.staffCalls.at(-1)).toMatchObject({ name: 'complete' });
    expect(app.staffCalls.at(-1)!.args.slice(0, 3)).toEqual(['T1', 'сиреневый-туман-42', 'сиреневый-туман-42']);
  });

  test('слабый пароль: форма показывается снова с причиной, а пароль не повторяется в странице', async () => {
    app.setComplete({ ok: false, error: 'bad_request', message: 'Пароль слишком короткий.' });
    try {
      const r = await form('/set-password', { token: 'T1', password: 'секрет-коротко', password2: 'секрет-коротко' });
      const html = await r.text();
      expect(r.status).toBe(400);
      expect(html).toContain('Пароль слишком короткий.');
      expect(html).not.toContain('секрет-коротко');
    } finally { app.setComplete({ ok: true }); }
  });

  test('ссылка стала негодной между открытием и отправкой: общая страница «не работает»', async () => {
    app.setComplete({ ok: false, error: 'bad_request', message: 'Ссылка недействительна.' });
    app.setTokenInfo(null);
    try {
      const r = await form('/set-password', { token: 'T1', password: 'x'.repeat(12), password2: 'x'.repeat(12) });
      expect(r.status).toBe(410);
      expect(await r.text()).toContain('Ссылка не работает');
    } finally { app.setComplete({ ok: true }); app.setTokenInfo({ fullName: 'Полина Иванова', login: 'p_ivanova' }); }
  });

  test('другие методы на страницах пароля — 404', async () => {
    for (const path of ['/forgot', '/set-password']) {
      expect((await fetch(`${app.base}${path}`, { method: 'PUT' })).status, path).toBe(404);
      expect((await fetch(`${app.base}${path}`, { method: 'DELETE' })).status, path).toBe(404);
    }
  });
});

describe('личные входы: API пользователей', () => {
  const call = (cookie: string | null, name: string, body: unknown) =>
    fetch(`${app.base}/api/v1/settings/staff${name ? `/${name}` : ''}`, {
      method: name ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(name ? { body: JSON.stringify(body) } : {}),
    });

  test('список: без сессии 401, обычному входу 403, полному 200', async () => {
    expect((await call(null, '', null)).status).toBe(401);
    expect((await call(await signIn(REGULAR), '', null)).status).toBe(403);
    const r = await call(await signIn(SUPER), '', null);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ personal: { enabled: false } });
  });

  test.each(['suggest', 'create', 'update', 'invite', 'reset', 'personal-mode'])('%s: обычному входу 403 и ничего не вызвано', async (name) => {
    const before = app.staffCalls.length;
    const r = await call(await signIn(REGULAR), name, { id: 1 });
    expect(r.status).toBe(403);
    expect(app.staffCalls.length).toBe(before);
  });

  test.each([
    ['suggest', 'suggest'], ['create', 'create'], ['update', 'update'], ['invite', 'invite'], ['reset', 'reset'], ['personal-mode', 'mode'],
  ])('%s передаёт тело и логин автора и отвечает 200', async (name, recorded) => {
    const body = { id: 7, enabled: true };
    const r = await call(await signIn(SUPER), name, body);
    expect(r.status).toBe(200);
    expect(app.staffCalls.at(-1)!.name).toBe(recorded);
    if (name !== 'suggest') expect(app.staffCalls.at(-1)!.args).toEqual([body, SUPER.login]);
  });

  test('ответ создания несёт способ доставки и путь для передачи ссылки', async () => {
    const r = await call(await signIn(SUPER), 'create', { fullName: 'Полина Иванова', email: 'e@e.ee', role: 'admin' });
    expect(await r.json()).toMatchObject({ ok: true, delivery: 'link', path: '/set-password?token=T', login: 'p_ivanova', id: 1 });
  });

  test('чужие адреса — 404', async () => {
    expect((await call(await signIn(SUPER), 'delete', { id: 1 })).status).toBe(404);
  });
});


describe('создание записей и справочники форм', () => {
  const create = (cookie: string | null, what: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/v1/${what}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('без сессии создать нельзя: 401 и ничего не вызвано', async () => {
    const before = app.createCalls.length;
    expect((await create(null, 'requests', { fields: {} })).status).toBe(401);
    expect(app.createCalls.length).toBe(before);
  });

  test.each(['requests', 'groups'])('%s: тело и логин автора передаются, ответ несёт номер, снимок сбрасывается', async (what) => {
    const cookie = await signIn(REGULAR);
    const inv = app.invalidations();
    const body = { fields: { fio: 'Мария' } };
    const r = await create(cookie, what, body);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, id: 77 });
    expect(app.createCalls.at(-1)).toEqual({ what: what === 'requests' ? 'request' : 'group', body, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('ошибка проверки — 400 с текстом сервера, снимок не сбрасывается', async () => {
    app.setCreate({ ok: false, error: 'bad_request', message: 'Укажите ФИО.' });
    try {
      const inv = app.invalidations();
      const r = await create(await signIn(), 'requests', { fields: {} });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'bad_request', message: 'Укажите ФИО.' });
      expect(app.invalidations()).toBe(inv);
    } finally { app.setCreate({ ok: true, id: 77 }); }
  });

  test('форма с другого сайта (не JSON) отклоняется: 415', async () => {
    const r = await create(await signIn(), 'groups', 'fields=1', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(415);
  });

  test('чужие адреса создания — 404', async () => {
    expect((await create(await signIn(), 'staff', { fields: {} })).status).toBe(404);
  });

  test('регистрация участника: тело и автор передаются, ответ несёт номер регистрации, снимок сбрасывается', async () => {
    const cookie = await signIn(REGULAR);
    const inv = app.invalidations();
    const body = { fields: { fio: 'Иван Петров', phone: '+7 911 000-11-22' } };
    const r = await create(cookie, 'people', body);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, id: 77, registrationNo: 4242 });
    expect(app.createCalls.at(-1)).toEqual({ what: 'registration', body, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('регистрация без сессии — 401 и ничего не вызвано', async () => {
    const before = app.createCalls.length;
    expect((await create(null, 'people', { fields: {} })).status).toBe(401);
    expect(app.createCalls.length).toBe(before);
  });

  describe('карточка регистрации', () => {
    const get = (path: string, cookie?: string) => fetch(`${app.base}${path}`, { headers: cookie ? { cookie } : {} });

    test('без сессии ни карточка, ни QR, ни эмблема не открываются', async () => {
      for (const path of ['/api/v1/people/5/card', '/api/v1/people/5/qr', '/api/v1/assets/church-logo.png']) {
        expect((await get(path)).status, path).toBe(401);
      }
    });

    test('карточка — HTML со ссылками на QR и эмблему внутри сервиса, без кэша', async () => {
      const r = await get('/api/v1/people/5/card', await signIn());
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/text\/html/);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const html = await r.text();
      expect(html).toContain('Иван Петров');
      expect(html).toContain('/api/v1/people/5/qr');
      expect(html).toContain('/api/v1/assets/church-logo.png');
    });

    test('QR и эмблема — PNG без кэша; чужой номер — 404', async () => {
      const cookie = await signIn();
      const qr = await get('/api/v1/people/5/qr', cookie);
      expect(qr.status).toBe(200);
      expect(qr.headers.get('content-type')).toBe('image/png');
      expect(qr.headers.get('cache-control')).toBe('no-store');
      expect((await get('/api/v1/assets/church-logo.png', cookie)).headers.get('content-type')).toBe('image/png');
      expect((await get('/api/v1/people/6/qr', cookie)).status).toBe(404);
      expect((await get('/api/v1/people/6/card', cookie)).status).toBe(404);
    });

    test('номер не из цифр не доходит до базы: 404', async () => {
      expect((await get('/api/v1/people/abc/card', await signIn())).status).toBe(404);
    });
  });

  test('справочники форм: без сессии 401, с сессией — списки', async () => {
    expect((await fetch(`${app.base}/api/v1/form-meta`)).status).toBe(401);
    const r = await fetch(`${app.base}/api/v1/form-meta`, { headers: { cookie: await signIn(REGULAR) } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ districts: ['Приморский'] });
  });

  test('«кто я» отдаёт роль', async () => {
    const r = await fetch(`${app.base}/api/v1/me`, { headers: { cookie: await signIn(REGULAR) } });
    expect(await r.json()).toMatchObject({ role: 'admin' });
  });

  test('правка параметров заявки передаёт тело и автора', async () => {
    const cookie = await signIn(SUPER);
    const body = { street: 'ул. Рылеева 32', schedule: 'пн, ср вечером' };
    const r = await fetch(`${app.base}/api/v1/requests/12/params`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(r.status).toBe(200);
    expect(app.actionCalls.at(-1)).toEqual({ name: 'params', id: 12, body, actor: SUPER.login });
  });
});


describe('рабочие действия координатора: правка, «в работе у», итог звонка', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/requests/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test.each(['edit', 'assign', 'call'])('%s без сессии — 401 и ничего не вызвано', async (action) => {
    const before = app.actionCalls.length;
    expect((await post(null, `12/${action}`, {})).status).toBe(401);
    expect(app.actionCalls.length).toBe(before);
  });

  test.each([
    ['edit', { phone: '+7 921 555-00-11' }], ['assign', { responsible: 'Анна Смирнова' }], ['call', { result: 'reached', comment: 'ок' }],
  ])('%s: тело и автор передаются, снимок сбрасывается', async (action, body) => {
    const inv = app.invalidations();
    const r = await post(await signIn(REGULAR), `12/${action}`, body);
    expect(r.status).toBe(200);
    expect(app.actionCalls.at(-1)).toEqual({ name: action, id: 12, body, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });
});

describe('руководитель: массовые действия, правка и удаление справочника, выгрузка', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const get = (cookie: string | null, path: string) => fetch(`${app.base}/api/v1/${path}`, { headers: cookie ? { cookie } : {} });

  test('массовое действие: без сессии 401, с сессией — тело и автор передаются, ответ с числами, снимок сбрасывается', async () => {
    expect((await post(null, 'requests/bulk', {})).status).toBe(401);
    const inv = app.invalidations();
    const body = { ids: [1, 2, 3], action: 'assign', responsible: 'Анна' };
    const r = await post(await signIn(REGULAR), 'requests/bulk', body);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, done: 2, skipped: 1 });
    expect(app.actionCalls.at(-1)).toEqual({ name: 'bulk', id: 0, body, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test.each([
    ['groups/5/update', { fields: { people: '8' } }, 'group.update'],
    ['coordinators/5/update', { fields: { role: 'x' } }, 'coordinator.update'],
  ])('%s доступно и обычному входу', async (path, body, name) => {
    const r = await post(await signIn(REGULAR), path, body);
    expect(r.status).toBe(200);
    expect(app.actionCalls.at(-1)).toEqual({ name, id: 5, body, actor: REGULAR.login });
  });

  test.each([
    ['groups/5/delete', 'group.delete'], ['coordinators/5/delete', 'coordinator.delete'], ['requests/5/delete', 'request.delete'],
  ])('%s: обычному входу 403 и ничего не вызвано, полному — выполняется', async (path, name) => {
    const before = app.actionCalls.length;
    const denied = await post(await signIn(REGULAR), path, {});
    expect(denied.status).toBe(403);
    expect(app.actionCalls.length).toBe(before);
    const ok = await post(await signIn(SUPER), path, {});
    expect(ok.status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name, id: 5, actor: SUPER.login });
  });

  test('новый координатор заводится через общий путь создания', async () => {
    const r = await post(await signIn(REGULAR), 'coordinators/create', { fields: { name: 'Анна', role: 'Координатор' } });
    expect(r.status).toBe(200);
    expect(app.createCalls.at(-1)).toMatchObject({ what: 'coordinator', actor: REGULAR.login });
  });

  test('выгрузка CSV: без сессии 401, обычному входу 403, полному — файл и запись в журнал без содержимого', async () => {
    expect((await get(null, 'export/requests.csv')).status).toBe(401);
    expect((await get(await signIn(REGULAR), 'export/requests.csv')).status).toBe(403);
    const before = app.auditCalls.length;
    const r = await get(await signIn(SUPER), 'export/requests.csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="requests-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toContain('Мария');
    expect(app.auditCalls.length).toBe(before + 1);
    expect(app.auditCalls.at(-1)).toEqual({ actor: SUPER.login, action: 'export.csv', after: { what: 'requests' } });
  });

  test('выгрузка людей — те же правила', async () => {
    expect((await get(await signIn(REGULAR), 'export/people.csv')).status).toBe(403);
    expect((await get(await signIn(SUPER), 'export/people.csv')).status).toBe(200);
  });

  test('сводка команды отдаётся после входа', async () => {
    expect((await get(null, 'team')).status).toBe(401);
    const r = await get(await signIn(REGULAR), 'team');
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveProperty('totals');
  });
});

describe('состав группы и карточки людей', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('без входа 401, любой вход добавляет человека, правит и убирает; снимок сбрасывается', async () => {
    expect((await post(null, 'groups/5/members/create', { personKey: 'u1' })).status).toBe(401);
    const cookie = await signIn(REGULAR);
    const inv = app.invalidations();
    const add = await post(cookie, 'groups/5/members/create', { personKey: 'u1' });
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ ok: true, id: 77, personKey: 'u1' });
    expect(app.actionCalls.at(-1)).toEqual({ name: 'member.add', id: 5, body: { personKey: 'u1' }, actor: REGULAR.login });
    expect((await post(cookie, 'members/9/update', { fields: { note: 'x' } })).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'member.update', id: 9 });
    expect((await post(cookie, 'members/9/delete', {})).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'member.remove', id: 9, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 3);
  });

  test('контакты человека (u<id>, r<id>): правит любой вход, ключ передаётся как есть, список перечитывается', async () => {
    const reg = await signIn(REGULAR);
    const inv = app.invalidations();
    expect((await post(reg, 'people/u12/update', { fields: { address: 'Коллонтай 5' } })).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'contact.update', key: 'u12', actor: REGULAR.login });
    expect((await post(reg, 'people/r345/update', { fields: { fio: 'Анна' } })).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ key: 'r345' });
    expect(app.invalidations()).toBe(inv + 2);
    expect((await post(reg, 'people/p3/update', { fields: { fio: 'Анна' } })).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/people/u12/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  test('карточка человека: правит любой вход, удаляет только полный', async () => {
    const reg = await signIn(REGULAR);
    expect((await post(reg, 'persons/3/update', { fields: { fio: 'Анна' } })).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'person.update', id: 3 });
    const before = app.actionCalls.length;
    expect((await post(reg, 'persons/3/delete', {})).status).toBe(403);
    expect(app.actionCalls.length).toBe(before);
    expect((await post(await signIn(SUPER), 'persons/3/delete', {})).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'person.delete', id: 3, actor: SUPER.login });
  });

  test('чужие адреса — 404', async () => {
    const cookie = await signIn(REGULAR);
    for (const path of ['groups/abc/members/create', 'members/9/archive', 'members/create', 'groups/5/members', 'persons/x/update']) {
      expect((await post(cookie, path, {})).status, path).toBe(404);
    }
  });
});

describe('чат помощника', () => {
  const post = (cookie: string | null, body: unknown) => fetch(`${app.base}/api/v1/assistant/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('без входа 401; с входом любой вопрос уходит в чат вместе с автором, ответ возвращается как есть', async () => {
    expect((await post(null, { messages: [] })).status).toBe(401);
    const body = { messages: [{ role: 'user', content: 'Где перебор?' }] };
    const r = await post(await signIn(REGULAR), body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, answer: 'Перебор в ДГ-0001.' });
    expect(app.chatCalls.at(-1)).toEqual({ body, actor: REGULAR.login });
  });

  test('не подключён → 503, лимит вопросов → 409, неверный вопрос → 400, и всё с текстом', async () => {
    const cookie = await signIn(REGULAR);
    try {
      for (const [error, status] of [['unavailable', 503], ['conflict', 409], ['bad_request', 400]] as const) {
        app.setChatOutcome({ ok: false, error, message: `текст ${error}` });
        const r = await post(cookie, { messages: [{ role: 'user', content: 'x' }] });
        expect(r.status).toBe(status);
        expect(await r.json()).toEqual({ error, message: `текст ${error}` });
      }
    } finally { app.setChatOutcome({ ok: true, answer: 'Перебор в ДГ-0001.', queries: [], tables: [] }); }
  });

  test('история чата: без входа 401; с входом отдаётся история именно этого входа, без кэша', async () => {
    const url = `${app.base}/api/v1/assistant/chat/history`;
    expect((await fetch(url)).status).toBe(401);
    const r = await fetch(url, { headers: { cookie: await signIn(REGULAR) } });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ messages: [{ role: 'user', content: 'Где перебор?' }, { role: 'assistant', content: 'В ДГ-0001.' }] });
    expect(app.chatCalls.at(-1)).toEqual({ body: 'history', actor: REGULAR.login });
  });

  test('очистка истории: без входа 401, с входом стирается история этого входа; GET по этому адресу — 404', async () => {
    const url = `${app.base}/api/v1/assistant/chat/clear`;
    expect((await post(null, {})).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const cookie = await signIn(REGULAR);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
    expect(await r.json()).toEqual({ ok: true });
    expect(app.chatCalls.at(-1)).toEqual({ body: 'clear', actor: REGULAR.login });
    expect((await fetch(url, { headers: { cookie } })).status).toBe(404);
  });

  test('форма с другого сайта (не JSON) отклоняется: 415', async () => {
    const r = await fetch(`${app.base}/api/v1/assistant/chat`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: await signIn(REGULAR) }, body: 'messages=1',
    });
    expect(r.status).toBe(415);
  });

  test('«кто я» сообщает состояние помощника для кнопки', async () => {
    const me = await (await fetch(`${app.base}/api/v1/me`, { headers: { cookie: await signIn(REGULAR) } })).json();
    expect(me).toEqual({ role: 'admin', assistant: { available: true, enabled: true, chat: true } });
  });
});

describe('помощник по разбору заявок', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('запуск: без входа 401, любой вход запускает, ответ с числами, снимок сбрасывается', async () => {
    expect((await post(null, 'assistant/run', {})).status).toBe(401);
    const inv = app.invalidations();
    const r = await post(await signIn(REGULAR), 'assistant/run', {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, asked: 3, filled: 2, withQuestions: 1, proposals: 1 });
    expect(app.assistantCalls.at(-1)).toEqual({ name: 'run', actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('помощник не подключён или выключен — 503 с понятным текстом; уже идёт разбор — 409', async () => {
    try {
      app.setAssistantOutcome({ ok: false, error: 'unavailable', message: 'Помощник выключен.' });
      const off = await post(await signIn(REGULAR), 'assistant/run', {});
      expect(off.status).toBe(503);
      expect(await off.json()).toEqual({ error: 'unavailable', message: 'Помощник выключен.' });
      app.setAssistantOutcome({ ok: false, error: 'conflict', message: 'Разбор уже идёт.' });
      expect((await post(await signIn(REGULAR), 'assistant/run', {})).status).toBe(409);
    } finally { app.setAssistantOutcome({ ok: true, asked: 3, filled: 2, withQuestions: 1, proposals: 1 }); }
  });

  test('настройки помощника — только полный вход; переключатель принимает только true или false', async () => {
    const reg = await signIn(REGULAR);
    expect((await fetch(`${app.base}/api/v1/settings/assistant`, { headers: { cookie: reg } })).status).toBe(403);
    expect((await post(reg, 'settings/assistant/enabled', { enabled: true })).status).toBe(403);
    const sup = await signIn(SUPER);
    const view = await fetch(`${app.base}/api/v1/settings/assistant`, { headers: { cookie: sup } });
    expect(await view.json()).toMatchObject({ available: true, enabled: false, model: 'fake' });
    expect((await post(sup, 'settings/assistant/enabled', { enabled: true })).status).toBe(200);
    expect(app.assistantCalls.at(-1)).toEqual({ name: 'enabled', actor: SUPER.login, enabled: true });
    const before = app.assistantCalls.length;
    for (const body of [{}, { enabled: 'да' }, null, { enabled: 1 }]) {
      expect((await post(sup, 'settings/assistant/enabled', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(app.assistantCalls.length).toBe(before);
  });

  test('в обзоре помощника есть подключение (провайдер, модель, последние символы ключа), но самого ключа нет', async () => {
    const view = await fetch(`${app.base}/api/v1/settings/assistant`, { headers: { cookie: await signIn(SUPER) } });
    const body = await view.json();
    expect(body).toMatchObject({ available: true, llm: { provider: 'deepseek', model: 'deepseek-chat', keySet: true, keyHint: 'ABCD' } });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|api_key/);
  });

  test('сохранить подключение и проверить его можно только с полного входа: без входа 401, обычному 403, и ничего не вызвано', async () => {
    const before = app.llmCalls.length;
    for (const path of ['settings/assistant/llm', 'settings/assistant/llm-test']) {
      expect((await post(null, path, { provider: 'deepseek', model: 'm' })).status, path).toBe(401);
      expect((await post(await signIn(REGULAR), path, { provider: 'deepseek', model: 'm', apiKey: 'sk-1234567890' })).status, path).toBe(403);
    }
    expect(app.llmCalls.length).toBe(before);
  });

  test('полный вход: тело и автор доходят до сохранения, ошибка проверки сервера возвращается кодом 400', async () => {
    const sup = await signIn(SUPER);
    const body = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-1234567890' };
    const saved = await post(sup, 'settings/assistant/llm', body);
    expect(saved.status).toBe(200);
    expect(app.llmCalls.at(-1)).toEqual({ name: 'save', body, actor: SUPER.login });
    app.setLlmSave({ ok: false, error: 'bad_request', message: 'Выберите провайдера из списка.' });
    const refused = await post(sup, 'settings/assistant/llm', { provider: 'x', model: 'm' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'bad_request', message: 'Выберите провайдера из списка.' });
  });

  test('проверка подключения: отказ провайдера приходит обычным ответом 200 с причиной, а не ошибкой запроса', async () => {
    const sup = await signIn(SUPER);
    const ok = await post(sup, 'settings/assistant/llm-test', { provider: 'deepseek', model: 'deepseek-chat' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, provider: 'DeepSeek', model: 'deepseek-chat', ms: 700 });
    app.setLlmTest({ ok: false, code: 'auth', message: 'Провайдер не принял ключ (код 401).', status: 401 });
    const bad = await post(sup, 'settings/assistant/llm-test', { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-1234567890' });
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ ok: false, code: 'auth', status: 401 });
  });

  test('ключ геокодера: читать, сохранять и проверять можно только с полного входа, ключ в ответе не отдаётся', async () => {
    const before = app.llmCalls.length;
    for (const path of ['settings/geocoder', 'settings/geocoder-test']) {
      expect((await post(null, path, { apiKey: 'AAAAAAAA-1111' })).status, path).toBe(401);
      expect((await post(await signIn(REGULAR), path, { apiKey: 'AAAAAAAA-1111' })).status, path).toBe(403);
    }
    expect((await fetch(`${app.base}/api/v1/settings/geocoder`, { headers: { cookie: await signIn(REGULAR) } })).status).toBe(403);
    expect(app.llmCalls.length).toBe(before);
    const sup = await signIn(SUPER);
    const view = await (await fetch(`${app.base}/api/v1/settings/geocoder`, { headers: { cookie: sup } })).text();
    expect(JSON.parse(view)).toMatchObject({ keySet: true, keyHint: 'WXYZ', usedToday: 3, dailyLimit: 900 });
    expect(view).not.toMatch(/apiKey|api_key/i);
    expect((await post(sup, 'settings/geocoder', { apiKey: 'AAAAAAAA-1111' })).status).toBe(200);
    expect(app.llmCalls.at(-1)).toEqual({ name: 'geo-save', body: { apiKey: 'AAAAAAAA-1111' }, actor: SUPER.login });
    const test = await post(sup, 'settings/geocoder-test', {});
    expect(await test.json()).toEqual({ ok: true, ms: 5 });
  });

  test('таблица адресов и повтор по строке — только полному входу; повтор доходит до обработчика с адресом', async () => {
    expect((await fetch(`${app.base}/api/v1/settings/geocoder/addresses`, { headers: { cookie: await signIn(REGULAR) } })).status).toBe(403);
    expect((await post(await signIn(REGULAR), 'settings/geocoder-retry', { address: 'ул. Тест, 1' })).status).toBe(403);
    const sup = await signIn(SUPER);
    const table = await (await fetch(`${app.base}/api/v1/settings/geocoder/addresses`, { headers: { cookie: sup } })).json();
    expect(table.items[0]).toMatchObject({ address: 'ул. Тест, 1', state: 'missing', sources: [{ kind: 'group', id: '7' }] });
    expect((await post(sup, 'settings/geocoder-retry', { address: 'ул. Тест, 1' })).status).toBe(200);
    expect(app.llmCalls.at(-1)).toEqual({ name: 'geo-retry', body: { address: 'ул. Тест, 1' } });
    expect((await post(await signIn(REGULAR), 'settings/geocoder-reject', { address: 'ул. Тест, 1' })).status).toBe(403);
    expect((await post(sup, 'settings/geocoder-reject', { address: 'ул. Тест, 1' })).status).toBe(200);
    expect(app.llmCalls.at(-1)).toEqual({ name: 'geo-reject', body: { address: 'ул. Тест, 1' } });
  });

  test('роли команды: список и правка только у полного входа; правка сбрасывает снимок, отказ приходит словами', async () => {
    expect((await fetch(`${app.base}/api/v1/settings/team-roles`, { headers: { cookie: await signIn(REGULAR) } })).status).toBe(403);
    expect((await post(await signIn(REGULAR), 'settings/team-roles/create', { name: 'Пастор' })).status).toBe(403);
    const sup = await signIn(SUPER);
    const view = await fetch(`${app.base}/api/v1/settings/team-roles`, { headers: { cookie: sup } });
    expect(await view.json()).toEqual({ items: [{ id: 1, name: 'Распределитель', kind: 'distributor', members: 2 }] });
    const inv = app.invalidations();
    const made = await post(sup, 'settings/team-roles/create', { name: 'Пастор', kind: null });
    expect(await made.json()).toEqual({ ok: true, id: 7 });
    expect(app.kitCalls.at(-1)).toEqual({ name: 'role.create', body: { name: 'Пастор', kind: null }, actor: SUPER.login });
    expect((await post(sup, 'settings/team-roles/update', { id: 7, name: 'Пастор церкви' })).status).toBe(200);
    expect(app.invalidations()).toBe(inv + 2);
    const refused = await post(sup, 'settings/team-roles/delete', { id: 1 });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'conflict', message: expect.stringMatching(/сначала смените им роль/) });
    expect((await fetch(`${app.base}/api/v1/settings/team-roles/delete`, { headers: { cookie: sup } })).status).toBe(404);
  });

  test('направления групп: список и правка только у полного входа; правка сбрасывает снимок, отказ приходит словами', async () => {
    expect((await fetch(`${app.base}/api/v1/settings/directions`, { headers: { cookie: await signIn(REGULAR) } })).status).toBe(403);
    expect((await post(await signIn(REGULAR), 'settings/directions/create', { name: 'Филиал «Север»' })).status).toBe(403);
    const sup = await signIn(SUPER);
    const view = await fetch(`${app.base}/api/v1/settings/directions`, { headers: { cookie: sup } });
    expect(await view.json()).toEqual({ items: [{ id: 1, name: 'Основное служение', groups: 70 }] });
    const inv = app.invalidations();
    expect(await (await post(sup, 'settings/directions/create', { name: 'Филиал «Север»' })).json()).toEqual({ ok: true, id: 5 });
    expect(app.kitCalls.at(-1)).toEqual({ name: 'direction.create', body: { name: 'Филиал «Север»' }, actor: SUPER.login });
    expect((await post(sup, 'settings/directions/update', { id: 5, name: 'Филиал «Северный»' })).status).toBe(200);
    expect(app.invalidations()).toBe(inv + 2);
    const refused = await post(sup, 'settings/directions/delete', { id: 1 });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'conflict', message: expect.stringMatching(/сначала смените им направление/) });
  });

  test('ключ карты: настройки и сохранение только у полного входа, а страница получает ключ и расход при любом входе', async () => {
    app.setMapKey('map-key-WXYZ');
    expect((await fetch(`${app.base}/api/v1/settings/map`, { headers: { cookie: await signIn(REGULAR) } })).status).toBe(403);
    expect((await post(await signIn(REGULAR), 'settings/map', { apiKey: 'map-key-1234' })).status).toBe(403);
    const sup = await signIn(SUPER);
    const view = await (await fetch(`${app.base}/api/v1/settings/map`, { headers: { cookie: sup } })).text();
    expect(JSON.parse(view)).toMatchObject({ keySet: true, keyHint: 'WXYZ', loadsThisMonth: 3, monthlyLimit: 100 });
    expect(view).not.toContain('map-key-WXYZ');
    expect((await post(sup, 'settings/map', { apiKey: 'map-key-1234' })).status).toBe(200);
    // Для открытия карты ключ нужен любому входу.
    const boot = await fetch(`${app.base}/api/v1/map/config`, { headers: { cookie: await signIn(REGULAR) } });
    expect(await boot.json()).toEqual({ apiKey: 'map-key-WXYZ', loadsThisMonth: 3, monthlyLimit: 100 });
    expect((await fetch(`${app.base}/api/v1/map/config`)).status).toBe(401);
    const loaded = await post(await signIn(REGULAR), 'map/loaded', {});
    expect(await loaded.json()).toMatchObject({ loadsThisMonth: 4 });
    expect((await post(null, 'map/loaded', {})).status).toBe(401);
    app.setMapKey(null);
  });

  test('политика содержимого интерфейса: без ключа карты строгая, с ключом добавляет хосты Яндекс.Карт; страница входа всегда строгая', async () => {
    const cookie = await signIn();
    const strict = (await fetch(`${app.base}/`, { headers: { cookie } })).headers.get('content-security-policy')!;
    expect(strict).not.toMatch(/https?:|unsafe-eval/);
    app.setMapKey('map-key-WXYZ');
    const withMap = (await fetch(`${app.base}/`, { headers: { cookie } })).headers.get('content-security-policy')!;
    expect(withMap).toMatch(/script-src[^;]*https:\/\/api-maps\.yandex\.ru/);
    expect(withMap).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(withMap).toContain("default-src 'none'");
    expect(withMap).toContain("frame-ancestors 'none'");
    const login = (await fetch(`${app.base}/login`)).headers.get('content-security-policy')!;
    expect(login).not.toMatch(/https?:|unsafe-eval/);
    app.setMapKey(null);
  });

  test('ключ и его значение в ответах настроек не встречаются', async () => {
    const view = await (await fetch(`${app.base}/api/v1/settings/assistant`, { headers: { cookie: await signIn(SUPER) } })).text();
    expect(view).not.toMatch(/sk-|api_?key|DEEPSEEK_/i);
  });
});

describe('настройка бота «новые вопросы анкеты»', () => {
  test('только полный вход: обычному 403 на чтение и запись, полному — данные и сохранение с автором', async () => {
    const reg = await signIn(REGULAR);
    expect((await fetch(`${app.base}/api/v1/settings/bot`, { headers: { cookie: reg } })).status).toBe(403);
    const deniedPost = await fetch(`${app.base}/api/v1/settings/bot/extra-questions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: reg }, body: JSON.stringify({ mode: 'all' }),
    });
    expect(deniedPost.status).toBe(403);
    const sup = await signIn(SUPER);
    const view = await fetch(`${app.base}/api/v1/settings/bot`, { headers: { cookie: sup } });
    expect(view.status).toBe(200);
    expect(await view.json()).toHaveProperty('extraQuestions.mode', 'off');
    const before = app.settingsCalls.length;
    const saved = await fetch(`${app.base}/api/v1/settings/bot/extra-questions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: sup }, body: JSON.stringify({ mode: 'all' }),
    });
    expect(saved.status).toBe(200);
    expect(app.settingsCalls.slice(before)).toEqual([{ name: 'bot.save', actor: SUPER.login, body: { mode: 'all' } }]);
  });
});

describe('досылка новых вопросов из «Настроек»', () => {
  const send = (cookie: string | null, body: unknown) => fetch(`${app.base}/api/v1/settings/bot/send-extra-questions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('рассылка живым людям только с полного входа: без входа 401, обычному 403, и в обоих случаях ничего не отправлено', async () => {
    const before = app.settingsCalls.length;
    expect((await send(null, { expectedTotal: 2 })).status).toBe(401);
    expect((await send(await signIn(REGULAR), { expectedTotal: 2 })).status).toBe(403);
    expect(app.settingsCalls.length).toBe(before);
  });

  test('полный вход: тело и автор доходят до сервиса, ответ — итог доставки', async () => {
    const before = app.settingsCalls.length;
    const r = await send(await signIn(SUPER), { expectedTotal: 2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, sent: 2, failed: 0, blocked: 0 });
    expect(app.settingsCalls.slice(before)).toEqual([{ name: 'bot.invites', actor: SUPER.login, body: { expectedTotal: 2 } }]);
  });

  test('рассылку нельзя вызвать запросом GET: изменяющие адреса отвечают 404', async () => {
    const r = await fetch(`${app.base}/api/v1/settings/bot/send-extra-questions`, { headers: { cookie: await signIn(SUPER) } });
    expect(r.status).toBe(404);
  });
});

describe('метка «Странный человек»', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('на заявке: без входа 401, любой вход ставит метку, тело и автор доходят, снимок сбрасывается', async () => {
    const inv = app.invalidations();
    expect((await post(null, 'requests/9/strange', { value: true })).status).toBe(401);
    const r = await post(await signIn(REGULAR), 'requests/9/strange', { value: true, note: 'заметка' });
    expect(r.status).toBe(200);
    expect(app.strangeCalls.at(-1)).toEqual({ name: 'request', id: 9, body: { value: true, note: 'заметка' }, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('по ключу человека: тот же доступ, тело доходит как есть', async () => {
    expect((await post(null, 'people/strange', { key: 'u1', value: true })).status).toBe(401);
    const r = await post(await signIn(REGULAR), 'people/strange', { key: 'u12', value: false });
    expect(r.status).toBe(200);
    expect(app.strangeCalls.at(-1)).toEqual({ name: 'person', body: { key: 'u12', value: false }, actor: REGULAR.login });
  });

  test('изменяющие адреса не отвечают на GET', async () => {
    const cookie = await signIn(REGULAR);
    expect((await fetch(`${app.base}/api/v1/requests/9/strange`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/people/strange`, { headers: { cookie } })).status).toBe(404);
  });
});

describe('пол человека', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('поставить пол: без входа 401, любой вход ставит, тело и автор доходят, снимок сбрасывается', async () => {
    expect((await post(null, 'people/gender', { key: 'u1', gender: 'м' })).status).toBe(401);
    const inv = app.invalidations();
    const r = await post(await signIn(REGULAR), 'people/gender', { key: 'r5', gender: 'ж' });
    expect(r.status).toBe(200);
    expect(app.strangeCalls.at(-1)).toEqual({ name: 'gender', body: { key: 'r5', gender: 'ж' }, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('прогон моделью — только полный вход: наружу уходят слова из ФИО', async () => {
    const denied = await post(await signIn(REGULAR), 'people/gender-ai', {});
    expect(denied.status).toBe(403);
    expect(app.strangeCalls.at(-1)?.name).not.toBe('gender-ai');
    const r = await post(await signIn(SUPER), 'people/gender-ai', {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, unknownBefore: 3, filled: 2, left: 1 });
  });
});

describe('черновик группы по заявке', () => {
  test('без входа 401; обычный вход получает черновик; нет такой заявки — 404', async () => {
    const draft = { requestId: 7, fio: 'Пётр', fields: { leader: 'Пётр', status: 'Потенциальная' }, ownGroup: null };
    app.setViews(async () => ({ ...sampleViews(), groupDrafts: new Map([[7, draft]]) }));
    try {
      expect((await fetch(`${app.base}/api/v1/requests/7/group-draft`)).status).toBe(401);
      const cookie = await signIn(REGULAR);
      const r = await fetch(`${app.base}/api/v1/requests/7/group-draft`, { headers: { cookie } });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual(draft);
      expect((await fetch(`${app.base}/api/v1/requests/8/group-draft`, { headers: { cookie } })).status).toBe(404);
    } finally { app.setViews(async () => sampleViews()); }
  });
});

describe('выдача наборов', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('без входа 401, обычный вход находит, выдаёт и отменяет; автор — вошедший', async () => {
    expect((await post(null, 'kits/issue', { userId: 12 })).status).toBe(401);
    expect((await fetch(`${app.base}/api/v1/kits`)).status).toBe(401);
    const cookie = await signIn(REGULAR);
    const found = await post(cookie, 'kits/find', { code: 'Регистрация №1042' });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ ok: true, person: { registrationNo: 1042 } });
    expect((await post(cookie, 'kits/issue', { userId: 12 })).status).toBe(200);
    expect((await post(cookie, 'kits/undo', { userId: 12 })).status).toBe(200);
    expect(app.kitCalls.slice(-3)).toEqual([
      { name: 'find', body: { code: 'Регистрация №1042' } },
      { name: 'issue', body: { userId: 12 }, actor: REGULAR.login },
      { name: 'undo', body: { userId: 12 }, actor: REGULAR.login },
    ]);
    const view = await fetch(`${app.base}/api/v1/kits`, { headers: { cookie } });
    expect(await view.json()).toMatchObject({ issuedToday: 1, registered: 3 });
  });

  test('снимок справочника сбрасывается, только когда отметка изменилась', async () => {
    const cookie = await signIn(REGULAR);
    const inv = app.invalidations();
    await post(cookie, 'kits/find', { code: '1042' });
    expect(app.invalidations()).toBe(inv);
    const found = await post(cookie, 'kits/search', { query: 'Петров' });
    expect(await found.json()).toEqual({ ok: true, items: [], more: false });
    expect(app.kitCalls.at(-1)).toEqual({ name: 'search', body: { query: 'Петров' } });
    expect(app.invalidations()).toBe(inv);
    await post(cookie, 'kits/issue', { userId: 12 });
    expect(app.invalidations()).toBe(inv + 1);
    // Отмена в заглушке ничего не меняет (changed: false) — сбрасывать нечего.
    await post(cookie, 'kits/undo', { userId: 12 });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('ошибка сервиса отвечает своим кодом и текстом', async () => {
    const r = await post(await signIn(REGULAR), 'kits/find', { code: 'нет' });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found', message: 'Регистрации №5 нет.' });
  });

  test('изменяющие адреса не отвечают на GET', async () => {
    const cookie = await signIn(REGULAR);
    expect((await fetch(`${app.base}/api/v1/kits/issue`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/kits/undo`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/kits/search`, { headers: { cookie } })).status).toBe(404);
  });
});

describe('разбор «других обращений» по справочникам', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test('разобрать одно обращение: без входа 401, обычному входу можно, тело и автор доходят, снимок сбрасывается', async () => {
    const inv = app.invalidations();
    expect((await post(null, 'requests/9/reconcile', { groupId: 5 })).status).toBe(401);
    const r = await post(await signIn(REGULAR), 'requests/9/reconcile', { groupId: 5 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, already: false });
    expect(app.reconcileCalls.at(-1)).toEqual({ name: 'apply', id: 9, body: { groupId: 5 }, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('разобрать всё готовое: тот же доступ, ответ с числами, снимок сбрасывается', async () => {
    const inv = app.invalidations();
    expect((await post(null, 'requests/reconcile-ready', { ids: [1] })).status).toBe(401);
    const r = await post(await signIn(REGULAR), 'requests/reconcile-ready', { ids: [1, 2, 3] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, applied: 2, skipped: 1 });
    expect(app.reconcileCalls.at(-1)).toEqual({ name: 'ready', body: { ids: [1, 2, 3] }, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('изменяющие адреса не отвечают на GET', async () => {
    const cookie = await signIn(REGULAR);
    expect((await fetch(`${app.base}/api/v1/requests/9/reconcile`, { headers: { cookie } })).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/requests/reconcile-ready`, { headers: { cookie } })).status).toBe(404);
  });
});

describe('закрытие заявки, возврат в работу, регистрация, кампания', () => {
  const post = (cookie: string | null, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });

  test.each([['close', { outcome: 'cancel', reason: 'no_answer' }], ['reopen', {}]])('%s: доступно обычному входу, тело и автор передаются', async (action, body) => {
    const inv = app.invalidations();
    expect((await post(null, `requests/9/${action}`, body)).status).toBe(401);
    const r = await post(await signIn(REGULAR), `requests/9/${action}`, body);
    expect(r.status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: action, id: 9, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('удаление регистрации: обычному входу 403, полному — выполняется; правка людей через этот путь не существует', async () => {
    const before = app.actionCalls.length;
    expect((await post(await signIn(REGULAR), 'people/5/delete', {})).status).toBe(403);
    expect(app.actionCalls.length).toBe(before);
    expect((await post(await signIn(SUPER), 'people/5/delete', {})).status).toBe(200);
    expect(app.actionCalls.at(-1)).toMatchObject({ name: 'person.delete', id: 5, actor: SUPER.login });
    expect((await post(await signIn(SUPER), 'people/5/update', { fields: {} })).status).toBe(404);
  });

  test('кампания «40 дней»: без входа 401, со входом — данные', async () => {
    expect((await fetch(`${app.base}/api/v1/campaign`)).status).toBe(401);
    const r = await fetch(`${app.base}/api/v1/campaign`, { headers: { cookie: await signIn(REGULAR) } });
    expect(r.status).toBe(200);
    expect(await r.json()).toHaveProperty('day.number', 3);
  });

  test('страница регистрации без входа ведёт на вход с возвратом, после входа возвращает на неё', async () => {
    const anon = await fetch(`${app.base}/registration`, { redirect: 'manual' });
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe('/login?next=/registration');
    const page = await (await fetch(`${app.base}/login?next=/registration`)).text();
    expect(page).toContain('name="next" value="/registration"');
    const login = await fetch(`${app.base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
      body: new URLSearchParams({ login: REGULAR.login, password: REGULAR.password, next: '/registration' }),
    });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/registration');
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const shown = await fetch(`${app.base}/registration`, { headers: { cookie } });
    expect(shown.status).toBe(200);
    expect(await shown.text()).toContain('id="root"');
  });

  test('возврат после входа только на страницу регистрации: чужой адрес в next игнорируется', async () => {
    const login = await fetch(`${app.base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
      body: new URLSearchParams({ login: REGULAR.login, password: REGULAR.password, next: 'https://evil.example/' }),
    });
    expect(login.headers.get('location')).toBe('/');
  });
});

describe('вход «Стойка регистрации»', () => {
  const get = (cookie: string, path: string) => fetch(`${app.base}${path}`, { headers: { cookie }, redirect: 'manual' });
  const postJson = (cookie: string, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });

  test('после входа — сразу на страницу стойки, даже без next', async () => {
    const r = await post(app.base, '/login', { login: DESK.login, password: DESK.password });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/registration');
  });

  test('любой другой адрес интерфейса уводит на /registration, сама страница открывается', async () => {
    const cookie = await signIn(DESK);
    for (const path of ['/', '/requests', '/?tab=reference']) {
      const r = await get(cookie, path);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('/registration');
    }
    for (const path of ['/registration', '/registration/']) {
      const r = await get(cookie, path);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(INDEX_MARKER);
    }
  });

  test('открыто то, что нужно стойке: уровень входа, справочники формы, наборы, карточка и QR регистрации', async () => {
    const cookie = await signIn(DESK);
    const me = await get(cookie, '/api/v1/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: 'registration' });
    for (const path of ['/api/v1/form-meta', '/api/v1/kits', '/api/v1/people/5/card', '/api/v1/people/5/qr']) {
      expect((await get(cookie, path)).status, path).toBe(200);
    }
    expect((await postJson(cookie, 'kits/find', { code: '1042' })).status).toBe(200);
    expect((await postJson(cookie, 'kits/issue', { userId: 12 })).status).toBe(200);
    expect(app.kitCalls.at(-1)).toEqual({ name: 'issue', body: { userId: 12 }, actor: 'mbv_admin' });
  });

  test('регистрация участника проходит; группу, заявку и координатора создать нельзя', async () => {
    app.setCreate({ ok: true, id: 77 });
    const cookie = await signIn(DESK);
    const before = app.createCalls.length;
    const ok = await postJson(cookie, 'people/create', { fields: { fio: 'Анна Петрова', phone: '+79110001122' } });
    expect(ok.status).toBe(200);
    expect(app.createCalls.length).toBe(before + 1);
    for (const path of ['groups/create', 'requests/create', 'coordinators/create']) {
      const r = await postJson(cookie, path, { fields: { leader: 'Ольга' } });
      expect(r.status, path).toBe(403);
      expect(await r.json()).toMatchObject({ error: 'forbidden' });
    }
    expect(app.createCalls.length).toBe(before + 1);
  });

  test('заявки, группы, справочник, «Настройки», выгрузка и помощник закрыты (403), и ничего не вызывается', async () => {
    const cookie = await signIn(DESK);
    const views = app.viewsCalls();
    for (const path of [...API_ROUTES.filter((r) => r !== 'me').map((r) => `/api/v1/${r}`), '/api/v1/settings/staff', '/api/v1/export/people.csv', '/api/v1/campaign', '/api/v1/assistant/chat/history', '/api/v1/requests/1/group-draft']) {
      expect((await get(cookie, path)).status, path).toBe(403);
    }
    const actions = app.actionCalls.length;
    for (const path of ['requests/1/approve', 'groups/1/update', 'people/12/update', 'settings/staff/create', 'matching/run', 'assistant/chat', 'requests/bulk']) {
      expect((await postJson(cookie, path, {})).status, path).toBe(403);
    }
    expect(app.viewsCalls()).toBe(views);
    expect(app.actionCalls.length).toBe(actions);
  });
});

describe('вход «Только чтение»', () => {
  const get = (cookie: string, path: string) => fetch(`${app.base}${path}`, { headers: { cookie }, redirect: 'manual' });
  const postJson = (cookie: string, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });

  test('видит «Сегодня», заявки, группы, людей и кампанию; интерфейс открывается обычной страницей', async () => {
    const cookie = await signIn(READER);
    expect(await (await get(cookie, '/api/v1/me')).json()).toMatchObject({ role: 'readonly' });
    for (const path of ['/api/v1/today', '/api/v1/requests', '/api/v1/groups', '/api/v1/people', '/api/v1/form-meta']) {
      expect((await get(cookie, path)).status, path).toBe(200);
    }
    const page = await get(cookie, '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(INDEX_MARKER);
  });

  test('«Координаторы» и «Наборы» открыты на чтение: список и поиск набора проходят, выдача и отмена — 403', async () => {
    const cookie = await signIn(READER);
    for (const path of ['/api/v1/coordinators', '/api/v1/kits']) expect((await get(cookie, path)).status, path).toBe(200);
    expect((await postJson(cookie, 'kits/find', { code: '1042' })).status).toBe(200);
    expect((await postJson(cookie, 'kits/search', { query: 'Иван' })).status).toBe(200);
    const kits = app.kitCalls.filter((c) => c.name === 'issue' || c.name === 'undo').length;
    for (const path of ['kits/issue', 'kits/undo', 'coordinators/create', 'coordinators/1/update']) {
      expect((await postJson(cookie, path, { userId: 12 })).status, path).toBe(403);
    }
    expect(app.kitCalls.filter((c) => c.name === 'issue' || c.name === 'undo').length).toBe(kits);
  });

  test('сводка «Команды», «Настройки», выгрузка и история помощника закрыты (403)', async () => {
    const cookie = await signIn(READER);
    const settings = app.settingsCalls.length;
    for (const path of ['/api/v1/team', '/api/v1/settings/staff', '/api/v1/settings/health', '/api/v1/export/people.csv', '/api/v1/assistant/chat/history']) {
      expect((await get(cookie, path)).status, path).toBe(403);
    }
    expect(app.settingsCalls.length).toBe(settings);
  });

  test('ничего не меняет и подбор не запускает: любое изменение — 403, и ничего не вызывается', async () => {
    const cookie = await signIn(READER);
    const counts = () => [app.actionCalls.length, app.createCalls.length, app.matchingCalls.length, app.assistantCalls.length, app.kitCalls.length, app.chatCalls.length, app.invalidations()];
    const before = counts();
    for (const path of ['requests/1/approve', 'requests/1/rematch', 'requests/1/assign', 'requests/1/close', 'requests/bulk', 'groups/1/update', 'groups/create',
      'people/create', 'persons/create', 'groups/1/members/create', 'people/u12/update', 'matching/run', 'matching/rerun-all', 'assistant/run', 'assistant/chat',
      'kits/issue', 'people/strange', 'people/gender', 'requests/reconcile-ready', 'settings/staff/create']) {
      const r = await postJson(cookie, path, {});
      expect(r.status, path).toBe(403);
      expect(await r.json()).toMatchObject({ error: 'forbidden' });
    }
    expect(counts()).toEqual(before);
    // Учёт открытий карты ничего в данных не меняет: карта нужна и тому, кто только смотрит.
    expect((await postJson(cookie, 'map/loaded', {})).status).toBe(200);
  });
});

describe('«глазик» у пароля', () => {
  test('полный вход открывает выданный пароль, обычный — нет', async () => {
    const send = (cookie: string) => fetch(`${app.base}/api/v1/settings/staff/password`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id: 3 }),
    });
    const ok = await send(await signIn(SUPER));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, password: 'выданный-пароль' });
    expect(app.staffCalls.at(-1)).toEqual({ name: 'reveal', args: [{ id: 3 }, SUPER.login] });
    expect((await send(await signIn(REGULAR))).status).toBe(403);
  });
});

describe('распределитель и карточка группы', () => {
  const postJson = (cookie: string, path: string, body: unknown) => fetch(`${app.base}/api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });

  test('у кого в команде только роль распределителя, тот карточку группы не правит (403), а заявки — да', async () => {
    app.setOutcome({ ok: true });
    const cookie = await signIn(DISTRIBUTOR);
    const before = app.actionCalls.filter((c) => c.name === 'group.update').length;
    const r = await postJson(cookie, 'groups/1/update', { fields: { address: 'Невский, 1' } });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: 'forbidden', message: expect.stringContaining('Распределитель') });
    expect(app.actionCalls.filter((c) => c.name === 'group.update').length).toBe(before);
    expect((await postJson(cookie, 'requests/1/approve', { groupId: 1 })).status).toBe(200);
  });

  test.each([
    [[], true], [['distributor'], false], [['distributor', 'coordinator'], true], [['senior_distributor'], true], [['coordinator'], true],
  ] as const)('роли команды %j — правка групп: %s', (kinds, allowed) => {
    expect(mayEditGroups({ person: { teamKinds: kinds } })).toBe(allowed);
    expect(mayEditGroups({ person: null })).toBe(true);
  });

  test('общий обычный вход карточку группы правит, как и раньше', async () => {
    app.setOutcome({ ok: true });
    const cookie = await signIn(REGULAR);
    expect((await postJson(cookie, 'groups/1/update', { fields: { address: 'Невский, 1' } })).status).toBe(200);
  });
});

describe('«подобрать заново»', () => {
  const post = (cookie: string | null, path: string, body: unknown = {}) =>
    fetch(`${app.base}/api/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  test('без сессии ни одно, ни все предложения не пересчитываются', async () => {
    const a = app.actionCalls.length;
    const m = app.matchingCalls.length;
    expect((await post(null, 'requests/5/rematch')).status).toBe(401);
    expect((await post(null, 'matching/rerun-all')).status).toBe(401);
    expect(app.actionCalls.length).toBe(a);
    expect(app.matchingCalls.length).toBe(m);
  });

  test('одна заявка: номер и автор передаются, снимок сбрасывается', async () => {
    const inv = app.invalidations();
    const r = await post(await signIn(REGULAR), 'requests/12/rematch');
    expect(r.status).toBe(200);
    expect(app.actionCalls.at(-1)).toEqual({ name: 'rematch', id: 12, body: undefined, actor: REGULAR.login });
    expect(app.invalidations()).toBe(inv + 1);
  });

  test('закрытая заявка — 409 с текстом', async () => {
    app.setOutcome({ ok: false, error: 'already_closed', message: 'Заявку уже обработали.' });
    try {
      const r = await post(await signIn(), 'requests/12/rematch');
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: 'already_closed', message: 'Заявку уже обработали.' });
    } finally { app.setOutcome({ ok: true }); }
  });

  test('«пересчитать все» доступно обычному входу и отвечает итогом', async () => {
    const r = await post(await signIn(REGULAR), 'matching/rerun-all');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, created: 5, replaced: 0, unchanged: 0 });
    expect(app.matchingCalls.at(-1)).toEqual({ name: 'rerun-all', actor: REGULAR.login });
  });
});
