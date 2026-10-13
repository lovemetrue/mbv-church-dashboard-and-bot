import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import { decryptSecret, encryptSecret, keyHint } from '../platform/settings/secrets.js';
import type { ActionError, MapBootstrap, MapConfigView } from './contracts.js';

/**
 * Ключ Яндекс.Карт (JS API) для карты групп, который вводят в «Настройки → Карта». Хранится в базе зашифрованным; в
 * настройки обратно отдаётся лишь последние четыре символа. Но странице для открытия карты ключ нужен целиком, поэтому
 * `bootstrap()` отдаёт его любому вошедшему: у JS API ключ по природе виден в браузере, его защищает ограничение по адресу
 * сайта в кабинете Яндекса, а не секретность.
 *
 * Бесплатный ключ даёт ограниченное число загрузок карты в месяц, поэтому карта грузится только по кнопке, а каждая загрузка
 * считается здесь (`recordLoad`): остаток виден и в настройках, и рядом с кнопкой.
 */
const KEY_API = 'map.api_key';
export const MAP_MONTHLY_LIMIT = 100;

type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };

const cleanKey = (raw: string): string => raw.trim().replace(/^["'`«»]+|["'`«»]+$/g, '').trim();

/** Месяц по UTC, `2026-10`: у бесплатного ключа месяц календарный, сдвиг на часы тут не важен. */
const monthKey = (now: Date): string => `map.loads.${now.toISOString().slice(0, 7)}`;

export function createMapConfig(deps: {
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  secret: string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function key(): Promise<{ key: string | null; unreadable: boolean }> {
    const sealed = await deps.settings.get<unknown>(KEY_API);
    if (sealed === null || sealed === undefined) return { key: null, unreadable: false };
    const own = decryptSecret(sealed, deps.secret);
    return { key: own, unreadable: own === null };
  }
  const loads = async (): Promise<number> => {
    const n = await deps.settings.get<number>(monthKey(now()));
    return typeof n === 'number' ? n : 0;
  };

  return {
    async view(): Promise<MapConfigView> {
      const k = await key();
      return { keySet: k.key !== null, keyHint: k.key ? keyHint(k.key) : null, keyUnreadable: k.unreadable, loadsThisMonth: await loads(), monthlyLimit: MAP_MONTHLY_LIMIT };
    },

    async bootstrap(): Promise<MapBootstrap> {
      return { apiKey: (await key()).key, loadsThisMonth: await loads(), monthlyLimit: MAP_MONTHLY_LIMIT };
    },

    /** Одно открытие карты. Считаем до загрузки скрипта: Яндекс считает запрос за скрипт, даже если карта потом не отрисовалась. */
    async recordLoad(): Promise<MapBootstrap> {
      const next = (await loads()) + 1;
      await deps.settings.set(monthKey(now()), next, 'карта');
      return this.bootstrap();
    },

    async save(body: unknown, actor: string): Promise<Outcome> {
      const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['apiKey'] : undefined;
      if (raw === undefined) return { ok: false, error: 'bad_request', message: 'Введите ключ.' };
      if (raw === null) {
        await deps.settings.set(KEY_API, null, actor);
        await deps.audit.write(actor, 'settings.map', 'settings', null, { key: 'removed' });
        return { ok: true };
      }
      if (typeof raw !== 'string') return { ok: false, error: 'bad_request', message: 'Ключ должен быть текстом.' };
      const apiKey = cleanKey(raw);
      if (apiKey.length < 8 || apiKey.length > 200) return { ok: false, error: 'bad_request', message: 'Ключ слишком короткий или слишком длинный: проверьте, что он скопирован целиком.' };
      if (/[^\x21-\x7e]/.test(apiKey)) return { ok: false, error: 'bad_request', message: 'В ключе только латинские буквы, цифры и знаки, без пробелов: похоже, скопировано лишнее.' };
      if (deps.secret.trim() === '') return { ok: false, error: 'unavailable', message: 'На сервере не задан секрет для шифрования ключей (SETTINGS_SECRET), ключ сохранить нельзя.' };
      await deps.settings.set(KEY_API, encryptSecret(apiKey, deps.secret), actor);
      await deps.audit.write(actor, 'settings.map', 'settings', null, { key: 'set' });
      return { ok: true };
    },
  };
}

export type MapConfig = ReturnType<typeof createMapConfig>;
