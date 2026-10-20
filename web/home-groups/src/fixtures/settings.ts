/**
 * Демо-данные раздела «Настройки» (только полный вход). Лежат отдельно от остальных фикстур:
 * раздел устроен как самостоятельный модуль и переедет вместе со своими данными.
 */
import type {
  DeliveryOk,
  LlmConfigView,
  LlmProviderOption,
  LlmTestResult,
  SettingsAssistantView,
  SettingsAuditView,
  SettingsBotView,
  SettingsErrorsView,
  SettingsHealthView,
  SettingsPromptsView,
  SettingsStaffView,
} from '@contracts';
import { GENERATED_AT } from './raw';

export function buildSettingsHealth(): SettingsHealthView {
  return {
    generatedAt: GENERATED_AT,
    overall: 'warn',
    metrics: [
      {
        key: 'cpu',
        label: 'Процессор',
        status: 'ok',
        value: 'Занят на 18 %',
        hint: 'Норма — до 70 %. Если держится выше, подбор и бот отвечают медленнее.',
        percent: 18,
      },
      {
        key: 'memory',
        label: 'Память',
        status: 'warn',
        value: '1,4 ГБ свободно из 7,8 ГБ',
        hint: 'Тревога — когда свободно меньше 1 ГБ. Тогда стоит перезапустить сервисы.',
        percent: 82,
      },
      {
        key: 'disk',
        label: 'Диск',
        status: 'ok',
        value: '41 ГБ свободно из 80 ГБ',
        hint: 'Тревога — когда свободно меньше 10 ГБ: хранилище копий базы может не поместиться.',
        percent: 49,
      },
      {
        key: 'database',
        label: 'База данных',
        status: 'ok',
        value: 'Отвечает за 4 мс',
        hint: 'Если не отвечает, бот и страница перестанут работать.',
        percent: null,
      },
      {
        key: 'sessions',
        label: 'Входы в систему',
        status: 'ok',
        value: '3 активных',
        hint: 'Сессии, которые были открыты за последние сутки.',
        percent: null,
      },
      {
        key: 'service',
        label: 'Сервис «Домашние группы»',
        status: 'ok',
        value: 'Работает 12 дней',
        hint: 'Время с последнего перезапуска.',
        percent: null,
      },
    ],
  };
}

export function buildSettingsErrors(): SettingsErrorsView {
  return {
    generatedAt: GENERATED_AT,
    items: [
      {
        id: 41,
        at: '2026-10-09T09:12:08+03:00',
        service: 'домашние группы',
        message: 'Не удалось утвердить заявку: группа ДГ-0012 уже закрыта для приёма',
        context: 'POST /api/v1/requests/12/approve',
      },
      {
        id: 40,
        at: '2026-10-09T07:02:45+03:00',
        service: 'подбор',
        message: 'Подбор для заявки прерван: нет данных о районе',
        context: 'авто-подбор, заявка 17',
      },
      {
        id: 39,
        at: '2026-10-08T21:47:30+03:00',
        service: 'бот',
        message: 'Платформа MAX ответила 429, отправка повторена через 5 секунд',
        context: null,
      },
      {
        id: 38,
        at: '2026-10-08T16:20:11+03:00',
        service: 'домашние группы',
        message: 'Тело запроса слишком большое',
        context: 'POST /api/v1/settings/prompts/save',
      },
      {
        id: 37,
        at: '2026-10-07T10:05:02+03:00',
        service: 'бот',
        message: 'Цикл опроса Telegram перезапущен после обрыва соединения',
        context: 'supervisePolling',
      },
    ],
  };
}

export function buildSettingsAudit(): SettingsAuditView {
  return {
    generatedAt: GENERATED_AT,
    items: [
      {
        id: 118,
        at: '2026-10-09T09:20:14+03:00',
        actor: 'mbv_admin',
        service: 'домашние группы',
        action: 'request.approve',
        actionLabel: 'Утвердил заявку',
        entityType: 'request',
        entityId: 12,
        before: { status: 'открыта', group: null },
        after: { status: 'исполнена', group: 'ДГ-0007' },
        note: null,
      },
      {
        id: 117,
        at: '2026-10-09T09:05:51+03:00',
        actor: 'mbv_admin',
        service: 'домашние группы',
        action: 'request.reject',
        actionLabel: 'Отклонил группу',
        entityType: 'request',
        entityId: 15,
        before: { group: 'ДГ-0003', reason: null },
        after: { group: null, reason: 'не подошло время', comment: 'Работает по вторникам вечером' },
        note: 'Причина: время',
      },
      {
        id: 116,
        at: '2026-10-09T08:00:03+03:00',
        actor: 'авто',
        service: 'подбор',
        action: 'matching.run',
        actionLabel: 'Запустил подбор',
        entityType: 'matching',
        entityId: null,
        before: null,
        after: { предложено: 4, заменено: 1, без_изменений: 9 },
        note: 'Подбор по расписанию',
      },
      {
        id: 115,
        at: '2026-10-08T18:40:27+03:00',
        actor: 'super_mbv_admin',
        service: 'домашние группы',
        action: 'matching.auto',
        actionLabel: 'Переключил автоматический подбор',
        entityType: 'settings',
        entityId: null,
        before: { auto: false },
        after: { auto: true },
        note: null,
      },
      {
        id: 114,
        at: '2026-10-08T17:12:09+03:00',
        actor: 'super_mbv_admin',
        service: 'домашние группы',
        action: 'prompt.save',
        actionLabel: 'Сохранил инструкцию агента',
        entityType: 'prompt',
        entityId: 3,
        before: { версия: 2 },
        after: { версия: 3, блок: 'principles' },
        note: 'Добавил про возраст',
      },
      {
        id: 113,
        at: '2026-10-08T11:33:48+03:00',
        actor: 'mbv_admin',
        service: 'домашние группы',
        action: 'request.need_call',
        actionLabel: 'Отметил «нужен звонок»',
        entityType: 'request',
        entityId: 12,
        before: { callback: false },
        after: { callback: true },
        note: null,
      },
      {
        id: 112,
        at: '2026-10-07T15:02:36+03:00',
        actor: 'mbv_admin',
        service: 'домашние группы',
        action: 'request.approve',
        actionLabel: 'Утвердил заявку',
        entityType: 'request',
        entityId: 9,
        before: { status: 'открыта' },
        after: { status: 'исполнена', group: 'ДГ-0011' },
        note: null,
      },
    ],
  };
}

export function buildSettingsPrompts(): SettingsPromptsView {
  return {
    generatedAt: GENERATED_AT,
    agents: [
      {
        key: 'coordinator',
        title: 'Помощник координатора',
        model: 'Claude Sonnet',
        blocks: [
          {
            key: 'role',
            title: 'Роль',
            purpose: 'Кто такой агент и чем он занимается.',
            editable: true,
            text: 'Ты помогаешь координатору домашних групп церкви подобрать человеку группу. Ты предлагаешь, а решает всегда координатор.',
            isDefault: true,
            versions: [],
          },
          {
            key: 'principles',
            title: 'Принципы',
            purpose: 'Что для церкви важнее всего при подборе.',
            editable: true,
            text: [
              'Бережно относись к людям: за каждой заявкой живой человек.',
              'Не обещай место, пока координатор не утвердил заявку.',
              'Возраст важнее района: группа с другим возрастом не предлагается.',
            ].join('\n'),
            isDefault: false,
            versions: [
              { version: 3, at: '2026-10-08T17:12:09+03:00', by: 'super_mbv_admin', note: 'Добавил про возраст', active: true },
              { version: 2, at: '2026-09-21T10:30:00+03:00', by: 'super_mbv_admin', note: 'Убрал лишнее', active: false },
              { version: 1, at: '2026-09-02T09:05:00+03:00', by: 'super_mbv_admin', note: null, active: false },
            ],
          },
          {
            key: 'steps',
            title: 'Порядок работы',
            purpose: 'В каком порядке агент рассматривает заявку.',
            editable: true,
            text: [
              '1. Прочитай заявку и проверь, какие данные известны.',
              '2. Найди группы в том же районе и с тем же возрастом.',
              '3. Сравни удобные день и время.',
              '4. Предложи не больше трёх вариантов и объясни выбор одной фразой.',
            ].join('\n'),
            isDefault: false,
            versions: [{ version: 1, at: '2026-09-02T09:10:00+03:00', by: 'super_mbv_admin', note: 'Первая версия', active: true }],
          },
          {
            key: 'examples',
            title: 'Примеры',
            purpose: 'Образцы хороших предложений.',
            editable: true,
            text: 'Пример: «Мария, 34 года, Приморский район, вторник вечером. Группа ДГ-0007: тот же район, возраст подходит, встречаются по вторникам».',
            isDefault: true,
            versions: [],
          },
          {
            key: 'service',
            title: 'Служебные правила',
            purpose: 'Формат ответа, который ждёт программа.',
            editable: false,
            text: 'Отвечай только JSON по схеме proposal. Не добавляй пояснений вне схемы. Поле reasons — не больше четырёх фраз.',
            isDefault: true,
            versions: [],
          },
        ],
      },
    ],
  };
}

/** Пользователи с личными входами: по одному на каждый статус, у «ждущих пароль» — разная судьба ссылки. */
export function buildSettingsStaff(): SettingsStaffView {
  return {
    generatedAt: GENERATED_AT,
    items: [
      {
        id: 1,
        login: 'e_smirnova',
        fullName: 'Елена Смирнова',
        email: 'smirnova@example.org',
        role: 'super',
        status: 'active',
        lastLoginAt: '2026-10-09T08:41:00+03:00',
        hasPendingLink: false,
      },
      {
        id: 2,
        login: 'a_kuznetsov',
        fullName: 'Алексей Кузнецов',
        email: 'kuznetsov@example.org',
        role: 'admin',
        status: 'active',
        lastLoginAt: '2026-10-07T19:15:00+03:00',
        hasPendingLink: true,
      },
      {
        id: 3,
        login: 'm_volkova',
        fullName: 'Марина Волкова',
        email: 'volkova@example.org',
        role: 'admin',
        status: 'invited',
        lastLoginAt: null,
        hasPendingLink: true,
      },
      {
        id: 4,
        login: 'd_orlov',
        fullName: 'Дмитрий Орлов',
        email: 'orlov@example.org',
        role: 'admin',
        status: 'invited',
        lastLoginAt: null,
        hasPendingLink: false,
      },
      {
        id: 5,
        login: 'o_pavlova',
        fullName: 'Ольга Павлова',
        email: 'pavlova@example.org',
        role: 'admin',
        status: 'disabled',
        lastLoginAt: '2026-08-14T12:05:00+03:00',
        hasPendingLink: false,
      },
    ],
    personal: { enabled: false, canEnable: true, activeWithPassword: 2, mailConfigured: false },
  };
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const translit = (s: string): string => [...s.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');

/**
 * Подсказка логина в демо: первая буква имени, `_`, фамилия латиницей. Порядок «Имя Фамилия» —
 * как в форме; настоящий сервер подбирает свободный логин сам.
 */
export function fixtureSuggestLogin(fullName: string): string {
  const [first = '', last = ''] = fullName.trim().split(/\s+/);
  const initial = translit(first).slice(0, 1);
  return [initial, translit(last)].filter(Boolean).join('_') || 'user';
}

/**
 * Ответ на отправку ссылки в демо. Почты в демо нет, поэтому всегда `link`: так на снимках
 * виден самый важный для администратора случай, когда ссылку нужно передать самому.
 */
export function fixtureStaffDelivery(email: string, id?: number): DeliveryOk {
  return { ok: true, delivery: 'link', email, path: '/set-password?token=demo-d41d8cd98f00b204e9800998ecf8427e', ...(id ? { id } : {}) };
}

/**
 * Рассылка «дослать вопросы» в демо ушли или нет. Единственное изменяемое состояние фикстур: без него после
 * нажатия кнопки число получателей осталось бы прежним, и на экране выглядело бы, что рассылка не сработала.
 */
const DEMO_INVITES_JOIN = 4;
const DEMO_INVITES_LEAD = 2;
const DEMO_INVITES_LEADERS = 3;
let demoInvitesSent = false;
let demoLeadersSent = false;

/** Для тестов: вернуть демо в состояние «доп. вопросы ещё не отправляли». */
export function resetDemoInvites(): void {
  demoInvitesSent = false;
  demoLeadersSent = false;
}

/** Рассылка «ушла»: в демо сервера нет, поэтому получатели просто обнуляются. Возвращает, скольким «отправлено». */
export function sendDemoInvites(audience: 'seekers' | 'leaders' = 'seekers'): number {
  if (audience === 'leaders') {
    const leaders = demoLeadersSent ? 0 : DEMO_INVITES_LEADERS;
    demoLeadersSent = true;
    return leaders;
  }
  const total = demoInvitesSent ? 0 : DEMO_INVITES_JOIN + DEMO_INVITES_LEAD;
  demoInvitesSent = true;
  return total;
}

/** Настройка «новые вопросы анкеты» в демо: значение пока из файла `.env`, в настройках его не меняли. */
export function buildSettingsBot(): SettingsBotView {
  const join = demoInvitesSent ? 0 : DEMO_INVITES_JOIN;
  const lead = demoInvitesSent ? 0 : DEMO_INVITES_LEAD;
  return {
    generatedAt: GENERATED_AT,
    extraQuestions: { mode: 'off', ids: '', source: 'env', envValue: 'off' },
    invites: {
      available: true,
      join,
      lead,
      total: join + lead,
      leaders: demoLeadersSent ? 0 : DEMO_INVITES_LEADERS,
      off: false,
      textJoin: 'Чтобы подобрать вам группу, ответьте ещё на два вопроса: в какое время вам удобно и в каком районе вы живёте.',
      textLead: 'Чтобы помочь вам открыть группу, ответьте ещё на два вопроса: в какое время удобно собираться и где это может быть.',
      textLeader: 'Чтобы направлять к вам новых людей, ответьте на два вопроса: когда собирается ваша группа и где проходят встречи.',
    },
  };
}

/** Провайдеры, как их отдаёт сервер: четыре, у «другого» адреса и моделей нет — их вписывает человек. */
export function buildLlmProviders(): LlmProviderOption[] {
  return [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-chat'],
      defaultModel: 'deepseek-chat',
      note: 'Сервис в Китае: данные обрабатываются за рубежом.',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
      defaultModel: 'gpt-4o-mini',
      note: 'Сервис в США: данные обрабатываются за рубежом.',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini'],
      defaultModel: 'deepseek/deepseek-chat',
      note: 'Посредник: запрос пересылается выбранной модели другого сервиса.',
    },
    {
      id: 'custom',
      label: 'Другой (свой адрес)',
      baseUrl: null,
      models: [],
      defaultModel: null,
      note: 'Любой сервис, совместимый с OpenAI: адрес и модель вписываются вручную.',
    },
  ];
}

type DemoLlm = Pick<LlmConfigView, 'provider' | 'baseUrl' | 'model' | 'keySource' | 'keyHint'>;
const DEMO_LLM_START: DemoLlm = { provider: 'deepseek', baseUrl: null, model: 'deepseek-chat', keySource: 'settings', keyHint: 'ABCD' };
let demoLlm: DemoLlm = DEMO_LLM_START;

/** Для тестов: вернуть демо в исходное подключение. */
export function resetDemoLlm(): void {
  demoLlm = DEMO_LLM_START;
}

/**
 * Сохранение подключения в демо: провайдер, модель и адрес запоминаются до перезагрузки страницы, чтобы после «Сохранить» было видно
 * действующее значение. Ключ не хранится вовсе, остаются лишь последние четыре символа, как на сервере.
 */
export function saveDemoLlm(body: { provider?: LlmConfigView['provider']; model?: string; baseUrl?: string | null; apiKey?: string | null }): void {
  const next: DemoLlm = { ...demoLlm };
  if (body.provider) next.provider = body.provider;
  if (typeof body.model === 'string') next.model = body.model;
  next.baseUrl = next.provider === 'custom' ? (body.baseUrl ?? null) : null;
  if (typeof body.apiKey === 'string') {
    next.keySource = 'settings';
    next.keyHint = body.apiKey.slice(-4);
  } else if (body.apiKey === null) {
    // Сохранённый ключ убрали: действует тот, что в файле `.env` сервера.
    next.keySource = 'env';
    next.keyHint = 'WXYZ';
  }
  demoLlm = next;
}

/** Подключение в демо: по умолчанию ключ сохранён в настройках (видны лишь последние четыре символа). Самого ключа в данных нет и быть не может. */
export function buildLlmConfig(): LlmConfigView {
  return { ...demoLlm, keySet: true, keyUnreadable: false, providers: buildLlmProviders() };
}

/** Помощник в демо: ключ «задан», включён, один запуск в прошлом. Самого ключа в данных нет и быть не может. */
export function buildSettingsAssistant(): SettingsAssistantView {
  return {
    generatedAt: GENERATED_AT,
    available: true,
    enabled: true,
    model: demoLlm.model,
    llm: buildLlmConfig(),
    lastRun: { at: '2026-10-09T09:30:00+03:00', actor: 'Трофимова С.', asked: 6, filled: 4, withQuestions: 3, proposals: 2 },
  };
}

/** Ключ, на который демо-проверка отвечает отказом: так можно посмотреть, как выглядит ошибка. */
export const DEMO_BAD_KEY = 'bad-key-00000';

/** Проверка подключения в демо: всегда успех, кроме ключа DEMO_BAD_KEY. Ничего не сохраняется. */
export function buildLlmTestResult(body: { provider?: string; model?: string; apiKey?: string | null }): LlmTestResult {
  if (body.apiKey === DEMO_BAD_KEY) {
    return {
      ok: false,
      code: 'auth',
      message: 'Провайдер не принял ключ (код 401). Проверьте, что ключ скопирован целиком и не отозван.',
      status: 401,
      detail: 'Authentication Fails',
    };
  }
  return { ok: true, provider: body.provider ?? 'deepseek', model: body.model ?? 'deepseek-chat', ms: 840 };
}
