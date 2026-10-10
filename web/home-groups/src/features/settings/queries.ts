import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ActivatePromptBody,
  ActionOk,
  CreateStaffBody,
  DeliveryOk,
  PersonalModeBody,
  SavePromptBody,
  SettingsAuditView,
  SettingsErrorsView,
  SettingsHealthView,
  SettingsPromptsView,
  SettingsStaffView,
  StaffIdBody,
  SuggestLoginBody,
  SuggestLoginOk,
  UpdateStaffBody,
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
/** Пользователи — раз в минуту: статус «Ждёт пароль» меняется, когда человек задал пароль сам. */
export const STAFF_REFRESH_MS = 60_000;

export const settingsKeys = {
  health: ['settings', 'health'],
  errors: ['settings', 'errors'],
  audit: ['settings', 'audit'],
  prompts: ['settings', 'prompts'],
  staff: ['settings', 'staff'],
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

export function useSettingsStaff(): UseQueryResult<SettingsStaffView> {
  return useQuery({
    queryKey: settingsKeys.staff,
    queryFn: ({ signal }) => apiGet<SettingsStaffView>('settings/staff', signal),
    ...common,
    refetchInterval: STAFF_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Действия над пользователями и личными входами. Изменяющие после успеха ждут перечитывания
 * списка, как и у инструкций: пока экран показывает старый статус, считать действие принятым
 * рано. Ошибку не глотаем — её показывает тот, кто вызвал. Подсказка логина список не меняет.
 */
export function useStaffActions() {
  const queryClient = useQueryClient();
  const reread = () => queryClient.invalidateQueries({ queryKey: settingsKeys.staff });
  async function changing<T>(path: string, body: unknown): Promise<T> {
    const result = await apiPost<T>(path, body);
    await reread();
    return result;
  }
  return {
    suggest: (body: SuggestLoginBody) => apiPost<SuggestLoginOk>('settings/staff/suggest', body),
    create: (body: CreateStaffBody) => changing<DeliveryOk>('settings/staff/create', body),
    update: (body: UpdateStaffBody) => changing<ActionOk>('settings/staff/update', body),
    invite: (body: StaffIdBody) => changing<DeliveryOk>('settings/staff/invite', body),
    reset: (body: StaffIdBody) => changing<DeliveryOk>('settings/staff/reset', body),
    setPersonalMode: (body: PersonalModeBody) => changing<ActionOk>('settings/staff/personal-mode', body),
  };
}
