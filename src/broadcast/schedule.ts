/**
 * Расчёт дня кампании и момента рассылки.
 *
 * Всё считается по календарю нужного часового пояса, а не по разнице в миллисекундах:
 * иначе рассылка на границе полуночи уезжает на сутки.
 */

export interface ScheduleOptions {
  /** Первый день кампании, YYYY-MM-DD. */
  startDate: string;
  /** Время ежедневной рассылки, HH:MM. */
  broadcastTime: string;
  totalDays: number;
  timezone: string;
}

/** Дата в указанном поясе в формате YYYY-MM-DD. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Время в указанном поясе в формате HH:MM. */
export function localTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** Полдень указанной календарной даты в UTC: безопасная точка для вычитания дат. */
function midday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!, 12);
}

/**
 * Номер дня кампании: 1 в день старта, 0 до старта.
 * Больше totalDays означает, что кампания закончилась.
 */
export function campaignDay(now: Date, opts: ScheduleOptions): number {
  const today = localDate(now, opts.timezone);
  const diffDays = Math.round((midday(today) - midday(opts.startDate)) / 86_400_000);
  return diffDays < 0 ? 0 : diffDays + 1;
}

/**
 * День, рассылку за который пора отправить прямо сейчас, или null.
 * Проверка «время уже наступило» вместо «время совпало» нужна затем,
 * чтобы бот, поднятый в 09:00 после ночного простоя, всё равно отправил утреннюю рассылку.
 */
export function dueBroadcast(now: Date, opts: ScheduleOptions): number | null {
  const day = campaignDay(now, opts);
  if (day < 1 || day > opts.totalDays) return null;
  if (localTime(now, opts.timezone) < opts.broadcastTime) return null;
  return day;
}
