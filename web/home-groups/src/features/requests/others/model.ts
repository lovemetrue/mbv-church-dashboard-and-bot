import type { OtherItem } from '@contracts';
import type { OtherFilter, ReconcileFilter } from '../../../entities/others';
import { hasAllWords, matchesSearch } from '../model';

/**
 * Поиск по обращениям: те же поля, что у заявок (ФИО, место, ответственный, заметка, телефон по цифрам),
 * плюс тип обращения («вопрос» находит вопросы служителю) и суть: человека часто ищут по тому, что он написал.
 */
export function matchesOtherSearch(o: OtherItem, query: string): boolean {
  if (!query.trim()) return true;
  return matchesSearch(o, query) || hasAllWords(o.typeLabel, query) || hasAllWords(o.gist, query);
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

/** Группа отбора по разбору: «все» сюда не входит, это отсутствие отбора. */
export type ReconcileGroup = Exclude<ReconcileFilter, 'all'>;

/**
 * В какую группу отбора попадает обращение. none и noleader в одной группе: в обоих случаях группу придётся искать
 * руками. nouser и обращения без разбора (вопросы, «хочу открыть») — «остальные»: разбирать по справочникам нечего.
 * `?.` нужен не для типов: сервер старой версии не присылает `reconcile`, и экран не должен падать.
 */
export function reconcileGroupOf(o: OtherItem): ReconcileGroup {
  switch (o.reconcile?.status) {
    case 'ready':
      return 'ready';
    case 'choose':
      return 'choose';
    case 'none':
    case 'noleader':
      return 'missing';
    default:
      return 'rest';
  }
}

export interface ReconcileCounts extends Record<ReconcileFilter, number> {}

/** Числа на чипах второй строки: считаются по открытым из найденного (поиск и «В работе у»), закрытые не входят. */
export function countReconcile(items: readonly OtherItem[]): ReconcileCounts {
  const c: ReconcileCounts = { all: 0, ready: 0, choose: 0, missing: 0, rest: 0 };
  for (const o of items) {
    if (o.state !== 'open') continue;
    c.all++;
    c[reconcileGroupOf(o)]++;
  }
  return c;
}

export function filterByReconcile(items: readonly OtherItem[], filter: ReconcileFilter): OtherItem[] {
  return filter === 'all' ? [...items] : items.filter((o) => reconcileGroupOf(o) === filter);
}

/** Сколько обращений можно отправить на «Разобрать все готовые» за раз: больше сервер не примет (100 × 5). */
export const READY_BULK_LIMIT = 500;

/**
 * Номера для массового разбора. Берутся только из переданного списка, то есть из того, что человек видит:
 * «все готовые» — это не «все готовые в базе», иначе кнопка тронула бы то, чего на экране нет.
 */
export interface ReadyToReconcile {
  ids: number[];
  /** Сколько готовых в списке всего; ids может быть короче, если их больше предела. */
  total: number;
  capped: boolean;
}

export function readyToReconcile(items: readonly OtherItem[], limit: number = READY_BULK_LIMIT): ReadyToReconcile {
  const ready = items.filter((o) => o.state === 'open' && o.reconcile?.status === 'ready').map((o) => o.id);
  return { ids: ready.slice(0, limit), total: ready.length, capped: ready.length > limit };
}
