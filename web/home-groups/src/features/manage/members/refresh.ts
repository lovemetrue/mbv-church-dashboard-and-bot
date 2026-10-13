import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useManageAction } from '../useManage';

/**
 * После любой правки состава или карточки человека перечитываются группы (состав живёт в них) и люди
 * («Состоит в группах», имя и телефон). «Команда», «Кампания» и заявки от этого не меняются.
 */
export function refreshAfterMembers(client: QueryClient): Promise<unknown> {
  return Promise.all([queryKeys.groups, queryKeys.people].map((queryKey) => client.invalidateQueries({ queryKey })));
}

/** Контакты человека лежат и в заявках, и от них зависит подбор: перечитывается всё, что их показывает. */
export function refreshAfterContact(client: QueryClient): Promise<unknown> {
  return Promise.all([queryKeys.groups, queryKeys.people, queryKeys.requests, queryKeys.today].map((queryKey) => client.invalidateQueries({ queryKey })));
}

/** 409 здесь значит одно: человек уже в составе. Общий разбор сказал бы «Не получилось». */
export function explainMemberError(e: unknown): string | null {
  return e instanceof ApiError && (e.status === 409 || e.code === 'conflict') ? ru.members.errors.conflict : null;
}

/** Действие над составом или карточкой: отсечка повторного нажатия, текст ошибки и перечитывание — как у остальных правок справочника. */
export function useMemberAction() {
  return useManageAction(refreshAfterMembers, explainMemberError);
}
