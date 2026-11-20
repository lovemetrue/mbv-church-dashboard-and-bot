import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import { decryptSecret, encryptSecret, keyHint } from '../platform/settings/secrets.js';
import { localIsoDate } from './api/dates.js';
import type { ActionError, MapBootstrap, MapConfigView } from './contracts.js';

/**
 * Ключи Яндекс.Карт для карты групп, которые вводят в «Настройки → Карта». Хранятся в базе зашифрованными; в настройки
 * обратно отдаются лишь последние четыре символа.
 *
 * - Ключ JS API (живая карта). Странице он нужен целиком, поэтому `bootstrap()` отдаёт его любому вошедшему: у JS API ключ
 *   по природе виден в браузере, его защищает ограничение по адресу сайта в кабинете Яндекса, а не секретность.
 * - Ключ Static API (снимок-картинка, `mapSnapshot.ts`). Снимок запрашивает сервер, поэтому этот ключ из сервера не выходит:
 *   странице — только признак `staticReady`.
 *
 * Бесплатный ключ JS API даёт 100 загрузок карты в сутки (не в месяц — так считали раньше), поэтому каждая загрузка
 * считается здесь (`recordLoad`): остаток виден и в настройках, и на кнопке. Сутки — по часовому поясу кампании.
 * Через `.env` ключи не передаются: новая обязательная переменная ломала бы выкладку.
 */
const KEY_API = 'map.api_key';
const KEY_STATIC = 'map.static_key';
export const MAP_DAILY_LIMIT = 100;

type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };

const cleanKey = (raw: string): string => raw.trim().replace(/^["'`«»]+|["'`«»]+$/g, '').trim();

/** Сутки кампании, `map.loads.2026-10-13`: полночь по Москве, а не по UTC, иначе «сегодня» начиналось бы в три часа ночи. */
const dayKey = (now: Date, timeZone: string): string => `map.loads.${localIsoDate(now, timeZone)}`;

export function createMapConfig(deps: {
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  secret: string;
  now?: () => Date;
  timeZone?: string;
}) {
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? 'Europe/Moscow';

  async function read(name: string): Promise<{ key: string | null; unreadable: boolean }> {
    const sealed = await deps.settings.get<unknown>(name);
    if (sealed === null || sealed === undefined) return { key: null, unreadable: false };
    const own = decryptSecret(sealed, deps.secret);
    return { key: own, unreadable: own === null };
  }
  const loads = async (): Promise<number> => {
    const n = await deps.settings.get<number>(dayKey(now(), timeZone));
    return typeof n === 'number' ? n : 0;
  };

  /** Один ключ из тела: undefined — не трогаем, null — убрать, строка — проверить и сохранить. */
  async function saveOne(name: string, auditField: 'key' | 'staticKey', raw: unknown, actor: string): Promise<Outcome> {
    if (raw === null) {
      await deps.settings.set(name, null, actor);
      await deps.audit.write(actor, 'settings.map', 'settings', null, { [auditField]: 'removed' });
      return { ok: true };
    }
    if (typeof raw !== 'string') return { ok: false, error: 'bad_request', message: 'Ключ должен быть текстом.' };
    const apiKey = cleanKey(raw);
    if (apiKey.length < 8 || apiKey.length > 200) return { ok: false, error: 'bad_request', message: 'Ключ слишком короткий или слишком длинный: проверьте, что он скопирован целиком.' };
    if (/[^\x21-\x7e]/.test(apiKey)) return { ok: false, error: 'bad_request', message: 'В ключе только латинские буквы, цифры и знаки, без пробелов: похоже, скопировано лишнее.' };
    if (deps.secret.trim() === '') return { ok: false, error: 'unavailable', message: 'На сервере не задан секрет для шифрования ключей (SETTINGS_SECRET), ключ сохранить нельзя.' };
    await deps.settings.set(name, encryptSecret(apiKey, deps.secret), actor);
    await deps.audit.write(actor, 'settings.map', 'settings', null, { [auditField]: 'set' });
    return { ok: true };
  }

  return {
    async view(): Promise<MapConfigView> {
      const [k, s] = await Promise.all([read(KEY_API), read(KEY_STATIC)]);
      return {
        keySet: k.key !== null, keyHint: k.key ? keyHint(k.key) : null, keyUnreadable: k.unreadable,
        staticKeySet: s.key !== null, staticKeyHint: s.key ? keyHint(s.key) : null, staticKeyUnreadable: s.unreadable,
        loadsToday: await loads(), dailyLimit: MAP_DAILY_LIMIT,
      };
    },

    /** Всё, кроме снимка: снимок у каждого входа свой, его добавляет сервер (`mapSnapshot.ts`). */
    async bootstrap(): Promise<Omit<MapBootstrap, 'snapshot'>> {
      const [k, s] = await Promise.all([read(KEY_API), read(KEY_STATIC)]);
      return { apiKey: k.key, loadsToday: await loads(), dailyLimit: MAP_DAILY_LIMIT, staticReady: s.key !== null };
    },

    /** Ключ JS API: нужен ещё политике безопасности страницы (хосты Яндекса открываются, только пока он задан). */
    async apiKey(): Promise<string | null> {
      return (await read(KEY_API)).key;
    },

    /** Ключ Static API — только серверу, для снимка. */
    async staticKey(): Promise<string | null> {
      return (await read(KEY_STATIC)).key;
    },

    /** Одно открытие карты. Считаем до загрузки скрипта: Яндекс считает запрос за скрипт, даже если карта потом не отрисовалась. */
    async recordLoad(): Promise<Omit<MapBootstrap, 'snapshot'>> {
      const next = (await loads()) + 1;
      await deps.settings.set(dayKey(now(), timeZone), next, 'карта');
      return this.bootstrap();
    },

    async save(body: unknown, actor: string): Promise<Outcome> {
      const b = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const apiKey = b['apiKey'];
      const staticKey = b['staticKey'];
      if (apiKey === undefined && staticKey === undefined) return { ok: false, error: 'bad_request', message: 'Введите ключ.' };
      if (apiKey !== undefined) {
        const out = await saveOne(KEY_API, 'key', apiKey, actor);
        if (!out.ok) return out;
      }
      if (staticKey !== undefined) return saveOne(KEY_STATIC, 'staticKey', staticKey, actor);
      return { ok: true };
    },
  };
}

export type MapConfig = ReturnType<typeof createMapConfig>;
