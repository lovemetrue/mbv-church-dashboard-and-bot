import { ru } from '../i18n/ru';
import { RESP_ALL, RESP_MINE, RESP_NOBODY } from '../nav/params';
import type { ViewScope } from './model';

const BUCKET_TEXT: Record<string, string> = {
  queue: ru.requests.queueChip,
  strange: ru.strange.chip,
  ready: 'Готово к утверждению',
  callback: 'Перезвонить',
  human: 'Нужна помощь в сопоставлении',
  done: 'Утверждено',
};

const ENTITY_TEXT: Record<string, string> = {
  groups: ru.reference.groups,
  people: ru.reference.people,
  coordinators: ru.reference.coordinators,
};

/** Краткое описание вида для списка: чтобы два вида с похожими именами можно было различить, а сохранённый поиск не был скрытым. */
export function describeView(scope: ViewScope, query: string): string {
  const q = new URLSearchParams(query);
  const parts: string[] = [];
  if (scope === 'requests') {
    parts.push(BUCKET_TEXT[q.get('bucket') ?? ''] ?? 'Все');
    const resp = q.get('resp');
    if (resp && resp !== RESP_ALL) {
      parts.push(resp === RESP_NOBODY ? ru.savedViews.summary.respNobody : resp === RESP_MINE ? ru.requests.respFilterMine : ru.savedViews.summary.resp(resp));
    }
    const filters = q.getAll('f').length;
    if (filters) parts.push(ru.savedViews.summary.filters(filters));
    const text = q.get('q');
    if (text) parts.push(ru.savedViews.summary.search(text));
  } else {
    parts.push(ENTITY_TEXT[q.get('ent') ?? ''] ?? ru.reference.groups);
    const filters = q.getAll('f').length;
    if (filters) parts.push(ru.savedViews.summary.filters(filters));
    const gb = q.get('gb');
    if (gb) parts.push(ru.savedViews.summary.group(gb));
    const sort = q.get('sort');
    if (sort) parts.push(ru.savedViews.summary.sort(sort.slice(0, sort.lastIndexOf(':')) || sort));
  }
  return parts.join(' · ');
}
