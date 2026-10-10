import { ru } from '../shared/i18n/ru';

/**
 * Приветствие по времени суток. Берём час на устройстве служителя, а не серверный:
 * служитель видит экран у себя, а сервер может стоять в другом часовом поясе.
 */
export function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return ru.today.greetingMorning;
  if (h >= 12 && h < 18) return ru.today.greetingDay;
  if (h >= 18 && h < 23) return ru.today.greetingEvening;
  return ru.today.greetingNight;
}

/**
 * Дата из ISO («2026-10-09» или с временем) в «09.10». Разбираем строку руками, а не через Date:
 * `new Date('2026-10-09')` — это полночь по UTC, и в минусовых поясах день сдвигается назад
 * (в плюсовых это не видно, но ту же ловушку CLAUDE.md описывает для `DATE` в базе).
 */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[3]}.${m[2]}`;
}

/** «09.10.2026»; для карточек, где год важен. */
export function formatDateFull(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * Телефон для показа. Российские номера из 11 цифр (7… или 8…) приводим к «+7 911 123 24 18»;
 * всё остальное (маски вроде «+7 911 ··· 24 18», иностранные номера) показываем как пришло:
 * лучше показать как есть, чем испортить.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const onlyPhoneChars = /^[+\d\s()-]+$/.test(raw);
  if (onlyPhoneChars && digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
  }
  return raw;
}

/** Только цифры: для поиска «9114» по номеру в любой записи. */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** «№12» или, если у группы нет номера в реестре, её код («ДГ-0012»). */
export function groupLabel(g: { no: number | null; code: string }): string {
  return g.no != null ? `№${g.no}` : g.code;
}

/** «Ольга К. · Вт, вечер» — подпись группы в списках. */
export function groupLine(g: { no: number | null; code: string; leader: string; whenText: string | null }): string {
  return [groupLabel(g), g.leader, g.whenText].filter(Boolean).join(' · ');
}

/** Цвет шкалы здоровья по порогам прототипа. */
export type HealthTone = 'ok' | 'warn' | 'crit';
export function healthTone(score: number): HealthTone {
  if (score >= 80) return 'ok';
  if (score >= 60) return 'warn';
  return 'crit';
}

/**
 * «9 октября, 12:30» — дата и время по-русски, в часовом поясе браузера. Для «последнего запуска»:
 * год не нужен, а время нужно, потому что автоматический подбор идёт несколько раз в день.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
