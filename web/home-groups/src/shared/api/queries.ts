import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type {
  GroupFitView,
  BulkBody,
  BulkOk,
  CoordinatorsView,
  GroupsView,
  Me,
  PeopleView,
  RequestsView,
  TeamView,
  TodayView,
} from '@contracts';
import { ApiError, apiGet, apiPost } from './client';

/** Раз в минуту данные обновляются сами; плюс при возврате на вкладку браузера. */
export const REFRESH_MS = 60_000;

const common = {
  refetchOnWindowFocus: true,
  refetchInterval: REFRESH_MS,
  // Бот принимает заявки постоянно, поэтому опрос нужен, но в скрытой вкладке он лишь гоняет
  // запросы впустую: по возвращении данные подтянет refetchOnWindowFocus. Значение по умолчанию
  // совпадает, но здесь оно записано явно, чтобы случайная правка не включила опрос в фоне.
  refetchIntervalInBackground: false,
  staleTime: 15_000,
  // Повторять имеет смысл только сбои сети и 5xx; 401/403/404 от повтора не изменятся.
  retry: (count: number, error: Error) =>
    count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
} as const;

export const queryKeys = {
  me: ['me'],
  today: ['today'],
  requests: ['requests'],
  groups: ['groups'],
  people: ['people'],
  coordinators: ['coordinators'],
  team: ['team'],
} as const;

export function useMe(): UseQueryResult<Me> {
  return useQuery({ queryKey: queryKeys.me, queryFn: ({ signal }) => apiGet<Me>('me', signal), ...common });
}
export function useToday(): UseQueryResult<TodayView> {
  return useQuery({ queryKey: queryKeys.today, queryFn: ({ signal }) => apiGet<TodayView>('today', signal), ...common });
}
export function useRequests(): UseQueryResult<RequestsView> {
  return useQuery({
    queryKey: queryKeys.requests,
    queryFn: ({ signal }) => apiGet<RequestsView>('requests', signal),
    ...common,
  });
}
export function useGroups(): UseQueryResult<GroupsView> {
  return useQuery({ queryKey: queryKeys.groups, queryFn: ({ signal }) => apiGet<GroupsView>('groups', signal), ...common });
}
/** Уверенность по каждой группе для окна «Другая группа»: считается по запросу, только пока окно открыто. */
export function useGroupFit(requestId: number): UseQueryResult<GroupFitView> {
  return useQuery({ queryKey: ['group-fit', requestId], queryFn: ({ signal }) => apiGet<GroupFitView>(`requests/${requestId}/fit`, signal), ...common });
}
export function usePeople(): UseQueryResult<PeopleView> {
  return useQuery({ queryKey: queryKeys.people, queryFn: ({ signal }) => apiGet<PeopleView>('people', signal), ...common });
}
export function useCoordinators(): UseQueryResult<CoordinatorsView> {
  return useQuery({
    queryKey: queryKeys.coordinators,
    queryFn: ({ signal }) => apiGet<CoordinatorsView>('coordinators', signal),
    ...common,
  });
}

/** Сводка «Команды»: опрос раз в минуту, как у «Заявок», — руководитель держит вкладку открытой. */
export function useTeam(): UseQueryResult<TeamView> {
  return useQuery({ queryKey: queryKeys.team, queryFn: ({ signal }) => apiGet<TeamView>('team', signal), ...common });
}

/**
 * Массовое действие над заявками. После успеха перечитываем всё, что считается из заявок
 * (список, «Сегодня», «Команду») и ждём этого: пока экран показывает старые числа, итог «Готово» врал бы.
 * Повторов нет: действие не идемпотентно с точки зрения человека (apiPost их и не делает).
 */
export function useBulkRequests(): UseMutationResult<BulkOk, Error, BulkBody> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkBody) => apiPost<BulkOk>('requests/bulk', body),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today }),
        queryClient.invalidateQueries({ queryKey: queryKeys.team }),
      ]),
  });
}
