import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CampaignView } from '@contracts';
import { ApiError, apiGet } from '../../shared/api/client';

export const CAMPAIGN_KEY = ['campaign'] as const;

/** Раз в минуту, как остальные сводки: руководитель держит экран открытым и смотрит, как идёт рассылка. */
export const CAMPAIGN_REFRESH_MS = 60_000;

/**
 * Статистика кампании «40 дней». Хук свой, а не в общем `shared/api/queries`: экран кампании самостоятельный,
 * и читают его только из «Команды». 404 значит «расписание не задано» — это обычное состояние, а не сбой,
 * поэтому его не повторяем (как и остальные 4xx).
 */
export function useCampaign(): UseQueryResult<CampaignView> {
  return useQuery({
    queryKey: CAMPAIGN_KEY,
    queryFn: ({ signal }) => apiGet<CampaignView>('campaign', signal),
    refetchInterval: CAMPAIGN_REFRESH_MS,
    // В скрытой вкладке опрос стоит; по возвращении данные подтянет refetchOnWindowFocus.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
  });
}

/** Расписание кампании не задано: сервер отвечает 404. */
export const isNotConfigured = (error: unknown): boolean => error instanceof ApiError && error.status === 404;
