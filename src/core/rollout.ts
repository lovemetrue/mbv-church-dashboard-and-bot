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
