import { ageRange } from '../../core/matching.js';
import { classifyDays, negatedBefore, normalize, tokenize } from './days.js';
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

/**
 * Колонки матрицы «район × возраст». Это возрастные категории анкеты бота (`AGE_GROUPS`) и кампании: спрос от
 * ответов бота и места групп, подписанных теми же категориями, должны попадать в колонки с теми же названиями.
 * Порядок важен: по нему идут столбцы и подписи кластеров.
 */
export const AGE_COLUMNS = ['до 18', '18–25', '25–40', '40–55', '55–65', '65+'] as const;

/**
 * Границы колонок для человека (включительно), в том же порядке, что и `AGE_COLUMNS`. Цифра на стыке категорий
 * («25» есть и в «18–25», и в «25–40») принадлежит нижней колонке: человеку нужна ровно одна.
 */
export const AGE_COLUMN_RANGES: readonly (readonly [number, number])[] = [
  [0, 17],
  [18, 25],
  [26, 40],
  [41, 55],
  [56, 65],
  [66, 120],
];

/** Края колонок для групп: общая цифра («40» в «25–40» и «40–55») принадлежит обеим, поэтому границы смыкаются. */
const AGE_COLUMN_EDGES: readonly (readonly [number, number])[] = [
  [0, 18],
  [18, 25],
  [25, 40],
  [40, 55],
  [55, 65],
  [65, 121],
];

/**
 * Колонка человека — по середине его диапазона («35–45» → 40 → «25–40»). Середину округляем вниз,
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
 * Все колонки, которые задевает диапазон группы. Группа 35–50 принимает и «25–40», и «40–55»,
 * поэтому места в ней показываются в каждой из них. Неизвестный возраст группы — все колонки:
 * отсева по возрасту у такой группы нет, так что места годятся любому.
 *
 * Касание в одной цифре колонкой не считается: группа «40-55» из таблицы церкви — это колонка «40–55», а не
 * ещё и «25–40». Группа на одну цифру («40») идёт в колонку этой цифры, как человек.
 */
export function ageColumnsOverlapping(range: AgeRange): string[] {
  if (!range) return [...AGE_COLUMNS];
  if (range[0] === range[1]) {
    const one = ageColumnOf(range);
    return one ? [one] : [];
  }
  return AGE_COLUMNS.filter((_, i) => {
    const [from, to] = AGE_COLUMN_EDGES[i]!;
    return range[0] < to && from < range[1];
  });
}

// ── день и время ────────────────────────────────────────────────────────────

/**
 * День группы. Если в ячейке названо НЕСКОЛЬКО разных дней («Среда, Четверг», «пн-ср», «будни»), day = null:
 * движок сравнивает с одним днём, и брать «первый из двух» значило бы утверждать то, чего мы не
 * знаем. Для сравнения группа без дня получает нейтральные 0,5 («время уточнить»), что честнее,
 * чем штраф за день, который у группы тоже бывает. «Плавающий», пусто и строка 'None' — тоже null.
 * Дни читает тот же разбор, что и у человека (`classifyDays`): «ср», «Среда», «по средам» сходятся.
 */
function parseDay(raw: string | null | undefined): Day | null {
  const { days, avoid } = classifyDays(raw);
  return avoid.length === 0 && days.length === 1 ? days[0]! : null;
}

/**
 * Время суток: до 12:00 утро, 12:00–16:59 день, с 17:00 вечер. Принимает «19:00», «19.30» и слова
 * «Утро»/«День»/«Вечер» — в таблице встречается и то и другое. Всё остальное («19:00-21:00», «в 19:00»,
 * «вечером») читает разбор человеческого времени — он же понимает диапазоны и предлоги.
 */
function parseSlot(raw: string | null | undefined): Slot | null {
  const text = normalize(raw);
  if (!text) return null;
  if (text.startsWith('утр')) return 'утро';
  if (text.startsWith('ден') || text.startsWith('дн')) return 'день';
  if (text.startsWith('вечер')) return 'вечер';

  const clock = /^(\d{1,2})[:.](\d{2})$/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) return null;
    return SLOT_FOR_HOUR(hours);
  }
  return parseHumanSchedule(text).slot;
}

/**
 * День и время суток группы из двух колонок таблицы. Если колонка времени пуста, а время написано прямо в колонке дня
 * («Среда 19:00»), берём оттуда: пустое время группы даёт нейтральные очки, а оно у неё на самом деле есть.
 */
export function parseGroupWhen(day: string | null, time: string | null): { day: Day | null; slot: Slot | null } {
  return { day: parseDay(day), slot: parseSlot(time) ?? (normalize(time) === '' ? parseSlot(day) : null) };
}

/** «Вт, вечер» / «Вт» / «вечер» / null — так день и время показываются в карточках и причинах. */
export function formatWhen(day: Day | null, slot: Slot | null): string | null {
  if (day && slot) return `${day}, ${slot}`;
  return day ?? slot ?? null;
}

// ── удобное время человека, свободным текстом ───────────────────────────────

const SLOTS: readonly Slot[] = ['утро', 'день', 'вечер'];
const SLOT_FOR_HOUR = (hour: number): Slot => (hour < 12 ? 'утро' : hour < 17 ? 'день' : 'вечер');

/** «Любой день», «рабочий день», «весь день»: слово «день» здесь не время суток. */
const DAY_DETERMINERS = new Set(['любой', 'любое', 'каждый', 'каждое', 'рабочий', 'будний', 'выходной', 'целый', 'весь', 'этот', 'один', 'другой', 'какой', 'следующий', 'всякий']);

/** Время суток, которое называет слово под номером `at`; null — слово не про время суток. */
function slotOfWord(tokens: readonly string[], at: number): Slot | null {
  const word = tokens[at]!;
  const before = tokens[at - 1];
  if (/^утр(?:о|а|у|енн)/.test(word)) return 'утро';
  if (/^вечер/.test(word)) return 'вечер';
  if (word === 'днем' || /^днев/.test(word)) return 'день';
  if (word === 'день') return before !== undefined && DAY_DETERMINERS.has(before) ? null : 'день';
  // «В обед», «после обеда» — день; «до обеда» — утро.
  if (/^обед/.test(word)) return before === 'до' ? 'утро' : 'день';
  // «После работы» — вечер.
  if (/^работ/.test(word) && before === 'после') return 'вечер';
  return null;
}

/**
 * Дни и время суток из того, что человек написал: «пн, ср — с 17 до 22 часов», «по вечерам», «выходные»,
 * «пн-пт после 18». Дни читает `classifyDays` (сокращения, падежи, диапазоны, «кроме воскресенья»).
 * Отвечает честно «не знаю»: нет дней — пустой список, неясное время (утром или вечером) — null.
 * Диапазон часов относим к времени суток по середине («с 10 до 18» — день), одиночный час — по нему самому
 * («после 18» — вечер). Что человек назвал неподходящим («кроме воскресенья», «не утром»), возвращается отдельно
 * (`avoidDays`, `avoidSlots`) и подходящим не считается.
 */
export function parseHumanSchedule(raw: string | null | undefined): {
  days: Day[]; slot: Slot | null; avoidDays: Day[]; avoidSlots: Slot[];
} {
  const text = normalize(raw);
  const { days, avoid } = classifyDays(text);
  const none = { days, avoidDays: avoid };
  if (!text) return { ...none, slot: null, avoidSlots: [] };

  // Слова: утро / день / вечер. Несколько разных — время неясно.
  const tokens = tokenize(text);
  const wanted = new Set<Slot>();
  const unwanted = new Set<Slot>();
  tokens.forEach((_, at) => {
    const slot = slotOfWord(tokens, at);
    if (slot) (negatedBefore(tokens, at) ? unwanted : wanted).add(slot);
  });
  const avoidSlots = SLOTS.filter((s) => unwanted.has(s));
  if (wanted.size > 1) return { ...none, slot: null, avoidSlots };
  if (wanted.size === 1) return { ...none, slot: [...wanted][0]!, avoidSlots };

  // Часы: «с 17 до 22», «17:00-22:00», «после 18», «в 19:30». Считаем только числа, похожие на часы,
  // и только рядом с «с», «до», «после», «в», «к», «раньше», «позже» или двоеточием/дефисом: «дом 99» часом не считается.
  const hours: number[] = [];
  const PREFIX = 'с|до|после|в|к|около|раньше|позже';
  for (const m of text.matchAll(new RegExp(`(?:^|[^0-9а-я])(?:(?:${PREFIX})\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?(?=\\s*(?:-|–|—|до|час|ч\\b|:|$|[^0-9а-я]))`, 'g'))) {
    const prefixed = new RegExp(`(?:${PREFIX})\\s+$`).test(m[0].slice(0, m[0].search(/\d/)));
    const timeLike = m[2] !== undefined || prefixed || /[-–—]/.test(m[0]) || /час|ч\b/.test(text);
    const h = Number(m[1]);
    if (timeLike && h >= 0 && h <= 23) hours.push(h);
  }
  if (hours.length >= 2) return { ...none, slot: SLOT_FOR_HOUR(Math.floor((hours[0]! + hours[1]!) / 2)), avoidSlots };
  if (hours.length === 1) {
    const endOnly = /до\s+\d{1,2}(?:[:.]\d{2})?\s*(?:час|ч\b)?\s*$/.test(text) && !/с\s+\d/.test(text);
    return { ...none, slot: SLOT_FOR_HOUR(endOnly ? Math.max(0, hours[0]! - 1) : hours[0]!), avoidSlots };
  }
  return { ...none, slot: null, avoidSlots };
}
