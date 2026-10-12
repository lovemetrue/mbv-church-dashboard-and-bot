import type { AuditRepo } from '../../db/repos/audit.repo.js';
import type { SettingsRepo } from '../../db/repos/settings.repo.js';
import {
  createDeepSeekClient, LlmError, type LlmClient, type LlmSource,
} from '../../platform/llm/deepseek.js';
import { PROVIDER_IDS, PROVIDERS, isProviderId, validateBaseUrl, type ProviderId } from '../../platform/llm/providers.js';
import { decryptSecret, encryptSecret, keyHint } from '../../platform/settings/secrets.js';
import type { ActionError, LlmConfigView, LlmProviderOption, LlmTestResult } from '../contracts.js';

/**
 * Подключение помощника, которое меняют в «Настройки → Помощник»: провайдер, модель и ключ. Ключ хранится в базе
 * зашифрованным (см. `secrets.ts`) и обратно в интерфейс не отдаётся — только последние четыре символа. Пока в настройках
 * ничего не сохраняли, действуют значения из `.env` сервера, как было раньше (`DEEPSEEK_API_KEY` и остальные).
 *
 * Клиент создаётся заново при каждом обращении (с короткой памятью): сменили ключ или модель — следующий запрос уже по новым.
 */
const KEY_API = 'llm.api_key';
const KEY_PROVIDER = 'llm.provider';
const KEY_MODEL = 'llm.model';
const KEY_BASE_URL = 'llm.base_url';
const CACHE_MS = 5_000;
const TEST_TIMEOUT_MS = 25_000;

type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): { ok: false; error: 'bad_request'; message: string } => ({ ok: false, error: 'bad_request', message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ключ как его вставляют из письма или файла: в кавычках, с «Bearer», с пробелами по краям. */
function cleanKey(raw: string): string {
  const unquote = (x: string): string => x.replace(/^["'`«»]+|["'`«»]+$/g, '').trim();
  return unquote(unquote(raw.trim()).replace(/^bearer\s+/i, ''));
}

const MODEL_RE = /^[\w./:@+-]{1,100}$/;

interface Parsed {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  /** undefined — не менять, null — убрать, строка — новый (уже очищенный). */
  apiKey: string | null | undefined;
}

function parseBody(body: unknown): Parsed | { error: string } {
  if (!isRecord(body)) return { error: 'Нужно указать провайдера и модель.' };
  if (!isProviderId(body['provider'])) return { error: 'Выберите провайдера из списка.' };
  const provider = body['provider'];
  const model = typeof body['model'] === 'string' ? body['model'].trim() : '';
  if (model === '') return { error: 'Укажите название модели.' };
  if (!MODEL_RE.test(model)) return { error: 'Название модели: латинские буквы, цифры и знаки . / : - _ без пробелов.' };
  let baseUrl: string | null = null;
  if (provider === 'custom') {
    const checked = validateBaseUrl(typeof body['baseUrl'] === 'string' ? body['baseUrl'] : '');
    if (!checked.ok) return { error: checked.message };
    baseUrl = checked.url;
  }
  let apiKey: string | null | undefined;
  if ('apiKey' in body && body['apiKey'] !== undefined) {
    if (body['apiKey'] === null) apiKey = null;
    else if (typeof body['apiKey'] !== 'string') return { error: 'Ключ должен быть текстом.' };
    else {
      const key = cleanKey(body['apiKey']);
      if (key.length < 8 || key.length > 300) return { error: 'Ключ слишком короткий или слишком длинный: проверьте, что он скопирован целиком.' };
      if (/[\s\u0000-\u001f]/.test(key)) return { error: 'В ключе не должно быть пробелов и переносов строк: скопируйте его целиком, одной строкой.' };
      if (/[^\x21-\x7e]/.test(key)) return { error: 'В ключе только латинские буквы, цифры и знаки: похоже, скопировано лишнее.' };
      apiKey = key;
    }
  }
  return { provider, model, baseUrl, apiKey };
}

const option = (id: ProviderId): LlmProviderOption => {
  const p = PROVIDERS[id];
  return { id, label: p.label, baseUrl: p.baseUrl, models: [...p.models], defaultModel: p.defaultModel, note: p.note };
};

function explain(err: unknown): Extract<LlmTestResult, { ok: false }> {
  if (!(err instanceof LlmError)) return { ok: false, code: 'network', message: 'Нет связи с провайдером. Проверьте адрес и что сервер выходит в интернет.' };
  const base = { ...(err.status !== undefined ? { status: err.status } : {}), ...(err.detail ? { detail: err.detail } : {}) };
  const code = err.status ? ` (код ${err.status})` : '';
  switch (err.code) {
    case 'auth':
      return err.status === 402
        ? { ok: false, code: 'auth', message: `На счёте провайдера нет средств${code}. Пополните баланс.`, ...base }
        : { ok: false, code: 'auth', message: `Провайдер не принял ключ${code}. Проверьте, что ключ скопирован целиком, без пробелов и кавычек, и выдан именно этому провайдеру.`, ...base };
    case 'rate':
      return { ok: false, code: 'rate', message: `Провайдер просит подождать: слишком много запросов${code}. Повторите через минуту.`, ...base };
    case 'server':
      return { ok: false, code: 'server', message: `Провайдер сейчас не отвечает${code}. Повторите позже.`, ...base };
    case 'network':
      return { ok: false, code: 'network', message: 'Нет связи с провайдером. Проверьте адрес и что сервер выходит в интернет.', ...base };
    default:
      return { ok: false, code: 'format', message: `Провайдер отклонил запрос${code}. Чаще всего это неверное название модели или адрес.`, ...base };
  }
}

export function createLlmConfig(deps: {
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  env: NodeJS.ProcessEnv;
  /** Секрет сервера, из которого получается ключ шифрования; не хранится в базе. */
  secret: string;
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
}) {
  const envKey = (): string | null => deps.env['DEEPSEEK_API_KEY']?.trim() || null;
  const envUrl = (): string | null => deps.env['DEEPSEEK_BASE_URL']?.trim().replace(/\/+$/, '') || null;
  const envModel = (): string | null => deps.env['DEEPSEEK_MODEL']?.trim() || null;

  interface Effective {
    provider: ProviderId;
    baseUrl: string | null;
    model: string;
    key: string | null;
    keySource: 'settings' | 'env' | null;
    keyUnreadable: boolean;
  }

  async function effective(): Promise<Effective> {
    const [storedProvider, storedModel, storedUrl, sealed] = await Promise.all([
      deps.settings.get<unknown>(KEY_PROVIDER), deps.settings.get<unknown>(KEY_MODEL),
      deps.settings.get<unknown>(KEY_BASE_URL), deps.settings.get<unknown>(KEY_API),
    ]);
    let provider: ProviderId;
    let baseUrl: string | null = null;
    if (isProviderId(storedProvider)) {
      provider = storedProvider;
      if (provider === 'custom') baseUrl = typeof storedUrl === 'string' ? storedUrl : null;
    } else if (envUrl() !== null && envUrl() !== PROVIDERS.deepseek.baseUrl) {
      provider = 'custom';
      baseUrl = envUrl();
    } else {
      provider = 'deepseek';
    }
    const model = (typeof storedModel === 'string' && storedModel !== '' ? storedModel : null) ?? envModel() ?? PROVIDERS[provider].defaultModel ?? '';
    const own = sealed === null ? null : decryptSecret(sealed, deps.secret);
    const keyUnreadable = sealed !== null && own === null;
    const key = own ?? envKey();
    return { provider, baseUrl, model, key, keySource: own !== null ? 'settings' : key !== null ? 'env' : null, keyUnreadable };
  }

  const urlOf = (e: { provider: ProviderId; baseUrl: string | null }): string | null => e.provider === 'custom' ? e.baseUrl : PROVIDERS[e.provider].baseUrl;

  let cache: { at: number; client: LlmClient | null } | null = null;
  const source: LlmSource = {
    async current() {
      if (cache && Date.now() - cache.at < CACHE_MS) return cache.client;
      const e = await effective();
      const url = urlOf(e);
      const client = e.key && url && e.model
        ? createDeepSeekClient({ apiKey: e.key, baseUrl: url, model: e.model, ...(deps.fetch ? { fetch: deps.fetch } : {}) })
        : null;
      cache = { at: Date.now(), client };
      return client;
    },
  };

  return {
    source,

    async view(): Promise<LlmConfigView> {
      const e = await effective();
      return {
        provider: e.provider,
        baseUrl: e.provider === 'custom' ? e.baseUrl : null,
        model: e.model,
        keySet: e.key !== null,
        keySource: e.keySource,
        keyHint: e.key ? keyHint(e.key) : null,
        keyUnreadable: e.keyUnreadable,
        providers: PROVIDER_IDS.map(option),
      };
    },

    async save(body: unknown, actor: string): Promise<Outcome> {
      const p = parseBody(body);
      if ('error' in p) return bad(p.error);
      // Без секрета сервера ключ зашифровать нечем; хранить его открыто мы не станем.
      if (typeof p.apiKey === 'string' && deps.secret.trim() === '') {
        return { ok: false, error: 'unavailable', message: 'На сервере не задан секрет для шифрования ключей (SETTINGS_SECRET), ключ сохранить нельзя.' };
      }
      await deps.settings.set(KEY_PROVIDER, p.provider, actor);
      await deps.settings.set(KEY_MODEL, p.model, actor);
      await deps.settings.set(KEY_BASE_URL, p.baseUrl, actor);
      let key: 'set' | 'removed' | undefined;
      if (typeof p.apiKey === 'string') {
        await deps.settings.set(KEY_API, encryptSecret(p.apiKey, deps.secret), actor);
        key = 'set';
      } else if (p.apiKey === null) {
        // Пустое значение вместо удаления строки: у SettingsRepo нет удаления, а null читается как «нет ключа».
        await deps.settings.set(KEY_API, null, actor);
        key = 'removed';
      }
      cache = null;
      // В журнале провайдер, модель и что сделали с ключом; сам ключ и адрес «другого» провайдера туда не попадают.
      await deps.audit.write(actor, 'settings.llm', 'settings', null, { provider: p.provider, model: p.model, ...(key ? { key } : {}) });
      return { ok: true };
    },

    /** Один короткий запрос тем же способом, каким помощник работает: видно, принял ли провайдер ключ и модель. Ничего не сохраняет. */
    async test(body: unknown): Promise<LlmTestResult> {
      const p = parseBody(body);
      if ('error' in p) return { ok: false, code: 'bad_request', message: p.error };
      const e = await effective();
      const key = typeof p.apiKey === 'string' ? p.apiKey : p.apiKey === null ? envKey() : e.key;
      if (!key) return { ok: false, code: 'nokey', message: 'Ключ не задан: введите его в поле выше.' };
      const url = p.provider === 'custom' ? p.baseUrl : PROVIDERS[p.provider].baseUrl;
      const client = createDeepSeekClient({
        apiKey: key, baseUrl: url!, model: p.model, maxAttempts: 1, timeoutMs: TEST_TIMEOUT_MS,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      const started = Date.now();
      try {
        await client.complete({ system: 'Ответь одним JSON-объектом {"ok": true}.', user: 'проверка связи', maxTokens: 20 });
        return { ok: true, provider: PROVIDERS[p.provider].label, model: p.model, ms: Date.now() - started };
      } catch (err) {
        return explain(err);
      }
    },
  };
}

export type LlmConfig = ReturnType<typeof createLlmConfig>;
