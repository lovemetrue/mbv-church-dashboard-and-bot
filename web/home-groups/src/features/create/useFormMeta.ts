import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FormMeta } from '@contracts';
import { ApiError, apiGet } from '../../shared/api/client';

export const FORM_META_KEY = ['formMeta'] as const;

/**
 * Справочники форм «Создать». Грузятся при первом открытии формы, а не вместе со страницей:
 * большинство входов форму не открывает. Списки меняются разве что при новой версии бота,
 * поэтому держим их долго и не перечитываем по возвращении на вкладку.
 */
export function useFormMeta(): UseQueryResult<FormMeta> {
  return useQuery({
    queryKey: FORM_META_KEY,
    queryFn: ({ signal }) => apiGet<FormMeta>('form-meta', signal),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    // Как в остальных чтениях: повторять имеет смысл сбои сети и 5xx, а 4xx от повтора не изменится.
    retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
}
