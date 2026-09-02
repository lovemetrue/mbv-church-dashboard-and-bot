/**
 * Справочники домашних групп.
 *
 * Значения обязаны совпадать с теми, что в таблице церкви: дашборд группирует по ним
 * напрямую, и «Приморский р-н» вместо «Приморский» развалил бы статистику на две строки.
 * Поэтому служитель их выбирает кнопками, а не пишет текстом.
 *
 * Районы отсортированы по числу групп в текущей выгрузке: самые частые — сверху,
 * чтобы до них было меньше листать.
 */
export const DISTRICTS = [
  'Приморский',
  'Выборгский',
  'Центральный',
  'Калининский',
  'Невский',
  'Красногвардейский',
  'Красносельский',
  'Пушкинский',
  'Адмиралтейский',
  'Василеостровский',
  'Кировский',
  'Московский',
  'Фрунзенский',
  'Петроградский',
  'Петродворцовый',
  'Колпинский',
  'Кронштадтский',
  'Курортный',
  'Ленинградская область',
  'Онлайн',
] as const;

export const FORMATS = ['Основная церковь', 'Молодежная', 'Приватная (Закрытая)', 'Служение'] as const;

/** Статусы, которые имеет смысл ставить при заведении: «Закрыта» здесь была бы бессмысленна. */
export const GROUP_STATUSES = ['Функционирует', 'Потенциальная', 'На паузе'] as const;

/**
 * Все статусы, которые встречаются в таблице церкви. Нужны формам дашборда и проверке
 * данных: там можно и закрыть группу, и отметить помещение. Набор для заведения через
 * бота остаётся коротким — предлагать «Закрыта» при создании бессмысленно.
 */
export const ALL_GROUP_STATUSES = [
  ...GROUP_STATUSES,
  'Закрыта',
  'Недвижимость',
] as const;

/** Районы для проверки данных: в выгрузке встречается и «Не указан». */
export const ALL_DISTRICTS = [...DISTRICTS, 'Не указан'] as const;

export type District = (typeof DISTRICTS)[number];
export type GroupFormat = (typeof FORMATS)[number];
export type GroupStatus = (typeof GROUP_STATUSES)[number];

const byIndex = <T>(list: readonly T[], raw: string): T | null => {
  const i = Number.parseInt(raw, 10);
  return Number.isInteger(i) && i >= 0 && i < list.length ? (list[i] as T) : null;
};

export const districtByIndex = (raw: string): District | null => byIndex(DISTRICTS, raw);
export const formatByIndex = (raw: string): GroupFormat | null => byIndex(FORMATS, raw);
export const statusByIndex = (raw: string): GroupStatus | null => byIndex(GROUP_STATUSES, raw);

/** Число участников: пусто — это «не знаем», а не ноль. */
export function parsePeople(text: string): number | null | 'invalid' {
  const digits = text.replace(/\D/g, '');
  if (!digits) return 'invalid';
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1 || n > 200) return 'invalid';
  return n;
}
