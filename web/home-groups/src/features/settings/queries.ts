import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ActivatePromptBody,
  ActionOk,
  CreateStaffBody,
  DeliveryOk,
  ExtraQuestionsBody,
  AddressTableView,
  GeocoderConfigBody,
  MapConfigView,
  GeocoderConfigView,
  GeocoderTestResult,
  LlmConfigBody,
  LlmTestBody,
  LlmTestResult,
  PersonalModeBody,
  SavePromptBody,
  SendExtraInvitesBody,
  SendExtraInvitesOk,
  AssistantEnabledBody,
  SettingsAssistantView,
  SettingsAuditView,
  SettingsBotView,
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
import { queryKeys } from '../../shared/api/queries';

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
  bot: ['settings', 'bot'],
  assistant: ['settings', 'assistant'],
  geocoder: ['settings', 'geocoder'],
  addresses: ['settings', 'geocoder', 'addresses'],
  map: ['settings', 'map'],
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

/** Настройка бота — раз в минуту, как инструкции: её могли сохранить с другого устройства. */
export const BOT_REFRESH_MS = 60_000;

export function useSettingsBot(): UseQueryResult<SettingsBotView> {
  return useQuery({
    queryKey: settingsKeys.bot,
    queryFn: ({ signal }) => apiGet<SettingsBotView>('settings/bot', signal),
    ...common,
    refetchInterval: BOT_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Сохранение «кому задавать новые вопросы анкеты». После успеха ждём перечитывания настройки: пока экран показывает
 * прежний источник («из файла .env»), считать сохранение принятым рано. Ошибку не глотаем — её показывает вызвавший.
 */
export function useBotActions() {
  const queryClient = useQueryClient();
  return {
    async saveExtraQuestions(body: ExtraQuestionsBody): Promise<void> {
      await apiPost('settings/bot/extra-questions', body);
      await queryClient.invalidateQueries({ queryKey: settingsKeys.bot });
    },
    /**
     * Рассылка доп. вопросов тем, кто уже зарегистрирован. Уходит живым людям, поэтому без повторов: apiPost их не делает,
     * и здесь их добавлять нельзя. Обзор перечитываем после успеха (получателей станет меньше) и после `conflict`
     * (число изменилось, человек должен увидеть новое). При обрыве связи не перечитываем: сервер, скорее всего, недоступен,
     * а о том, ушла ли рассылка, скажет человек, обновив обзор сам.
     */
    async sendExtraQuestions(body: SendExtraInvitesBody): Promise<SendExtraInvitesOk> {
      try {
        const result = await apiPost<SendExtraInvitesOk>('settings/bot/send-extra-questions', body);
        await queryClient.invalidateQueries({ queryKey: settingsKeys.bot });
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'conflict') await queryClient.invalidateQueries({ queryKey: settingsKeys.bot });
        throw e;
      }
    },
  };
}

/** Настройка помощника — раз в минуту, как бот: её могли изменить с другого устройства, а «последний запуск» меняется сам. */
export const ASSISTANT_REFRESH_MS = 60_000;

export function useSettingsAssistant(): UseQueryResult<SettingsAssistantView> {
  return useQuery({
    queryKey: settingsKeys.assistant,
    queryFn: ({ signal }) => apiGet<SettingsAssistantView>('settings/assistant', signal),
    ...common,
    refetchInterval: ASSISTANT_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Переключатель «Помощник включён». После успеха ждём перечитывания настройки (как у бота), а «Заявки» помечаем
 * устаревшими: кнопка помощника там появляется и пропадает по этой настройке, и ждать минуты до опроса незачем.
 * Ошибку не глотаем — её показывает вызвавший.
 */
export function useAssistantActions() {
  const queryClient = useQueryClient();
  return {
    async setEnabled(enabled: boolean): Promise<void> {
      const body: AssistantEnabledBody = { enabled };
      await apiPost('settings/assistant/enabled', body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKeys.assistant }),
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      ]);
    },
    /**
     * Сохранение подключения (провайдер, модель, ключ). Ключ уходит только в теле этого запроса: ни в кэш запросов, ни в
     * хранилище браузера он не попадает (`apiPost` ничего не запоминает, мутации react-query здесь не используются). После
     * успеха перечитываем настройку и «Заявки», как у переключателя: от подключения зависит, доступен ли помощник.
     */
    async saveLlm(body: LlmConfigBody): Promise<void> {
      await apiPost('settings/assistant/llm', body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKeys.assistant }),
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      ]);
    },
    /** Проверка подключения: ничего не сохраняет, поэтому и перечитывать нечего. Отказ провайдера приходит обычным ответом `ok: false`. */
    testLlm(body: LlmTestBody): Promise<LlmTestResult> {
      return apiPost<LlmTestResult>('settings/assistant/llm-test', body);
    },
  };
}

export function useSettingsGeocoder(): UseQueryResult<GeocoderConfigView> {
  return useQuery({
    queryKey: settingsKeys.geocoder,
    queryFn: ({ signal }) => apiGet<GeocoderConfigView>('settings/geocoder', signal),
    ...common,
    refetchInterval: ASSISTANT_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/** Ключ геокодера уходит только в теле запроса: ни в кэш запросов, ни в хранилище браузера он не попадает. */
export function useGeocoderActions() {
  const queryClient = useQueryClient();
  return {
    async save(body: GeocoderConfigBody): Promise<void> {
      await apiPost('settings/geocoder', body);
      await queryClient.invalidateQueries({ queryKey: settingsKeys.geocoder });
    },
    /** Проверка ничего не сохраняет; отказ Яндекса приходит обычным ответом `ok: false`. */
    test(body: GeocoderConfigBody): Promise<GeocoderTestResult> {
      return apiPost<GeocoderTestResult>('settings/geocoder-test', body);
    },
    /** Один запрос к Яндексу по одному адресу; после него таблица и сводка перечитываются. Ошибку не глотаем. */
    async retry(address: string): Promise<void> {
      await apiPost('settings/geocoder-retry', { address });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKeys.addresses }),
        queryClient.invalidateQueries({ queryKey: settingsKeys.geocoder }),
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.people }),
      ]);
    },
  };
}

/** Таблица адресов читается только пока открыто окно: адресов сотни, а нужна она редко. */
export function useGeocoderAddresses(): UseQueryResult<AddressTableView> {
  return useQuery({
    queryKey: settingsKeys.addresses,
    queryFn: ({ signal }) => apiGet<AddressTableView>('settings/geocoder/addresses', signal),
    ...common,
  });
}

export function useSettingsMap(): UseQueryResult<MapConfigView> {
  return useQuery({ queryKey: settingsKeys.map, queryFn: ({ signal }) => apiGet<MapConfigView>('settings/map', signal), ...common });
}

/** Ключ карты, как и остальные ключи, уходит только в теле запроса и нигде не запоминается. */
export function useMapActions() {
  const queryClient = useQueryClient();
  return {
    async save(body: GeocoderConfigBody): Promise<void> {
      await apiPost('settings/map', body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKeys.map }),
        queryClient.invalidateQueries({ queryKey: ['map'] }),
      ]);
    },
  };
}
