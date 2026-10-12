import type { NoPlan, StrangeMark } from '@contracts';
import { ru } from '../shared/i18n/ru';

/** Поле таблицы «Люди», по которому отбирают «Странные». */
export const STRANGE_FIELD = ru.strange.field;

/** Длина заметки к метке по контракту. */
export const STRANGE_NOTE_MAX = 300;

/**
 * Дата метки «ДД.ММ.ГГГГ» по часам устройства. Метка — момент времени (ISO с часовым поясом), а не календарная дата,
 * поэтому, в отличие от `formatDateFull`, день берём по местному времени: иначе поставленная ночью метка показала бы вчера.
 */
export function formatMarkDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Подсказка и подпись значка. Формулировка без указания пола: «Отметка: Анна, 09.10.2026». */
export function strangeText(mark: StrangeMark): string {
  const note = mark.note?.trim();
  return ru.strange.markText(mark.by, formatMarkDate(mark.at), note ? note : null);
}

/** Сервер исключил заявку из автоматического подбора из-за метки: предложения группы у неё быть не должно. */
export const isStrangeHold = (r: { noPlan: NoPlan | null }): boolean => r.noPlan?.code === 'strange';

export const countStrange = (items: readonly { strange: StrangeMark | null }[]): number => items.filter((i) => i.strange !== null).length;

/** Строка «Отметка: Анна, 09.10.2026.» для плашки в карточке: заметка там стоит отдельным абзацем. */
export const strangeMetaText = (mark: StrangeMark): string => ru.strange.bannerMark(mark.by, formatMarkDate(mark.at));
