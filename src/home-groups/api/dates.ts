/**
 * Календарные даты без часового пояса.
 *
 * Колонки `date` приходят из базы строкой «2026-10-09» (см. src/db/pool.ts), и считать «дней
 * назад» через `new Date('2026-10-09')` нельзя: это полночь по UTC, а «сегодня» для церкви —
 * по московскому времени. Поэтому сегодняшнюю дату берём в поясе сервиса, а разницу считаем
 * между двумя календарными датами, а не между моментами.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** «Сегодня» в заданном поясе, как «YYYY-MM-DD». */
export function localIsoDate(moment: Date, timeZone: string): string {
  // en-CA отдаёт ровно «год-месяц-день» — формат менять не придётся.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
}

function dayNumber(iso: string): number | null {
  const m = ISO_DATE.exec(iso.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC молча «переносит» 31 февраля на март — отсекаем такие даты.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

/**
 * Сколько полных суток прошло с `iso` до `todayIso`. Дата в будущем даёт 0: «ждёт минус три дня»
 * человеку не нужно, а опечатка в таблице не должна ломать порядок очереди. Нет даты — null.
 */
export function daysSince(iso: string | null | undefined, todayIso: string): number | null {
  if (!iso) return null;
  const from = dayNumber(iso);
  const to = dayNumber(todayIso);
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

/** Возвращает дату, только если она настоящая «YYYY-MM-DD»; иначе null. */
export function validIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return dayNumber(iso) === null ? null : iso.trim();
}
