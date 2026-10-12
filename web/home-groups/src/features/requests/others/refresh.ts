import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api/queries';

/**
 * Что перечитать после разбора обращения. Те же ключи, что у закрытия обращения (`useRequestWork`): заявки, «Сегодня»,
 * группы и «Команда». Разбор к тому же меняет составы и ведущих, поэтому добавлены «Люди»: у человека в списке групп
 * появляется новая. Ждём перечитывания: пока экран показывает старое, итог «Разобрано» врал бы.
 */
export function refreshAfterReconcile(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
    queryClient.invalidateQueries({ queryKey: queryKeys.today }),
    queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    queryClient.invalidateQueries({ queryKey: queryKeys.people }),
    queryClient.invalidateQueries({ queryKey: queryKeys.team }),
  ]);
}
