import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { KitFindOk, KitIssueOk, KitsView } from '@contracts';
import { ApiError, apiGet, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';

export const KITS_KEY = ['kits'] as const;

/**
 * Счётчики и последние выдачи. Обновляются чаще общих сводок: наборы выдают за несколько столов сразу,
 * и каждому координатору полезно видеть общий счёт почти вживую.
 */
export function useKits(): UseQueryResult<KitsView> {
  return useQuery({
    queryKey: KITS_KEY,
    queryFn: ({ signal }) => apiGet<KitsView>('kits', signal),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
}

/** Найти участника по тексту из QR или номеру: разбирает сервер (виды QR знает он). Ничего не меняет. */
export function useFindKit(): UseMutationResult<KitFindOk, Error, string> {
  return useMutation({ mutationFn: (code: string) => apiPost<KitFindOk>('kits/find', { code }) });
}

/** Выдать или отменить выдачу. После — свежие счётчики и справочник людей (там колонка «Набор»). */
export function useKitAction(action: 'issue' | 'undo'): UseMutationResult<KitIssueOk, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => apiPost<KitIssueOk>(`kits/${action}`, { userId }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: KITS_KEY }),
        queryClient.invalidateQueries({ queryKey: queryKeys.people }),
      ]),
  });
}
