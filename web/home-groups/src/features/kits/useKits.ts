import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { KitFindOk, KitIssueOk, KitSearchOk, KitsIssuedView, KitsView } from '@contracts';
import { ApiError, apiGet, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';
import { CAMPAIGN_KEY } from '../campaign/useCampaign';

export const KITS_KEY = ['kits'] as const;
/** Под `KITS_KEY`: любая выдача или отмена обновляет и счётчики, и этот список разом. */
export const KITS_ISSUED_KEY = ['kits', 'issued'] as const;

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

/**
 * Все, кому выдан набор (окно из «Команды → Кампания»). Грузится, только пока окно открыто, и не опрашивается:
 * список нужен для сверки, а не для живого счёта.
 */
export function useKitsIssued(): UseQueryResult<KitsIssuedView> {
  return useQuery({
    queryKey: KITS_ISSUED_KEY,
    queryFn: ({ signal }) => apiGet<KitsIssuedView>('kits/issued', signal),
    staleTime: 5_000,
    retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
}

/** Найти участника по номеру регистрации: разбирает сервер. Ничего не меняет. */
export function useFindKit(): UseMutationResult<KitFindOk, Error, string> {
  return useMutation({ mutationFn: (code: string) => apiPost<KitFindOk>('kits/find', { code }) });
}

/** Поиск по ФИО (на сервере: слова в любом порядке, «ё» как «е»). Ничего не меняет. */
export function useSearchKits(): UseMutationResult<KitSearchOk, Error, string> {
  return useMutation({ mutationFn: (query: string) => apiPost<KitSearchOk>('kits/search', { query }) });
}

/** Выдать или отменить выдачу. После — свежие счётчики, список выданных, кампания и справочник людей (там колонка «Набор»). */
export function useKitAction(action: 'issue' | 'undo'): UseMutationResult<KitIssueOk, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => apiPost<KitIssueOk>(`kits/${action}`, { userId }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: KITS_KEY }),
        queryClient.invalidateQueries({ queryKey: queryKeys.people }),
        // Плитка «Наборов выдано» в кампании считает те же отметки.
        queryClient.invalidateQueries({ queryKey: CAMPAIGN_KEY }),
      ]),
  });
}
