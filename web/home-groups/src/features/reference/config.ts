import type { CoordinatorItem, GroupItem, PersonItem } from '@contracts';
import { formatDateFull, formatPhone } from '../../entities/format';
import type { FieldDef, Preset, Row } from '../../shared/filters';
import type { EntityId } from '../../shared/nav';
import { ru } from '../../shared/i18n/ru';

/** Описание сущности справочника: какие у неё поля, столбцы, быстрые отборы. Движок отборов общий. */
export interface EntityConfig<T> {
  id: EntityId;
  label: string;
  fields: FieldDef[];
  /** Все столбцы в порядке показа (ключи полей). */
  columns: string[];
  defaultColumns: string[];
  presets: Preset[];
  /** Служебный ключ записи `_key` кладётся в строку: по нему открывается карточка. */
  toRow: (item: T) => Row;
  keyOf: (item: T) => string;
  /** Подпись для кнопки открытия карточки. */
  titleOf: (item: T) => string;
}

const yesNo = (v: boolean): string => (v ? ru.reference.yes : ru.reference.no);

const f = (key: string, extra?: Omit<FieldDef, 'key'>): FieldDef => ({ key, ...extra });

export const groupsConfig: EntityConfig<GroupItem> = {
  id: 'groups',
  label: ru.reference.groups,
  fields: [
    f('№', { kind: 'number' }),
    f('Код'),
    f('Ведущий'),
    f('Со-ведущий'),
    f('Телефон'),
    f('Район', { groupable: true }),
    f('Метро'),
    f('Возраст', { multi: true }),
    f('Когда'),
    f('День', { groupable: true }),
    f('Время', { groupable: true }),
    f('Места'),
    f('Мест свободно', { kind: 'number' }),
    f('Вместимость', { kind: 'number' }),
    f('Статус', { groupable: true }),
    f('Принимает новых', { groupable: true }),
    f('Не направлять', { groupable: true }),
    f('Формат', { groupable: true }),
    f('Состав'),
    f('Координатор', { groupable: true }),
    f('Проверена, дн.', { kind: 'number' }),
    f('Здоровье', { kind: 'number' }),
    f('Комментарий'),
  ],
  columns: [
    '№', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Здоровье',
    'Код', 'Со-ведущий', 'Телефон', 'Метро', 'День', 'Время', 'Мест свободно', 'Вместимость',
    'Принимает новых', 'Не направлять', 'Формат', 'Состав', 'Координатор', 'Проверена, дн.', 'Комментарий',
  ],
  defaultColumns: ['№', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Здоровье'],
  presets: [
    {
      name: 'Принимают новых',
      filters: [
        { field: 'Статус', op: 'eq', value: 'Функционирует' },
        { field: 'Принимает новых', op: 'eq', value: ru.reference.yes },
        { field: 'Мест свободно', op: 'ge', value: '1' },
      ],
    },
    { name: 'Нет дня и времени', filters: [{ field: 'День', op: 'empty', value: '' }] },
    { name: 'Не подтверждались > 30 дн.', filters: [{ field: 'Проверена, дн.', op: 'ge', value: '31' }] },
    { name: 'Ни разу не подтверждались', filters: [{ field: 'Проверена, дн.', op: 'empty', value: '' }] },
    { name: 'Вечерние', filters: [{ field: 'Время', op: 'eq', value: 'вечер' }] },
    { name: 'На паузе', filters: [{ field: 'Статус', op: 'eq', value: 'На паузе' }] },
    { name: 'Не направлять', filters: [{ field: 'Не направлять', op: 'eq', value: ru.reference.yes }] },
  ],
  toRow: (g) => ({
    _key: String(g.id),
    '№': g.no,
    Код: g.code,
    Ведущий: g.leader,
    'Со-ведущий': g.coLeader,
    Телефон: g.phone ? formatPhone(g.phone) : null,
    Район: g.district,
    Метро: g.metro,
    Возраст: g.ageText,
    Когда: g.whenText,
    День: g.day,
    Время: g.slot,
    Места: `${g.people ?? '?'}/${g.capacity}`,
    'Мест свободно': g.free,
    Вместимость: g.capacity,
    Статус: g.status,
    'Принимает новых': yesNo(g.acceptsNew),
    'Не направлять': yesNo(g.doNotRefer),
    Формат: g.format,
    Состав: g.composition,
    Координатор: g.coordinator,
    'Проверена, дн.': g.verifiedDaysAgo,
    Здоровье: g.health.score,
    Комментарий: g.comment,
  }),
  keyOf: (g) => String(g.id),
  titleOf: (g) => `Группа ${g.no != null ? `№${g.no}` : g.code}, ${g.leader}`,
};

export const peopleConfig: EntityConfig<PersonItem> = {
  id: 'people',
  label: ru.reference.people,
  fields: [
    f('ФИО'),
    f('Телефон'),
    f('Возраст', { groupable: true }),
    f('Район', { groupable: true }),
    f('Откуда', { groupable: true }),
    f('Малая группа', { groupable: true }),
    f('Дата', { kind: 'date' }),
    f('Заявка', { kind: 'number' }),
  ],
  columns: ['ФИО', 'Телефон', 'Возраст', 'Район', 'Откуда', 'Малая группа', 'Дата', 'Заявка'],
  defaultColumns: ['ФИО', 'Телефон', 'Возраст', 'Район', 'Откуда', 'Малая группа'],
  presets: [
    { name: 'Хотят в группу', filters: [{ field: 'Малая группа', op: 'eq', value: 'Хочет в группу' }] },
    { name: 'Хотят вести группу', filters: [{ field: 'Малая группа', op: 'eq', value: 'Откроет свою группу' }] },
    { name: 'Есть заявка', filters: [{ field: 'Заявка', op: 'filled', value: '' }] },
    { name: 'Район не указан', filters: [{ field: 'Район', op: 'empty', value: '' }] },
    { name: 'Нет телефона', filters: [{ field: 'Телефон', op: 'empty', value: '' }] },
  ],
  toRow: (p) => ({
    _key: p.key,
    ФИО: p.fio,
    Телефон: p.phone ? formatPhone(p.phone) : null,
    Возраст: p.ageLabel,
    Район: p.district,
    Откуда: p.from,
    'Малая группа': p.mdgLabel,
    // ISO в ячейке (по нему сортируем и сравниваем), а показывается дата в «ДД.ММ.ГГГГ» (см. renderCell).
    Дата: p.date,
    Заявка: p.requestId,
  }),
  keyOf: (p) => p.key,
  titleOf: (p) => p.fio,
};

export const coordinatorsConfig: EntityConfig<CoordinatorItem> = {
  id: 'coordinators',
  label: ru.reference.coordinators,
  fields: [f('Имя'), f('Роль', { groupable: true }), f('Групп', { kind: 'number' }), f('Участников', { kind: 'number' }), f('Подтверждено за 30 дн.', { kind: 'number' })],
  columns: ['Имя', 'Роль', 'Групп', 'Участников', 'Подтверждено за 30 дн.'],
  defaultColumns: ['Имя', 'Роль', 'Групп', 'Участников', 'Подтверждено за 30 дн.'],
  presets: [
    { name: '3 группы и больше', filters: [{ field: 'Групп', op: 'ge', value: '3' }] },
    { name: 'Нет групп', filters: [{ field: 'Групп', op: 'eq', value: '0' }] },
  ],
  toRow: (c) => ({
    _key: String(c.id),
    Имя: c.name,
    Роль: c.role,
    Групп: c.groups,
    Участников: c.people,
    'Подтверждено за 30 дн.': c.verified30,
  }),
  keyOf: (c) => String(c.id),
  titleOf: (c) => c.name,
};

/** Как показывать значение ячейки в таблице (кроме цвета и точек — это делает таблица). */
export function displayCell(column: string, value: string | number | null): string {
  if (value === null || value === '') return '';
  if (column === 'Дата') return formatDateFull(String(value));
  return String(value);
}
