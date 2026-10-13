import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import { decryptSecret, encryptSecret, keyHint } from '../platform/settings/secrets.js';
import type { GeocoderConfigView, GeocoderTestResult } from './contracts.js';
import { DAILY_LIMIT, createYandexGeocoder, type Geocoder } from './geocode.js';

/**
 * Ключ Яндекс.Геокодера, который меняют в «Настройки → Геокодер». Хранится в базе зашифрованным (как ключ помощника,
 * см. `secrets.ts`), обратно в интерфейс не отдаётся — только последние четыре символа. Пока в настройках ничего не
 * сохраняли, действует `YANDEX_GEOCODER_KEY` из `.env` сервера. Так ключ можно сменить, не имея доступа к серверу.
 */
const KEY_API = 'geocoder.api_key';

type Outcome = { ok: true } | { ok: false; error: 'bad_request' | 'unavailable'; message: string };
const bad = (message: string): { ok: false; error: 'bad_request'; message: string } => ({ ok: false, error: 'bad_request', message });

/** Ключ как его вставляют из письма или кабинета: в кавычках, с пробелами по краям. */
const cleanKey = (raw: string): string => raw.trim().replace(/^["'`«»]+|["'`«»]+$/g, '').trim();

type ParsedKey = { apiKey: string | null | undefined } | { error: string };

/** undefined — ключ не менять, null — убрать сохранённый (вернётся `.env`), строка — новый. */
function parseBody(body: unknown): ParsedKey {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'Нужно указать ключ.' };
  const raw = (body as Record<string, unknown>)['apiKey'];
  if (raw === undefined) return { apiKey: undefined };
  if (raw === null) return { apiKey: null };
  if (typeof raw !== 'string') return { error: 'Ключ должен быть текстом.' };
  const key = cleanKey(raw);
  if (key.length < 8 || key.length > 200) return { error: 'Ключ слишком короткий или слишком длинный: проверьте, что он скопирован целиком.' };
  if (/[^\x21-\x7e]/.test(key)) return { error: 'В ключе только латинские буквы, цифры и знаки, без пробелов: похоже, скопировано лишнее.' };
  return { apiKey: key };
}

/** Проверочный адрес: известный, с точным ответом — по нему видно, принял ли Яндекс ключ. */
const PROBE = 'Санкт-Петербург, Невский проспект, 1';

export function createGeocoderConfig(deps: {
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  env: NodeJS.ProcessEnv;
  secret: string;
  /** Сколько запросов к геокодеру сделано за сутки (для строки «осталось»). */
  usedToday: () => Promise<number>;
  makeGeocoder?: (key: string) => Geocoder;
}) {
  const envKey = (): string | null => deps.env['YANDEX_GEOCODER_KEY']?.trim() || null;
  const make = deps.makeGeocoder ?? ((key: string) => createYandexGeocoder(key));

  async function effective(): Promise<{ key: string | null; source: 'settings' | 'env' | null; unreadable: boolean }> {
    const sealed = await deps.settings.get<unknown>(KEY_API);
    const own = sealed === null || sealed === undefined ? null : decryptSecret(sealed, deps.secret);
    const unreadable = sealed !== null && sealed !== undefined && own === null;
    const key = own ?? envKey();
    return { key, source: own !== null ? 'settings' : key !== null ? 'env' : null, unreadable };
  }

  return {
    /** Действующий ключ для фонового геокодирования: читается при каждом заходе, смена ключа действует без перезапуска. */
    async currentKey(): Promise<string | null> {
      return (await effective()).key;
    },

    async view(): Promise<GeocoderConfigView> {
      const e = await effective();
      return {
        keySet: e.key !== null,
        keySource: e.source,
        keyHint: e.key ? keyHint(e.key) : null,
        keyUnreadable: e.unreadable,
        usedToday: await deps.usedToday(),
        dailyLimit: DAILY_LIMIT,
      };
    },

    async save(body: unknown, actor: string): Promise<Outcome> {
      const p = parseBody(body);
      if ('error' in p) return bad(p.error);
      if (typeof p.apiKey === 'string' && deps.secret.trim() === '') {
        return { ok: false, error: 'unavailable', message: 'На сервере не задан секрет для шифрования ключей (SETTINGS_SECRET), ключ сохранить нельзя.' };
      }
      if (p.apiKey === undefined) return bad('Введите ключ.');
      if (typeof p.apiKey === 'string') await deps.settings.set(KEY_API, encryptSecret(p.apiKey, deps.secret), actor);
      // Пустое значение вместо удаления строки: у SettingsRepo нет удаления, а null читается как «нет ключа».
      else await deps.settings.set(KEY_API, null, actor);
      // В журнале только что сделали с ключом, сам ключ туда не попадает.
      await deps.audit.write(actor, 'settings.geocoder', 'settings', null, { key: p.apiKey === null ? 'removed' : 'set' });
      return { ok: true };
    },

    /** Один запрос к Яндексу с введённым (или действующим) ключом. Ничего не сохраняет и в суточный счёт не входит. */
    async test(body: unknown): Promise<GeocoderTestResult> {
      const p = parseBody(body);
      if ('error' in p) return { ok: false, message: p.error };
      const key = typeof p.apiKey === 'string' ? p.apiKey : (await effective()).key;
      if (!key) return { ok: false, message: 'Ключ не задан: введите его в поле выше.' };
      const started = Date.now();
      const r = await make(key).geocode(PROBE);
      if (r.kind === 'found') return { ok: true, ms: Date.now() - started };
      if (r.kind === 'missing') return { ok: false, message: 'Яндекс ответил, но не нашёл проверочный адрес. Ключ, скорее всего, рабочий; повторите позже.' };
      return { ok: false, message: `Яндекс не принял запрос: ${r.message}. Проверьте, что ключ скопирован целиком и выдан для «HTTP Геокодера».` };
    },
  };
}

export type GeocoderConfig = ReturnType<typeof createGeocoderConfig>;
