import type { MemberAddBody, PersonItem } from '@contracts';
import { phoneDigits } from '../../../entities/format';
import type { ContactName } from '../../contact/contactSpec';

/** Сколько людей показывать в списке выбора сразу: длиннее список на телефоне не пролистать, а поиск сузит его. */
export const SEARCH_LIMIT = 50;

/** Для сравнения имён: без регистра, «ё» как «е» (в паспорте и в анкете её пишут по-разному), пробелы схлопнуты. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Совпал ли человек с запросом. Имя: все слова запроса есть в ФИО в любом порядке («ефимова дарья»).
 * Телефон: цифры запроса есть в цифрах номера, но не меньше трёх, иначе «12» находил бы половину справочника.
 * Номер, набранный с «8», сравниваем и как «7»: в справочнике он хранится в международном виде.
 */
function matches(p: PersonItem, query: string): boolean {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const fio = normalizeText(p.fio);
  if (words.every((w) => fio.includes(w))) return true;
  const digits = phoneDigits(query);
  if (digits.length < 3) return false;
  const phone = phoneDigits(p.phone);
  return phone.includes(digits) || phone.includes(digits.replace(/^8/, '7'));
}

export interface SearchResult {
  items: PersonItem[];
  /** Сколько нашлось всего, до обрезки: по нему видно, что показаны не все. */
  total: number;
}

export function searchPeople(people: readonly PersonItem[], query: string, limit = SEARCH_LIMIT): SearchResult {
  const found = people.filter((p) => matches(p, query));
  return { items: found.slice(0, limit), total: found.length };
}

/** Что собрано в окне «Добавить человека»; строки как в полях. */
export type AddForm =
  | { mode: 'directory'; personKey: string | null; joinedOn: string; note: string }
  | { mode: 'new'; person: Record<ContactName, string>; joinedOn: string; note: string };

const clean = (s: string): string | undefined => {
  const t = s.trim();
  return t === '' ? undefined : t;
};

/**
 * Тело запроса. Сервер принимает ЛИБО `personKey`, ЛИБО `newPerson`: оба сразу он отклонит, поэтому
 * второго ключа в теле нет вовсе, а не «пустой». Пустые поля не отправляем: для сервера они были бы «очистить».
 * null — отправлять нечего (человек не выбран или не вписано ФИО).
 */
export function buildAddBody(form: AddForm): MemberAddBody | null {
  const joinedOn = clean(form.joinedOn);
  const note = clean(form.note);
  const common: MemberAddBody = { ...(joinedOn ? { joinedOn } : {}), ...(note ? { note } : {}) };
  if (form.mode === 'directory') {
    return form.personKey ? { personKey: form.personKey, ...common } : null;
  }
  const fio = clean(form.person.fio);
  if (!fio) return null;
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(form.person)) {
    const t = k === 'fio' ? undefined : clean(v);
    if (t) extra[k] = t;
  }
  return { newPerson: { fio, ...extra }, ...common };
}

/** Сегодня по местному времени служителя («2026-10-11»): `toISOString` вернул бы дату по UTC, и вечером день сдвинулся бы. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** ISO-даты сравниваются как строки. Пустая дата — не из будущего: она просто не задана. */
export function isFutureDate(iso: string, today: string): boolean {
  return iso !== '' && iso > today;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function parts(iso: string | null | undefined): { y: string; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { y: m[1]!, m: month, d: Number(m[3]) } : null;
}

/** «9 октября». Разбираем строку, а не `Date`: `new Date('2026-10-09')` — полночь по UTC, и в минусовых поясах день уезжает. */
export function formatDayMonth(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : '';
}

/** «1 сентября 2026». */
export function formatDayMonthYear(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : '';
}
