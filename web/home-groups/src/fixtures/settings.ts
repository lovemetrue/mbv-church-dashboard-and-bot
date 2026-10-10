/**
 * Демо-данные раздела «Настройки» (только полный вход). Лежат отдельно от остальных фикстур:
 * раздел устроен как самостоятельный модуль и переедет вместе со своими данными.
 */
import type {
  SettingsAuditView,
  SettingsErrorsView,
  SettingsHealthView,
  SettingsPromptsView,
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
