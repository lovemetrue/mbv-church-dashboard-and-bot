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
