/** Сколько заявок сервер обработает за один запрос (`BULK_LIMIT` в `src/home-groups/actions.ts`). */
export const BULK_LIMIT = 100;

/**
 * Первые `limit` номеров по порядку списка. `capped` — видимых оказалось больше, чем можно
 * выбрать: человеку об этом надо сказать, иначе он решит, что действие применено ко всем.
 */
export function pickFirst(ids: readonly number[], limit: number = BULK_LIMIT): { ids: number[]; capped: boolean } {
  return { ids: ids.slice(0, limit), capped: ids.length > limit };
}
