/**
 * Провайдеры языковой модели, которых можно выбрать в «Настройки → Помощник». Все говорят на одном протоколе
 * `chat/completions`, поэтому отличаются адресом и именами моделей. Список моделей — подсказка, а не ограничение:
 * у провайдеров они появляются и закрываются чаще, чем мы выкладываем сервис, поэтому название можно вписать.
 */
export const PROVIDER_IDS = ['deepseek', 'openai', 'openrouter', 'custom'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderPreset {
  label: string;
  /** null у «другого»: адрес вводит человек. */
  baseUrl: string | null;
  models: readonly string[];
  defaultModel: string | null;
  /** Что важно знать, выбирая этого провайдера. */
  note: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat'],
    defaultModel: 'deepseek-chat',
    note: 'Ключ выдаётся на platform.deepseek.com. Помощник проверен на этом провайдере.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    defaultModel: 'gpt-4o-mini',
    note: 'Ключ выдаётся на platform.openai.com. Часть новых моделей не принимает параметры помощника: проверьте кнопкой «Проверить».',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini'],
    defaultModel: 'deepseek/deepseek-chat',
    note: 'Один ключ для многих моделей разных компаний. Название модели — в виде «компания/модель».',
  },
  custom: {
    label: 'Другой (совместимый с OpenAI)',
    baseUrl: null,
    models: [],
    defaultModel: null,
    note: 'Любой сервис с адресом вида …/v1/chat/completions. Адрес только https.',
  },
};

export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);

const MAX_URL = 200;

/**
 * Адрес «другого» провайдера: только https, без логина в адресе и не во внутреннюю сеть. Сервис шлёт на этот адрес
 * ключ и тексты заявок, поэтому внутренние адреса (сама машина, соседние контейнеры, метаданные облака) закрыты.
 * Это защита от ошибки и от подмены, а не от злого умысла полного входа: DNS-имя, указывающее внутрь, она не поймает.
 */
export function validateBaseUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Укажите адрес провайдера.' };
  if (text.length > MAX_URL) return { ok: false, message: 'Адрес слишком длинный.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'Адрес должен начинаться с https://, например https://api.example.com/v1.' };
  }
  if (url.protocol !== 'https:') return { ok: false, message: 'Адрес должен начинаться с https://: ключ нельзя отправлять по открытому каналу.' };
  if (url.username !== '' || url.password !== '') return { ok: false, message: 'В адресе не должно быть логина и пароля.' };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const internal =
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') ||
    // Имя без точки — это соседний контейнер или машина внутри сети.
    !host.includes('.') && !host.includes(':') ||
    host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') && host.includes(':') || host.startsWith('fd') && host.includes(':') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (internal) return { ok: false, message: 'Этот адрес ведёт во внутреннюю сеть сервера. Нужен внешний адрес провайдера.' };
  return { ok: true, url: text.replace(/\/+$/, '') };
}
