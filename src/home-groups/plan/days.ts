import type { Day } from './types.js';

/**
 * Дни недели из свободного текста. Это единственное место, где слова «ср», «пт», «в пятницу», «по вторникам»
 * превращаются в день: им читаются и удобное время человека, и колонка «день» группы. Скрипт делает это сам
 * (а не нейросеть): вокруг дня подбор строится так же строго, как вокруг района, и ошибка здесь стоит группы.
 *
 * Разбор идёт по словам, а не по подстрокам: «вс» — день, а «все», «всегда» и «вскоре» — нет; «ср» — день, а
 * «средний» и «среди» — нет; «пт» — день, «пять» и «птица» — нет. Что не распознано, остаётся неизвестным.
 */

export const WEEK: readonly Day[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS = WEEK.slice(0, 5);
const WEEKEND = WEEK.slice(5);

const dayIndex = (day: Day): number => WEEK.indexOf(day);

/**
 * Сокращения целиком (слово равно сокращению). «воск» намеренно нет: это ещё и «воск». Сокращения короче трёх букв
 * безопасны только потому, что слово сравнивается целиком, а не ищется внутри других слов.
 */
const ABBREVIATIONS: Readonly<Record<string, Day>> = {
  пн: 'Пн', пнд: 'Пн', пон: 'Пн', понед: 'Пн',
  вт: 'Вт', втр: 'Вт', втор: 'Вт',
  ср: 'Ср', срд: 'Ср', сред: 'Ср',
  чт: 'Чт', чтв: 'Чт', четв: 'Чт',
  пт: 'Пт', птн: 'Пт', пятн: 'Пт',
  сб: 'Сб', суб: 'Сб', субб: 'Сб',
  вс: 'Вс', вск: 'Вс', воскр: 'Вс',
};

/**
 * Полные названия по основе (любое окончание: «пятницу», «пятницам»). У «среды» окончания перечислены: основа «сред»
 * без этого поймала бы «средний», «средства» и «среди».
 */
const NAMES: readonly (readonly [RegExp, Day])[] = [
  [/^понедельник/, 'Пн'],
  [/^вторник/, 'Вт'],
  [/^сред(?:а|ы|у|е|ой|ам|ах|ами)$/, 'Ср'],
  [/^четверг/, 'Чт'],
  [/^пятниц/, 'Пт'],
  [/^суббот/, 'Сб'],
  [/^воскресен/, 'Вс'],
];

/** Слова, за которыми стоит сразу несколько дней: «будни», «по выходным». */
const GROUPS: readonly (readonly [RegExp, readonly Day[]])[] = [
  [/^будн/, WEEKDAYS],
  [/^выходн/, WEEKEND],
  [/^уикенд/, WEEKEND],
];

/** Слово в день (или дни); `named` — слово называет один конкретный день, а не группу дней. */
function dayOfWord(word: string): { days: readonly Day[]; named: boolean } | null {
  const abbreviation = ABBREVIATIONS[word];
  if (abbreviation) return { days: [abbreviation], named: true };
  for (const [pattern, day] of NAMES) if (pattern.test(word)) return { days: [day], named: true };
  for (const [pattern, days] of GROUPS) if (pattern.test(word)) return { days, named: false };
  return null;
}

/** Нижний регистр, «ё» → «е»: так «днём» и «днем» одно слово, а проверки ниже пишутся один раз. */
export const normalize = (raw: string | null | undefined): string => (raw ?? '').toLowerCase().replaceAll('ё', 'е').trim();

/** Слова (русские буквы подряд), числа и отдельные знаки; пробелы выбрасываются. */
export function tokenize(raw: string | null | undefined): string[] {
  return normalize(raw).match(/[а-я]+|\d+|[^\sа-я\d]/g) ?? [];
}

// ── «не» и «кроме» ──────────────────────────────────────────────────────────

/** Слова, которые могут стоять между «не»/«кроме» и днём: «не могу в пятницу», «только не по средам». */
const FILLERS = new Set([
  'в', 'во', 'на', 'по', 'с', 'со', 'к', 'ко', 'у', 'только', 'могу', 'смогу', 'можем', 'сможем', 'получится', 'получается',
  'удобно', 'подходит', 'подойдет', 'подойдут', 'буду', 'мне', 'нам', 'меня', 'нас', 'ходить', 'приходить', 'прийти', 'приду',
  'быть', 'бывать', 'ни', 'бы', 'ли', 'же', 'именно', 'как',
]);
const NEGATIONS = new Set(['не', 'кроме', 'исключая', 'без', 'нельзя']);
/** «Вторник не могу», «вт, чт не получится»: отрицание после дня. «Не раньше 18» сюда не попадает. */
const TRAILING_VERBS = new Set(['могу', 'смогу', 'можем', 'сможем', 'получится', 'получается', 'удобно', 'подходит', 'подойдет', 'свободен', 'свободна', 'буду']);

/**
 * Отрицает ли что-то слово под номером `at`: впереди «не», «кроме» или «без», а между ними только служебные слова.
 * Любое другое слово или запятая обрывает отрицание: «кроме вс, но пн можно» — пн подходит.
 */
export function negatedBefore(tokens: readonly string[], at: number): boolean {
  for (let k = at - 1, steps = 0; k >= 0 && steps < 5; k--, steps++) {
    const token = tokens[k]!;
    if (NEGATIONS.has(token)) return true;
    if (!FILLERS.has(token)) return false;
  }
  return false;
}

// ── серии дней: «пн, ср и пт», «пн-ср», «сб/вс» ─────────────────────────────

const LIST_CONNECTORS = new Set([',', '/', ';', '&', '+', 'и', 'или']);
const DASHES = new Set(['-', '–', '—']);
/** Предлоги, которые могут стоять перед следующим днём в перечислении: «по средам и по четвергам». */
const PREPOSITIONS = new Set(['в', 'во', 'на', 'по']);

type Link = 'list' | 'range';

/**
 * Что стоит между двумя днями. null — это уже не серия. Тире между двумя днями («пн-ср») и «с пн по ср»,
 * «с пн до ср» — диапазон; запятая, слэш, «и», «или» — перечисление. Три дня через тире («пн-ср-пт») — тоже
 * перечисление, это решается ниже по числу звеньев.
 */
function connector(tokens: readonly string[], from: number, leftStart: number): { link: Link; next: number } | null {
  let k = from;
  let sawList = false;
  let dash = false;
  let to: 'по' | 'до' | null = null;
  let count = 0;
  while (k < tokens.length && count < 3) {
    const token = tokens[k]!;
    if (dayOfWord(token)) break;
    if (DASHES.has(token)) dash = true;
    else if (LIST_CONNECTORS.has(token)) sawList = true;
    else if (token === 'до' || token === 'по') to = to ?? token;
    else if (!PREPOSITIONS.has(token)) return null;
    k++;
    count++;
  }
  if (k >= tokens.length || !dayOfWord(tokens[k]!) || count === 0) return null;
  if (dash && !sawList && to === null && count === 1) return { link: 'range', next: k };
  // «по» между днями — диапазон только вслед за «с»: «с понедельника по среду», но не «пн по средам».
  const opened = tokens[leftStart - 1] === 'с' || tokens[leftStart - 1] === 'со';
  if (count === 1 && ((to === 'по' && opened) || to === 'до')) return { link: 'range', next: k };
  return { link: 'list', next: k };
}

/** Дни от `from` до `to` включительно, через воскресенье («пт-пн» — Пт, Сб, Вс, Пн). */
function between(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let i = dayIndex(from); ; i = (i + 1) % 7) {
    out.push(WEEK[i]!);
    if (i === dayIndex(to)) break;
  }
  return out;
}

interface Item { days: readonly Day[]; named: boolean }

/** Звенья серии → дни: цепочка из двух названных дней через тире — диапазон, всё остальное — перечисление. */
function resolveSeries(items: readonly Item[], links: readonly Link[]): Day[] {
  const out: Day[] = [];
  let chain: Item[] = [items[0]!];
  const flush = (): void => {
    if (chain.length === 2 && chain.every((x) => x.named)) out.push(...between(chain[0]!.days[0]!, chain[1]!.days[0]!));
    else for (const item of chain) out.push(...item.days);
  };
  for (let k = 0; k < links.length; k++) {
    if (links[k] === 'range') chain.push(items[k + 1]!);
    else {
      flush();
      chain = [items[k + 1]!];
    }
  }
  flush();
  return out;
}

export interface DaysOfText {
  /** Дни, которые подходят, по порядку недели; нежелательные из них убраны. */
  days: Day[];
  /** Дни, которые названы как неподходящие («кроме воскресенья», «вторник не могу»). */
  avoid: Day[];
}

/**
 * Дни недели из текста. Пусто — «не знаем» (или «любой день»: ограничения нет, и это не то же самое, что
 * «подходят все семь»). Неоднозначное не додумывается: «сб/вс» — два дня, «пн-ср» — три, «пн-ср-пт» — три без вторника.
 */
export function classifyDays(raw: string | null | undefined): DaysOfText {
  const tokens = tokenize(raw);
  const wanted = new Set<Day>();
  const avoided = new Set<Day>();

  let i = 0;
  while (i < tokens.length) {
    const first = dayOfWord(tokens[i]!);
    if (!first) {
      i++;
      continue;
    }
    const items: Item[] = [first];
    const links: Link[] = [];
    let last = i;
    for (;;) {
      const link = connector(tokens, last + 1, last);
      if (!link) break;
      items.push(dayOfWord(tokens[link.next]!)!);
      links.push(link.link);
      last = link.next;
    }

    const trailing = tokens[last + 1] === 'не' && TRAILING_VERBS.has(tokens[last + 2] ?? '');
    const target = trailing || negatedBefore(tokens, i) ? avoided : wanted;
    for (const day of resolveSeries(items, links)) target.add(day);
    i = last + 1;
  }

  const ordered = (set: ReadonlySet<Day>): Day[] => WEEK.filter((d) => set.has(d));
  return { days: ordered(wanted).filter((d) => !avoided.has(d)), avoid: ordered(avoided) };
}
