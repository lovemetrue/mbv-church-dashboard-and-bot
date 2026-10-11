import type { PlatformName } from './platform.js';

/**
 * Кому показывать новые вопросы анкеты (удобное время и адрес). Значение — настройка
 * EXTRA_QUESTIONS в .env:
 *   • all — всем;
 *   • off или пусто — никому;
 *   • список через запятую — только перечисленным: «111111111» (на любой платформе) или
 *     «max:111111111» / «telegram:222222222» (только на этой).
 *
 * Нужно, чтобы выложить новые вопросы в рабочего бота и сначала проверить их на себе:
 * остальные участники до включения проходят прежнюю анкету. Id — это id человека
 * (тот, что показывает /whoami), а не чата: в MAX они разные.
 *
 * Мусор вместо id никого не включает — лучше показать вопросы не тем, чем всем сразу.
 */
export function extraQuestionsEnabled(
  setting: string,
  platform: PlatformName,
  platformUserId: string,
): boolean {
  const value = setting.trim().toLowerCase();
  if (value === 'all') return true;
  if (value === '' || value === 'off') return false;

  return value.split(',').some((entry) => {
    const [first, second] = entry.trim().split(':');
    const [entryPlatform, id] = second === undefined ? [undefined, first] : [first, second];
    return id === platformUserId.trim().toLowerCase() && (entryPlatform === undefined || entryPlatform === platform);
  });
}

/** Ключ в `app_settings`: значение того же вида, что и `EXTRA_QUESTIONS` в `.env` (all · off · список id). */
export const EXTRA_QUESTIONS_KEY = 'bot.extra_questions';

/**
 * Откуда бот берёт «кому задавать новые вопросы»: сохранённое в настройках (его меняют в интерфейсе, без доступа к серверу)
 * важнее `.env`; пока ничего не сохраняли, действует `.env`. Читается раз в `ttlMs`, а не на каждое сообщение людей,
 * и при сбое базы бот не падает, а остаётся на `.env`: лучше не показать вопросы, чем остановить анкету.
 */
export function createExtraQuestionsSource(
  settings: { get<T>(key: string): Promise<T | null> },
  envValue: string,
  ttlMs = 15_000,
): () => Promise<string> {
  let cached: { value: string; at: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached && now - cached.at < ttlMs) return cached.value;
    let value = envValue;
    try {
      const stored = await settings.get<unknown>(EXTRA_QUESTIONS_KEY);
      if (typeof stored === 'string') value = stored;
    } catch {
      /* остаёмся на значении из .env */
    }
    cached = { value, at: now };
    return value;
  };
}
