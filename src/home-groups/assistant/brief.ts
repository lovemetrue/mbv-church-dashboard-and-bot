import { createHash } from 'node:crypto';

/**
 * Что уходит помощнику и как это проверяется. Правило одно: из записи человека модель получает только возрастную
 * категорию, место и удобное время (как человек их написал). Имён, телефонов, почт и адресов у неё нет, а в самом тексте
 * мест и времени всё, что похоже на номер, почту или ссылку, вырезается — люди иногда пишут туда лишнее.
 */
export interface RawBrief {
  place: string | null;
  age: string | null;
  schedule: string | null;
}

const MAX_FIELD = 120;

/** Вырезает из текста номера телефонов, почты, ссылки и @ники; длинные цифры тоже (id, документы). */
export function scrub(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/(^|\s)@[\w.]+/g, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned.slice(0, MAX_FIELD);
}

/** Отпечаток записи, по которой сделан разбор: изменилась запись — разбор не применяется. */
export function baseHash(b: RawBrief): string {
  const norm = (v: string | null) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha1').update(JSON.stringify([norm(b.place), norm(b.age), norm(b.schedule)])).digest('hex').slice(0, 16);
}

/** Чего скрипт не понял в записи, хотя текст есть: только это имеет смысл отдавать помощнику. */
export interface Needs { district: boolean; age: boolean; time: boolean }

export function needsOf(
  b: RawBrief,
  parsed: { district: string | null; ageKnown: boolean; whenKnown: boolean },
): Needs {
  return {
    district: scrub(b.place) !== null && parsed.district === null,
    age: scrub(b.age) !== null && !parsed.ageKnown,
    time: scrub(b.schedule) !== null && !parsed.whenKnown,
  };
}

/**
 * Что скрипт уже определил по записи: район, понят ли возраст, дни недели и время суток (в том числе названные
 * неподходящими: «кроме воскресенья»). Только значения из справочников, никакого текста человека — поэтому это
 * можно отдавать модели как есть. Она должна опираться на это и не разбирать то же самое заново.
 */
export interface ScriptFacts {
  district: string | null;
  ageKnown: boolean;
  days: string[];
  slot: string | null;
  avoidDays: string[];
  avoidSlots: string[];
}

export function scriptFactsOf(parsed: {
  district: string | null;
  ageKnown: boolean;
  when: { days: readonly string[]; slot: string | null; avoidDays: readonly string[]; avoidSlots: readonly string[] };
}): ScriptFacts {
  return {
    district: parsed.district,
    ageKnown: parsed.ageKnown,
    days: [...parsed.when.days],
    slot: parsed.when.slot,
    avoidDays: [...parsed.when.avoidDays],
    avoidSlots: [...parsed.when.avoidSlots],
  };
}

/** Запись для помощника: сам текст, что из него непонятно скрипту, и что скрипт уже знает. */
export interface AssistantCandidate {
  id: number;
  brief: RawBrief;
  needs: Needs;
  script: ScriptFacts;
}

export const anyNeed = (n: Needs): boolean => n.district || n.age || n.time;
