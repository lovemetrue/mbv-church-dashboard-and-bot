import { ageRange } from '../../core/matching.js';
import type { AgeRange, Day, Slot } from './types.js';

/**
 * Разбор «как записано в таблице церкви» в значения, с которыми работает движок.
 * В таблице одно и то же пишут десятком способов, поэтому всё нераспознанное — null
 * («не знаем»), а не ошибка: неизвестный параметр движок честно не учитывает.
 */

// ── возраст ─────────────────────────────────────────────────────────────────

/**
 * «35-45 лет», «65+», «подростки (до 18 лет)», «любой», пусто → диапазон или null.
 * «Любой» и пустота — null, а не [0, 120]: иначе человек «любого возраста» считался бы
 * известным параметром и завышал уверенность плана.
 */
export function parseAgeRange(text: string | null | undefined): AgeRange {
  return ageRange(text);
}

/** Колонки матрицы «район × возраст». Порядок важен: по нему идут столбцы и подписи кластеров. */
export const AGE_COLUMNS = ['до 18', '18–25', '26–35', '36–45', '46+'] as const;

/** Границы колонок (включительно), в том же порядке, что и `AGE_COLUMNS`. */
export const AGE_COLUMN_RANGES: readonly (readonly [number, number])[] = [
  [0, 17],
  [18, 25],
  [26, 35],
  [36, 45],
  [46, 120],
];

/**
 * Колонка человека — по середине его диапазона («35–45» → 40 → «36–45»). Середину округляем вниз,
 * чтобы диапазон «17–34» (середина 25,5) оставался в «18–25», а не прыгал в соседнюю колонку.
 */
export function ageColumnOf(range: AgeRange): string | null {
  if (!range) return null;
  const middle = Math.floor((range[0] + range[1]) / 2);
  const index = AGE_COLUMN_RANGES.findIndex(([from, to]) => middle >= from && middle <= to);
  // Середина вне 0–120 (мусор вроде [200, 300]) — в крайнюю колонку, а не «нет возраста».
  const clamped = index === -1 ? (middle < 0 ? 0 : AGE_COLUMNS.length - 1) : index;
  return AGE_COLUMNS[clamped] ?? null;
}

/**
 * Все колонки, которые задевает диапазон группы. Группа 35–50 принимает и «26–35», и «36–45», и «46+»,
 * поэтому места в ней показываются в каждой из них. Неизвестный возраст группы — все колонки:
 * отсева по возрасту у такой группы нет, так что места годятся любому.
 */
export function ageColumnsOverlapping(range: AgeRange): string[] {
  if (!range) return [...AGE_COLUMNS];
  return AGE_COLUMNS.filter((_, i) => {
    const [from, to] = AGE_COLUMN_RANGES[i]!;
    return range[0] <= to && from <= range[1];
  });
}

// ── день и время ────────────────────────────────────────────────────────────

/** Основы названий дней: «среда», «среду», «пятница», «пятницу» и «ср» сходятся по основе. */
const DAY_STEMS: readonly (readonly [RegExp, Day])[] = [
  [/понедельник|(?:^|[^а-я])пн(?![а-я])/, 'Пн'],
  [/вторник|(?:^|[^а-я])вт(?![а-я])/, 'Вт'],
  [/сред[аыуе]|(?:^|[^а-я])ср(?![а-я])/, 'Ср'],
  [/четверг|(?:^|[^а-я])чт(?![а-я])/, 'Чт'],
  [/пятниц|(?:^|[^а-я])пт(?![а-я])/, 'Пт'],
  [/суббот|(?:^|[^а-я])сб(?![а-я])/, 'Сб'],
  [/воскресень|(?:^|[^а-я])вс(?![а-я])/, 'Вс'],
];

const clean = (raw: string | null | undefined): string => (raw ?? '').toLowerCase().replaceAll('ё', 'е').trim();

/**
 * День группы. Если в ячейке названо НЕСКОЛЬКО разных дней («Среда, Четверг»), day = null:
 * движок сравнивает с одним днём, и брать «первый из двух» значило бы утверждать то, чего мы не
 * знаем. Для сравнения группа без дня получает нейтральные 0,5 («время уточнить»), что честнее,
 * чем штраф за день, который у группы тоже бывает. «Плавающий», пусто и строка 'None' — тоже null.
 */
function parseDay(raw: string | null | undefined): Day | null {
  const text = clean(raw);
  if (!text) return null;
  const found = DAY_STEMS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day);
  return found.length === 1 ? found[0]! : null;
}

/**
 * Время суток: до 12:00 утро, 12:00–16:59 день, с 17:00 вечер. Принимает «19:00», «19.30» и слова
 * «Утро»/«День»/«Вечер» — в таблице встречается и то и другое.
 */
function parseSlot(raw: string | null | undefined): Slot | null {
  const text = clean(raw);
  if (!text) return null;
  if (text.startsWith('утр')) return 'утро';
  if (text.startsWith('ден') || text.startsWith('дн')) return 'день';
  if (text.startsWith('вечер')) return 'вечер';

  const clock = /^(\d{1,2})[:.](\d{2})$/.exec(text);
  if (!clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;
  if (hours < 12) return 'утро';
  return hours < 17 ? 'день' : 'вечер';
}

export function parseGroupWhen(day: string | null, time: string | null): { day: Day | null; slot: Slot | null } {
  return { day: parseDay(day), slot: parseSlot(time) };
}

/** «Вт, вечер» / «Вт» / «вечер» / null — так день и время показываются в карточках и причинах. */
export function formatWhen(day: Day | null, slot: Slot | null): string | null {
  if (day && slot) return `${day}, ${slot}`;
  return day ?? slot ?? null;
}
