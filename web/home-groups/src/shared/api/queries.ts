import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  CoordinatorsView,
  GroupsView,
  Me,
  PeopleView,
  RequestsView,
  TodayView,
} from '@contracts';
import { ApiError, apiGet } from './client';

/** Раз в минуту данные обновляются сами; плюс при возврате на вкладку браузера. */
export const REFRESH_MS = 60_000;

const common = {
  refetchOnWindowFocus: true,
  refetchInterval: REFRESH_MS,
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
