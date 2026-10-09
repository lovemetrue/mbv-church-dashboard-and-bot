import { suggestGroups, type MatchOptions, type Suggestion } from '../core/matching.js';
import type { DashboardGroup } from '../db/repos/groups.repo.js';
import { CLOSED_STATUSES, type DashboardRequest } from '../db/repos/requests.repo.js';

export type RequestWithSuggestions = DashboardRequest & { suggestions: Suggestion[] };

/**
 * К каждой открытой заявке «хочу в группу» добавляет подобранные группы.
 *
 * Считаем на сервере, а не в странице: правила подбора проверяются тестами без браузера, а
 * данные в страницу и так вшиваются целиком (см. withLive). Остальным заявкам кладём пустой
 * список, чтобы странице не надо было различать «нет подсказок» и «поля нет».
 */
export function withSuggestions(
  requests: readonly DashboardRequest[],
  groups: readonly DashboardGroup[],
  opts: MatchOptions,
): RequestWithSuggestions[] {
  return requests.map((r) => ({
    ...r,
    suggestions:
      r.type === 'join_group' && !CLOSED_STATUSES.includes(r.status)
        ? suggestGroups({ age: r.age, place: r.place }, groups, opts)
        : [],
  }));
}
