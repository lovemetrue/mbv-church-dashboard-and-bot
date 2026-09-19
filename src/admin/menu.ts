import type { ActionButton } from '../core/platform.js';

/**
 * Клавиатура служителя.
 *
 * Работа служителя переехала в дашборд: там заявки, статистика, заведение групп
 * и ведущих. В боте остаётся то, что умеет только он: отметить выданный набор,
 * разослать объявление и загрузить материал дня. Набирать эти команды с телефона
 * неудобно — набор выдают стоя перед человеком, — поэтому они на кнопках.
 * Остальное — командами, см. /help.
 */
export const ADMIN_MENU: ActionButton[][] = [
  [
    { label: '📦 Выдать набор', command: '/kit' },
    { label: '📣 Объявление', command: '/broadcast' },
  ],
  [
    { label: '✏️ Загрузить день', command: '/setday' },
    { label: '▶️ Старт', command: '/start' },
  ],
];

/** Кнопка выхода из мини-диалога: показывается вместо основной клавиатуры, пока бот ждёт данные. */
export const CANCEL: ActionButton = { label: '✖️ Отмена', command: '/cancel' };
export const CANCEL_MENU: ActionButton[][] = [[CANCEL]];

/**
 * Очистка базы: кнопка появляется только когда включён ALLOW_DB_RESET.
 * Нужна на время тестов, в реальной кампании её не должно быть видно вообще.
 */
export const DB_RESET: ActionButton = { label: '🧹 Очистить базу', command: '/reset' };

/** Клавиатура служителя. Кнопку очистки добавляем только если она разрешена настройками. */
export const adminMenu = (allowDbReset: boolean): ActionButton[][] =>
  allowDbReset ? [...ADMIN_MENU, [DB_RESET]] : ADMIN_MENU;

// Подпись очистки знаем всегда: иначе её текст ушёл бы в анкету как ответ на вопрос.
const BY_LABEL = new Map([...ADMIN_MENU.flat(), CANCEL, DB_RESET].map((b) => [b.label, b.command]));

/**
 * Подписи кнопок, которых больше нет.
 *
 * Reply-клавиатура живёт на стороне клиента: у служителей она останется старой,
 * пока бот не пришлёт новую. Нажатие на исчезнувшую подпись — это обычный текст,
 * и без этого списка он ушёл бы в анкету как ответ на вопрос.
 */
export const RETIRED_LABELS: readonly string[] = [
  '📊 Статистика',
  '📋 Заявки',
  '➕ Регистрация участника',
  '👥 Добавить ведущего',
  '📇 Ведущие',
  '📥 Выгрузить участников',
  '📅 Дни кампании',
  '✅ Закрыть заявку',
  '👀 Показать день',
  '🚀 Отправить день сейчас',
  '❓ Справка',
];

const RETIRED = new Set(RETIRED_LABELS);

/** Нажали кнопку, которой больше нет на клавиатуре. */
export function retiredLabel(text: string): boolean {
  return RETIRED.has(text.trim());
}

/** Служитель может выйти из диалога и кнопкой, и словом. */
export function isCancel(text: string): boolean {
  return /^(отмена|отменить|\/cancel|✖️\s*отмена)$/i.test(text.trim());
}

/** Команда, которую служитель вызвал нажатием кнопки клавиатуры. */
export function commandByLabel(text: string): string | null {
  return BY_LABEL.get(text.trim()) ?? null;
}

/**
 * Префикс callback-кнопок служителя.
 *
 * Раньше через эти кнопки меню работало и в MAX (там нет reply-клавиатур), но
 * меню служителя теперь только в Telegram — см. AdminFlow.isAdmin. Формат
 * данных оставлен как есть, реально теперь используется только в Telegram.
 */
export const ADMIN_CB = 'admin:';
