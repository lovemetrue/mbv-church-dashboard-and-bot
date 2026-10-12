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
  /**
   * `status` — код ответа провайдера, `detail` — его короткое пояснение (`error.message`) с закрытыми ключами. Они нужны
   * только кнопке «Проверить» в настройках: в обычных сообщениях помощника пояснения нет, чтобы ничего лишнего не утекло.
   */
  constructor(readonly code: LlmErrorCode, message: string, readonly status?: number, readonly detail?: string) {
    super(message);
    this.name = 'LlmError';
  }
}

const DETAIL_LIMIT = 300;

/** Пояснение провайдера из тела ошибки: только поле `error.message`, без ключей, не длиннее лимита; остальное тело не читаем. */
async function errorDetail(res: Response, apiKey: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { message?: unknown } | unknown };
    const raw = (parsed.error as { message?: unknown } | undefined)?.message;
    if (typeof raw !== 'string') return undefined;
    let text = raw.replace(/\s+/g, ' ').trim();
    if (apiKey) text = text.split(apiKey).join('***');
    // Чужие ключи, которые провайдер мог процитировать («sk-…», «Bearer …»), тоже закрываем.
    text = text.replace(/\b(sk|pk|key)-[A-Za-z0-9_-]{8,}/g, '$1-***').replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer ***');
    return text === '' ? undefined : text.slice(0, DETAIL_LIMIT);
  } catch {
    return undefined;
  }
}

export interface LlmRequest { system: string; user: string; maxTokens?: number }
export interface LlmResponse { text: string; promptTokens?: number; completionTokens?: number }
/** Разговор с вызовом инструментов (функций): модель просит выполнить запрос, сервис выполняет и возвращает результат. */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };
export interface ToolCall { id: string; name: string; arguments: string }
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ChatRequest { messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number }
export interface ChatResponse { content: string | null; toolCalls: ToolCall[]; promptTokens?: number; completionTokens?: number }

export interface LlmClient {
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/**
 * Источник клиента, который читает подключение (ключ, провайдер, модель) при каждом обращении: ключ и модель меняют
 * в интерфейсе, и перезапуск сервиса для этого не нужен. `null` — ключа нет, помощник выключен.
 */
export interface LlmSource { current(): Promise<LlmClient | null> }

/** Клиент можно передать готовым (как в тестах) или источником; результат всегда один и тот же вид. */
export async function resolveLlm(x: LlmClient | LlmSource | null): Promise<LlmClient | null> {
  if (x === null) return null;
  return 'current' in x ? x.current() : x;
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

  /** Один запрос к сервису с повторами при 429, 5xx и сбое сети. Тело запроса и ответа нигде не сохраняется и в ошибки не попадает. */
  async function post(body: Record<string, unknown>): Promise<{
    choices?: { message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }> {
    let last: LlmError = new LlmError('network', 'Нет связи с сервисом помощника.');
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(delay * 2 ** (attempt - 2));
      let res: Response;
      try {
        res = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model, temperature: 0, ...body }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        // Причину (адрес, текст ошибки сети) не сохраняем: она может содержать адрес и заголовки.
        last = new LlmError('network', 'Нет связи с сервисом помощника.');
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'Сервис помощника не принял ключ. Проверьте ключ в «Настройки → Помощник».', res.status, await errorDetail(res, opts.apiKey));
      if (res.status === 402) throw new LlmError('auth', 'На счёте помощника нет средств.', 402, await errorDetail(res, opts.apiKey));
      if (res.status === 429) { last = new LlmError('rate', 'Сервис помощника просит подождать (слишком много запросов).', 429, await errorDetail(res, opts.apiKey)); continue; }
      if (res.status >= 500) { last = new LlmError('server', 'Сервис помощника временно не работает.', res.status); continue; }
      if (!res.ok) throw new LlmError('format', `Сервис помощника ответил ошибкой ${res.status}.`, res.status, await errorDetail(res, opts.apiKey));
      try {
        return (await res.json()) as Awaited<ReturnType<typeof post>>;
      } catch {
        throw new LlmError('format', 'Сервис помощника прислал непонятный ответ.');
      }
    }
    throw last;
  }

  return {
    model,
    async complete(req) {
      const payload = await post({
        max_tokens: req.maxTokens ?? 4000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      });
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.trim() === '') throw new LlmError('format', 'Сервис помощника прислал пустой ответ.');
      return {
        text,
        ...(payload.usage?.prompt_tokens !== undefined ? { promptTokens: payload.usage.prompt_tokens } : {}),
        ...(payload.usage?.completion_tokens !== undefined ? { completionTokens: payload.usage.completion_tokens } : {}),
      };
    },

    async chat(req) {
      const payload = await post({
        max_tokens: req.maxTokens ?? 2000,
        messages: req.messages.map((m) => m.role === 'tool'
          ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
          : m.role === 'assistant'
            ? { role: 'assistant', content: m.content, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })) } : {}) }
            : m),
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      });
      const message = payload.choices?.[0]?.message;
      if (!message) throw new LlmError('format', 'Сервис помощника прислал пустой ответ.');
      const toolCalls = (message.tool_calls ?? []).flatMap((t) => (t.id && t.function?.name ? [{ id: t.id, name: t.function.name, arguments: t.function.arguments ?? '{}' }] : []));
      const content = typeof message.content === 'string' ? message.content : null;
      if (content === null && toolCalls.length === 0) throw new LlmError('format', 'Сервис помощника прислал пустой ответ.');
      return {
        content, toolCalls,
        ...(payload.usage?.prompt_tokens !== undefined ? { promptTokens: payload.usage.prompt_tokens } : {}),
        ...(payload.usage?.completion_tokens !== undefined ? { completionTokens: payload.usage.completion_tokens } : {}),
      };
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
