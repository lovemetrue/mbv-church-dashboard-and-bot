import type { OtherItem } from '@contracts';
import type { OtherFilter } from '../../../entities/others';
import { matchesSearch } from '../model';

/**
 * Поиск по обращениям: те же поля, что у заявок (ФИО, место, ответственный, заметка, телефон по цифрам),
 * плюс тип обращения — «вопрос» находит вопросы служителю.
 */
export function matchesOtherSearch(o: OtherItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return matchesSearch(o, query) || o.typeLabel.toLowerCase().includes(q);
}

export interface OtherCounts {
  open: number;
  done: number;
  cancelled: number;
  all: number;
}

/** Счётчики чипов считаются по найденному (поиск и «В работе у»), как у заявок. */
export function countOthers(items: readonly OtherItem[]): OtherCounts {
  const c: OtherCounts = { open: 0, done: 0, cancelled: 0, all: items.length };
  for (const o of items) c[o.state]++;
  return c;
}

/** Порядок сервера сохраняем: открытые сверху (сначала «перезвонить»), закрытые — свежие первыми. */
export function filterOthers(items: readonly OtherItem[], filter: OtherFilter): OtherItem[] {
  return filter === 'all' ? [...items] : items.filter((o) => o.state === filter);
}

/** Сколько обращений открыто всего: число на переключателе не зависит ни от поиска, ни от отбора. */
export const openOthersCount = (items: readonly OtherItem[]): number => items.filter((o) => o.state === 'open').length;
