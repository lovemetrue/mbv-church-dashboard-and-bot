/**
 * Склонение по числу: plural(2, ['заявка', 'заявки', 'заявок']) → «заявки».
 * Правило русского языка: 11–14 всегда «много», дальше смотрим на последнюю цифру.
 */
export function pluralForm(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** «5 заявок» — число вместе со словом. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${pluralForm(n, forms)}`;
}

export const FORMS = {
  request: ['заявка', 'заявки', 'заявок'],
  person: ['человек', 'человека', 'человек'],
  day: ['день', 'дня', 'дней'],
} as const satisfies Record<string, readonly [string, string, string]>;
