import { DISTRICTS } from './groups.js';

/**
 * Подбор домашней группы человеку, который хочет присоединиться.
 *
 * Правила — «разнарядка» автора сервиса, и они намеренно простые: работают на текущих
 * данных, без внешних сервисов, и каждое очко можно объяснить служителю словами.
 *
 * Жёсткие условия — группа отсекается, если не выполнено хотя бы одно:
 *   • статус «Функционирует» или «Кампания»;
 *   • приём новых не «Нет»;
 *   • возраст группы пересекается с возрастом человека;
 *   • у группы не стоит отметка «Не направлять».
 * Мягкие условия дают очки: тот же район +3, то же метро или ориентир +2, «Кампания» в период
 * кампании +2, участников меньше, чем в соседних группах, +1.
 *
 * Новые группы (статус «Кампания» — заведены под кампанию) идут первыми; действующие
 * добавляются, только если новых подходящих меньше NEW_ENOUGH.
 *
 * Функция чистая — как fsm.ts: всё нужное приходит аргументами, поэтому ей не нужна база.
 */

/** Сколько подходящих новых групп считаем достаточным, чтобы действующие не показывать. */
export const NEW_ENOUGH = 3;
/** Больше служителю не нужно: дальше он всё равно выбирает из списка вручную. */
export const MAX_SUGGESTIONS = 5;

const PASSING_STATUSES = new Set(['Функционирует', 'Кампания']);
const FRESH_STATUS = 'Кампания';

export interface MatchPerson {
  /** Возрастная категория бота («25-40») или то, что записано в заявке из таблицы. */
  age: string | null;
  /** Район и метро одним свободным текстом — так человек отвечает в боте. */
  place: string | null;
}

export interface MatchGroup {
  id: number;
  status: string;
  open_to_new: string | null;
  age: string | null;
  district: string;
  metro: string | null;
  people: number | null;
  /** Отметка «Не направлять»: группа скрыта из подбора. */
  do_not_refer: boolean;
}

export interface Suggestion {
  groupId: number;
  score: number;
  /** Новая группа (заведена под кампанию) — в отличие от действующей. */
  fresh: boolean;
  /** Коротко, почему предложена: показываются рядом с группой. */
  reasons: string[];
}

export interface MatchOptions {
  /** Идёт ли сейчас кампания: от этого зависит очко за статус «Кампания». */
  campaignActive: boolean;
}

// ── возраст ─────────────────────────────────────────────────────────────────

const ANY_AGE_MAX = 120;

/**
 * Возраст в числовой диапазон. null — «не знаем»: пусто, «любой» и всё нераспознанное.
 * Возраст группы в таблице записан как попало («35-45 лет», «65+», «любой»), а у человека
 * это категория бота, поэтому разбираем и то и другое одной функцией.
 */
export function ageRange(raw: string | null | undefined): [number, number] | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/лет|года?|\s/g, '');
  if (!t) return null;
  if (t.includes('подрост')) return [12, 17];

  const range = /^(\d{1,3})[-–—](\d{1,3})$/.exec(t);
  if (range) return [Number(range[1]), Number(range[2])];

  const plus = /^(\d{1,3})\+$/.exec(t);
  if (plus) return [Number(plus[1]), ANY_AGE_MAX];

  const n = Number.parseFloat(t);
  return Number.isFinite(n) && /^\d+([.,]\d+)?$/.test(t) ? [Math.floor(n), Math.floor(n)] : null;
}

const overlap = (a: [number, number], b: [number, number]): boolean => a[0] <= b[1] && b[0] <= a[1];

// ── район и метро ───────────────────────────────────────────────────────────

const normalize = (s: string): string =>
  s.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Как район может быть написан в свободном тексте. Берём основу без окончания и пускаем
 * только мужские окончания прилагательного («приморск» + ий/ом/ого…): женские («-ая») — это
 * станции метро Пушкинская и Московская, не районы.
 */
const ADJECTIVE_ENDINGS = '(?:ий|ый|ого|ом|ому|им|ым|ие|ые|их|ых)';

const DISTRICT_PATTERNS = new Map<string, RegExp>([
  ...DISTRICTS.map((name): [string, RegExp] => [
    name,
    new RegExp(`${normalize(name).slice(0, -2)}${ADJECTIVE_ENDINGS}`),
  ]),
  ['Ленинградская область', /ленинградск|лен\.?\s?обл|(?:^|\s)ло(?:\s|$|,)/],
  ['Онлайн', /онлайн|online/],
]);

export function matchesDistrict(place: string | null | undefined, district: string): boolean {
  if (!place) return false;
  return DISTRICT_PATTERNS.get(district)?.test(normalize(place)) ?? false;
}

/** Слова, которые есть в названии многих станций и сами станцию не определяют. */
const GENERIC_WORDS = new Set(['проспект', 'площадь', 'улица', 'пл', 'пр', 'ул', 'станция', 'метро', 'м']);

/** Основа слова без падежного окончания: «Пионерской» и «Пионерская» сходятся. */
const stem = (word: string): string => (word.length >= 5 ? word.slice(0, -2) : word);

/**
 * Назвал ли человек метро или ориентир группы. В колонке группы может быть несколько
 * станций через запятую. Совпасть должны все значимые слова станции («Старая Деревня»), а
 * «проспект», «площадь» в расчёт не идут: иначе «Невский проспект» совпал бы с любым проспектом.
 */
export function matchesMetro(place: string | null | undefined, metro: string | null | undefined): boolean {
  if (!place || !metro) return false;
  const text = normalize(place);
  return metro
    .split(/[,;/]/)
    .map((station) => normalize(station).split(' ').filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)))
    .filter((words) => words.length > 0)
    .some((words) => words.every((w) => text.includes(stem(w))));
}

// ── подбор ──────────────────────────────────────────────────────────────────

const isOpenToNew = (g: MatchGroup): boolean => (g.open_to_new ?? '').trim().toLowerCase() !== 'нет';

/** Подходит ли группа по жёстким условиям. Возраст, которого не знаем, группу не отсекает. */
function passesHard(person: MatchPerson, g: MatchGroup): boolean {
  if (!PASSING_STATUSES.has(g.status) || !isOpenToNew(g) || g.do_not_refer) return false;
  const mine = ageRange(person.age);
  const theirs = ageRange(g.age);
  return !(mine && theirs && !overlap(mine, theirs));
}

/**
 * Соседи — действующие группы того же района с известным числом участников. Скрытые из
 * подбора и закрытые не считаем: сравнивать надо с теми, куда реально можно направить.
 */
function neighbourAverage(g: MatchGroup, all: readonly MatchGroup[]): number | null {
  const sizes = all
    .filter((o) => o.id !== g.id && o.district === g.district && PASSING_STATUSES.has(o.status) && !o.do_not_refer)
    .map((o) => o.people)
    .filter((n): n is number => n !== null);
  return sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null;
}

function score(person: MatchPerson, g: MatchGroup, all: readonly MatchGroup[], opts: MatchOptions): Suggestion {
  let points = 0;
  const reasons: string[] = [];

  if (matchesDistrict(person.place, g.district)) {
    points += 3;
    reasons.push(`тот же район (${g.district})`);
  }
  if (matchesMetro(person.place, g.metro)) {
    points += 2;
    reasons.push(`рядом: ${g.metro}`);
  }
  if (g.status === FRESH_STATUS && opts.campaignActive) {
    points += 2;
    reasons.push('группа кампании');
  }
  const average = neighbourAverage(g, all);
  if (g.people !== null && average !== null && g.people < average) {
    points += 1;
    reasons.push(`мало участников: ${g.people} при среднем ${Math.round(average)} в районе`);
  }
  if (ageRange(person.age) && ageRange(g.age)) reasons.push(`возраст подходит (${g.age})`);

  return { groupId: g.id, score: points, fresh: g.status === FRESH_STATUS, reasons };
}

/** Выше — больше очков; при ничьей — группа поменьше (людей расселяем равномерно); неизвестное — в конец. */
function byRank(groups: ReadonlyMap<number, MatchGroup>) {
  return (a: Suggestion, b: Suggestion): number =>
    b.score - a.score ||
    (groups.get(a.groupId)!.people ?? Infinity) - (groups.get(b.groupId)!.people ?? Infinity) ||
    a.groupId - b.groupId;
}

export function suggestGroups(
  person: MatchPerson,
  groups: readonly MatchGroup[],
  opts: MatchOptions,
): Suggestion[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rank = byRank(byId);
  const passing = groups
    .filter((g) => passesHard(person, g))
    .map((g) => score(person, g, groups, opts));

  const fresh = passing.filter((s) => s.fresh).sort(rank);
  const existing = passing.filter((s) => !s.fresh).sort(rank);
  const result = fresh.length >= NEW_ENOUGH ? fresh : [...fresh, ...existing];
  return result.slice(0, MAX_SUGGESTIONS);
}
