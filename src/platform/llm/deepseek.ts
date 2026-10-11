/**
 * Клиент языковой модели DeepSeek (совместимый с OpenAI протокол `chat/completions`).
 *
 * Правила, ради которых он написан так:
 *  • ключ приходит только из окружения сервера (`DEEPSEEK_API_KEY`) и никуда не пишется: ни в журнал, ни в текст
 *    ошибки, ни в базу;
 *  • тело запроса и ответ не логируются и не попадают в сообщения об ошибках — в них бывают данные людей;
 *  • модель вызывается с температурой 0 и ответом в JSON: нам нужен разбор текста, а не сочинение.
 */
export type LlmErrorCode = 'auth' | 'rate' | 'server' | 'network' | 'format';

export class LlmError extends Error {
  constructor(readonly code: LlmErrorCode, message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmRequest { system: string; user: string; maxTokens?: number }
export interface LlmResponse { text: string; promptTokens?: number; completionTokens?: number }
export interface LlmClient {
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  /** Сколько раз пробовать при 429, 5xx и сбое сети. */
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDeepSeekClient(opts: DeepSeekOptions): LlmClient {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetch ?? fetch;
  const attempts = opts.maxAttempts ?? 3;
  const delay = opts.retryDelayMs ?? 1500;
  const timeout = opts.timeoutMs ?? 90_000;

  return {
    model,
    async complete(req) {
      let last: LlmError = new LlmError('network', 'Нет связи с сервисом помощника.');
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (attempt > 1) await sleep(delay * 2 ** (attempt - 2));
        let res: Response;
        try {
          res = await doFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
            body: JSON.stringify({
              model,
              temperature: 0,
              max_tokens: req.maxTokens ?? 4000,
              response_format: { type: 'json_object' },
              messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
            }),
            signal: AbortSignal.timeout(timeout),
          });
        } catch {
          // Причину (адрес, текст ошибки сети) не сохраняем: она может содержать адрес и заголовки.
          last = new LlmError('network', 'Нет связи с сервисом помощника.');
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'Сервис помощника не принял ключ. Проверьте DEEPSEEK_API_KEY.');
        if (res.status === 402) throw new LlmError('auth', 'На счёте помощника нет средств.');
        if (res.status === 429) { last = new LlmError('rate', 'Сервис помощника просит подождать (слишком много запросов).'); continue; }
        if (res.status >= 500) { last = new LlmError('server', 'Сервис помощника временно не работает.'); continue; }
        if (!res.ok) throw new LlmError('format', `Сервис помощника ответил ошибкой ${res.status}.`);
        let payload: { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        try {
          payload = (await res.json()) as typeof payload;
        } catch {
          throw new LlmError('format', 'Сервис помощника прислал непонятный ответ.');
        }
        const text = payload.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || text.trim() === '') throw new LlmError('format', 'Сервис помощника прислал пустой ответ.');
        return {
          text,
          ...(payload.usage?.prompt_tokens !== undefined ? { promptTokens: payload.usage.prompt_tokens } : {}),
          ...(payload.usage?.completion_tokens !== undefined ? { completionTokens: payload.usage.completion_tokens } : {}),
        };
      }
      throw last;
    },
  };
}

/** Помощник создаётся, только если на сервере есть ключ; нет ключа — функция выключена, остальное работает. */
export function llmFromEnv(env: NodeJS.ProcessEnv): LlmClient | null {
  const apiKey = env['DEEPSEEK_API_KEY']?.trim();
  if (!apiKey) return null;
  const baseUrl = env['DEEPSEEK_BASE_URL']?.trim();
  const model = env['DEEPSEEK_MODEL']?.trim();
  return createDeepSeekClient({ apiKey, ...(baseUrl ? { baseUrl } : {}), ...(model ? { model } : {}) });
}
