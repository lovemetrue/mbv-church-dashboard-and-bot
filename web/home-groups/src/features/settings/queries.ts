import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ActivatePromptBody,
  SavePromptBody,
  SettingsAuditView,
  SettingsErrorsView,
  SettingsHealthView,
  SettingsPromptsView,
} from '@contracts';
import { ApiError, apiGet, apiPost } from '../../shared/api/client';

/*
 * Данные раздела «Настройки». Раздел не зависит от внутренностей других экранов: берёт только
 * общий клиент API (shared/api/client), поэтому переедет в «витрину» платформы вместе с папкой.
 */

/** Состояние сервера перечитывается само раз в полминуты, пока раздел открыт. */
export const HEALTH_REFRESH_MS = 30_000;
/** Инструкции — раз в минуту, как остальные данные: на случай, если их сохранили с другого устройства. */
export const PROMPTS_REFRESH_MS = 60_000;

export const settingsKeys = {
  health: ['settings', 'health'],
  errors: ['settings', 'errors'],
  audit: ['settings', 'audit'],
  prompts: ['settings', 'prompts'],
} as const;

const common = {
  // Журналы и состояние нужны свежими: при каждом открытии раздела читаем заново.
  staleTime: 0,
  refetchOnWindowFocus: true,
  // Повторять имеет смысл только сбои сети и 5xx; 401/403/404 от повтора не изменятся.
  retry: (count: number, error: Error) =>
    count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
} as const;

export function useSettingsHealth(): UseQueryResult<SettingsHealthView> {
  return useQuery({
    queryKey: settingsKeys.health,
    queryFn: ({ signal }) => apiGet<SettingsHealthView>('settings/health', signal),
    ...common,
    refetchInterval: HEALTH_REFRESH_MS,
    // Явно: в скрытой вкладке браузера опрос стоит, зря нагружать сервер незачем.
    refetchIntervalInBackground: false,
  });
}

export function useSettingsErrors(): UseQueryResult<SettingsErrorsView> {
  return useQuery({
    queryKey: settingsKeys.errors,
    queryFn: ({ signal }) => apiGet<SettingsErrorsView>('settings/errors', signal),
    ...common,
  });
}

export function useSettingsAudit(): UseQueryResult<SettingsAuditView> {
  return useQuery({
    queryKey: settingsKeys.audit,
    queryFn: ({ signal }) => apiGet<SettingsAuditView>('settings/audit', signal),
    ...common,
  });
}

export function useSettingsPrompts(): UseQueryResult<SettingsPromptsView> {
  return useQuery({
    queryKey: settingsKeys.prompts,
    queryFn: ({ signal }) => apiGet<SettingsPromptsView>('settings/prompts', signal),
    ...common,
    refetchInterval: PROMPTS_REFRESH_MS,
  });
}

/**
 * Действия над инструкциями. Каждое после успеха ждёт перечитывания списка: пока экран
 * показывает старый текст, считать правку принятой рано. Ошибку не глотаем — её показывает
 * тот, кто вызвал (рядом с блоком или в окне отката).
 */
export function usePromptActions() {
  const queryClient = useQueryClient();
  const reread = () => queryClient.invalidateQueries({ queryKey: settingsKeys.prompts });
  return {
    async save(body: SavePromptBody): Promise<void> {
      await apiPost('settings/prompts/save', body);
      await reread();
    },
    async activate(body: ActivatePromptBody): Promise<void> {
      await apiPost('settings/prompts/activate', body);
      await reread();
    },
  };
}
