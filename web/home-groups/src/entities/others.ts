import type { OtherItem } from '@contracts';

/**
 * Режим списка на экране «Заявки»: «Хотят в группу» (то, что идёт в подбор) и по вкладке на каждый вид обращения.
 * Это не вкладка верхнего уровня, а переключатель внутри экрана, поэтому живёт в адресе параметром `view`.
 *
 *   leads      — хотят открыть группу: будущие потенциальные группы (ответ «готов открыть» и заявки без ответа из таблицы)
 *   homes      — дают дом: ищут ведущего
 *   questions  — вопросы
 *   members    — уже состоят в группе
 *   leaders    — уже ведут группу
 *   cancelled  — аннулированные «хочу в группу», чтобы вернуть в работу
 */
export const OTHER_VIEWS = ['leads', 'homes', 'questions', 'members', 'leaders', 'cancelled'] as const;
export type OtherView = (typeof OTHER_VIEWS)[number];
export type RequestsView = 'wait' | OtherView;

export function parseView(v: string | null): RequestsView {
  // «others» — прежний общий режим «Другие обращения»: старые ссылки ведут в вопросы.
  if (v === 'others') return 'questions';
  return (OTHER_VIEWS as readonly string[]).includes(v ?? '') ? (v as OtherView) : 'wait';
}

/**
 * Вкладка обращения. «Открыть группу» и «дать дом» — одна заявка `lead_group`, различает их ответ анкеты (`offer`):
 * человек без ответа хочет открыть группу, значит, будет вести.
 */
export function viewOf(o: Pick<OtherItem, 'type' | 'offer'>): OtherView {
  switch (o.type) {
    case 'lead_group': return o.offer === 'home' ? 'homes' : 'leads';
    case 'question': return 'questions';
    case 'already_member': return 'members';
    case 'already_leader': return 'leaders';
    default: return 'cancelled';
  }
}

/** «Хотят открыть группу» и «Дают дом» — рабочее место координатора. */
export const isLead = (o: Pick<OtherItem, 'type'>): boolean => o.type === 'lead_group';
export const isLeadView = (v: RequestsView): boolean => v === 'leads' || v === 'homes';

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
