import type { OtherItem } from '@contracts';

/**
 * Режим списка на экране «Заявки»: «Хотят в группу» (то, что идёт в подбор) или «Другие обращения»
 * (всё остальное: готов открыть группу, вопрос, аннулированные). Это не вкладка, а переключатель
 * внутри экрана, поэтому живёт в адресе параметром `view`.
 */
export type RequestsView = 'wait' | 'others';

export function parseView(v: string | null): RequestsView {
  return v === 'others' ? 'others' : 'wait';
}

/** Чипы над списком обращений. «Открытые» — по умолчанию: закрытые нужны, только чтобы вернуть в работу. */
export type OtherFilter = 'open' | 'done' | 'cancelled' | 'all';
export const OTHER_FILTERS: readonly OtherFilter[] = ['open', 'done', 'cancelled', 'all'];

export function parseOtherFilter(v: string | null): OtherFilter {
  return (OTHER_FILTERS as readonly string[]).includes(v ?? '') ? (v as OtherFilter) : 'open';
}

export type OtherState = OtherItem['state'];

/**
 * Отбор открытых обращений по тому, что сервер нашёл в справочниках («разбор»). Это вторая строка чипов под
 * «Открытыми», а не вкладка: живёт в адресе параметром `orec`, без параметра — «Все открытые».
 *
 *   ready    — найдена одна группа, достаточно подтвердить
 *   choose   — нужно выбрать из найденных
 *   missing  — группы нет в справочнике (none) или ведущий не указан (noleader)
 *   rest     — разбирать нечего: вопросы, «хочу открыть», обращения без регистрации человека (nouser)
 */
export type ReconcileFilter = 'all' | 'ready' | 'choose' | 'missing' | 'rest';
export const RECONCILE_FILTERS: readonly ReconcileFilter[] = ['all', 'ready', 'choose', 'missing', 'rest'];

export function parseReconcileFilter(v: string | null): ReconcileFilter {
  return (RECONCILE_FILTERS as readonly string[]).includes(v ?? '') ? (v as ReconcileFilter) : 'all';
}
