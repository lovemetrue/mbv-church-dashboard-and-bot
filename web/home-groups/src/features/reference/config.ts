import type { CoordinatorItem, GroupItem, PersonItem } from '@contracts';
import { formatDateFull, formatPhone } from '../../entities/format';
import { STRANGE_FIELD } from '../../entities/strange';
import type { FieldDef, Filter, Preset, Row } from '../../shared/filters';
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
  /**
   * Отбор, который стоит, пока человек сам не выбрал другой («Закрыта» у групп скрыта). В адрес он
   * не пишется: пустой адрес и значит «по умолчанию». Снять его можно, но при следующем открытии
   * справочника он применится снова (см. useTableState).
   */
  defaultFilters?: Filter[];
  /** Служебный ключ записи `_key` кладётся в строку: по нему открывается карточка. */
  toRow: (item: T) => Row;
  keyOf: (item: T) => string;
  /** Подпись для кнопки открытия карточки. */
  titleOf: (item: T) => string;
}

const yesNo = (v: boolean): string => (v ? ru.reference.yes : ru.reference.no);

/**
 * «Принимает новых» в списке — вычисляемое: не камерная (служителей или отдельного служения набирают своих) и не
 * отмечена «Не направлять». Поля «Приём новых» больше нет: его «НЕТ» перенесено в «Не направлять» (миграция 046).
 */
export const takesNew = (g: Pick<GroupItem, 'chamber' | 'doNotRefer'>): boolean => !g.doNotRefer && !g.chamber;

const f = (key: string, extra?: Omit<FieldDef, 'key'>): FieldDef => ({ key, ...extra });

export const groupsConfig: EntityConfig<GroupItem> = {
  id: 'groups',
  label: ru.reference.groups,
  // Номера строки из первоначальной таблицы («№ в реестре») здесь нет: это не номер группы. Группу зовут по коду.
  fields: [
    f('Код'),
    f('Ведущий'),
    f('Со-ведущий'),
    f('Телефон'),
    f('Район', { groupable: true }),
    f('Метро'),
    f('Адрес'),
    f('Возраст', { multi: true }),
    f('Когда'),
    f('День', { groupable: true }),
    f('Время', { groupable: true }),
    f('Места'),
    f('Мест свободно', { kind: 'number' }),
    f('Вместимость', { kind: 'number' }),
    f('Статус', { groupable: true }),
    f('Данные проверены', { groupable: true }),
    f('40 дней', { groupable: true }),
    f('Только в кампанию', { groupable: true }),
    f('Принимает новых', { groupable: true }),
    f('Не направлять', { groupable: true }),
    f('Камерная', { groupable: true }),
    f('Направление', { groupable: true }),
    f('Состав'),
    f('Координатор', { groupable: true }),
    f('Проверена, дн.', { kind: 'number' }),
    f('Здоровье', { kind: 'number' }),
    f('Комментарий'),
    f('В составе', { kind: 'number' }),
  ],
  columns: [
    'Код', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Данные проверены', 'Здоровье',
    'Со-ведущий', 'Телефон', 'Метро', 'Адрес', 'День', 'Время', 'Мест свободно', 'Вместимость',
    'Принимает новых', 'Не направлять', 'Камерная', '40 дней', 'Только в кампанию', 'Направление', 'Состав', 'Координатор', 'Проверена, дн.', 'Комментарий', 'В составе',
  ],
  defaultColumns: ['Код', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Данные проверены', 'Здоровье'],
  // Закрытые группы нужны редко и только мешают в общем списке; находятся, если снять отбор.
  // «Аннулирована» — группа, которая так и не открылась: мешает так же, как закрытая. Два чипа, а не один «не закрытые»:
  // каждый снимается отдельно, если нужно посмотреть именно закрытые или именно аннулированные.
  // «Принимает новых» — третий чип: по умолчанию координатор видит группы, куда можно направлять людей.
  defaultFilters: [
    { field: 'Статус', op: 'ne', value: 'Закрыта' },
    { field: 'Статус', op: 'ne', value: 'Аннулирована' },
    { field: 'Принимает новых', op: 'eq', value: ru.reference.yes },
  ],
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
    { name: '40 дней', filters: [{ field: '40 дней', op: 'eq', value: ru.reference.yes }] },
    { name: 'Только в кампанию', filters: [{ field: 'Только в кампанию', op: 'eq', value: ru.reference.yes }] },
  ],
  toRow: (g) => ({
    _key: String(g.id),
    Код: g.code,
    Ведущий: g.leader,
    'Со-ведущий': g.coLeader,
    Телефон: g.phone ? formatPhone(g.phone) : null,
    Район: g.district,
    Метро: g.metro,
    Адрес: g.address,
    Возраст: g.ageText,
    Когда: g.whenText,
    День: g.day,
    Время: g.slot,
    Места: `${g.people ?? '?'}/${g.capacity}`,
    // Служебное, как `_key`: в столбцы и фильтры не попадает, нужно только таблице для пометки.
    _placedNew: g.placedNew,
    _isNew: g.isNew ? 1 : 0,
    _isEmpty: g.empty ? 1 : 0,
    'Мест свободно': g.free,
    Вместимость: g.capacity,
    Статус: g.status,
    'Данные проверены': yesNo(g.checked),
    '40 дней': yesNo(g.campaignRegistered),
    'Только в кампанию': yesNo(g.campaignOnly),
    'Принимает новых': yesNo(takesNew(g)),
    'Не направлять': yesNo(g.doNotRefer),
    Камерная: yesNo(g.chamber),
    Направление: g.direction,
    Состав: g.composition,
    Координатор: g.coordinator,
    'Проверена, дн.': g.verifiedDaysAgo,
    Здоровье: g.health.score,
    Комментарий: g.comment,
    // Сколько человек в составе группы (а не «Места»: те ведёт ведущий и они могут расходиться с составом).
    'В составе': g.members.length,
    // Имена из состава нужны только быстрому поиску: он смотрит во все ячейки строки, которых нет в столбцах и
    // отборах. Ключ не служебный (без «_»): поиск пропускает служебные.
    'Люди в составе': g.members.map((m) => m.fio).join(', '),
  }),
  keyOf: (g) => String(g.id),
  titleOf: (g) => `Группа ${g.code}, ${g.leader}`,
};

/** «Мои группы»: где вошедший — координатор (имя как в справочнике команды), кроме закрытых и аннулированных. */
export const myGroupsPreset = (name: string): Preset => ({
  name: ru.reference.myGroups,
  filters: [
    { field: 'Статус', op: 'ne', value: 'Закрыта' },
    { field: 'Статус', op: 'ne', value: 'Аннулирована' },
    { field: 'Координатор', op: 'eq', value: name },
  ],
});

export const peopleConfig: EntityConfig<PersonItem> = {
  id: 'people',
  label: ru.reference.people,
  fields: [
    f('ФИО'),
    f('Телефон'),
    f('Возраст', { groupable: true }),
    f('Район', { groupable: true }),
    f('Район, метро, ориентир'),
    f('Адрес'),
    f('Откуда', { groupable: true }),
    f('Малая группа', { groupable: true }),
    f('Дата', { kind: 'date' }),
    f('Заявка', { kind: 'number' }),
    // Коды групп через запятую: отбор «Группы = ДГ-0012» находит всех, кто там состоит.
    f('Группы', { multi: true }),
    // Номер регистрации: по нему находят человека при выдаче набора и печатают карточку с QR.
    f('№', { kind: 'number' }),
    // Набор кампании выдают по регистрации (QR в карточке, вкладка «Наборы»): у строк без неё ячейка пустая.
    f('Набор', { groupable: true }),
    f('Набор выдан', { kind: 'date' }),
    // «Да» у людей с меткой «Странный человек»: по нему работает быстрый отбор «Странные».
    f(STRANGE_FIELD, { groupable: true }),
  ],
  columns: ['ФИО', 'Телефон', 'Возраст', 'Район', 'Район, метро, ориентир', 'Адрес', 'Откуда', 'Малая группа', 'Дата', 'Заявка', '№', 'Набор', 'Набор выдан', 'Группы', STRANGE_FIELD],
  // «№» не первым: первый столбец служит кнопкой открытия карточки, там должно быть имя.
  defaultColumns: ['ФИО', 'Телефон', 'Возраст', 'Район', 'Откуда', 'Малая группа', '№', 'Набор'],
  presets: [
    { name: 'Хотят в группу', filters: [{ field: 'Малая группа', op: 'eq', value: 'Хочет в группу' }] },
    { name: 'Хотят вести группу', filters: [{ field: 'Малая группа', op: 'eq', value: 'Откроет свою группу' }] },
    { name: 'Есть заявка', filters: [{ field: 'Заявка', op: 'filled', value: '' }] },
    { name: 'Район не указан', filters: [{ field: 'Район', op: 'empty', value: '' }] },
    { name: 'Нет телефона', filters: [{ field: 'Телефон', op: 'empty', value: '' }] },
    { name: ru.strange.preset, filters: [{ field: STRANGE_FIELD, op: 'eq', value: ru.reference.yes }] },
    { name: ru.reference.kitNotIssuedPreset, filters: [{ field: 'Набор', op: 'eq', value: ru.reference.kitNotIssued }] },
  ],
  toRow: (p) => ({
    _key: p.key,
    ФИО: p.fio,
    Телефон: p.phone ? formatPhone(p.phone) : null,
    Возраст: p.ageLabel,
    Район: p.district,
    'Район, метро, ориентир': p.place,
    Адрес: p.address,
    Откуда: p.from,
    'Малая группа': p.mdgLabel,
    // ISO в ячейке (по нему сортируем и сравниваем), а показывается дата в «ДД.ММ.ГГГГ» (см. renderCell).
    Дата: p.date,
    Заявка: p.requestId,
    '№': p.registrationNo,
    Набор: p.registrationNo === null ? null : p.kitIssuedOn ? ru.reference.kitIssued : ru.reference.kitNotIssued,
    'Набор выдан': p.kitIssuedOn,
    Группы: p.groups.length ? p.groups.join(', ') : null,
    [STRANGE_FIELD]: p.strange ? ru.reference.yes : ru.reference.no,
    // Служебное, как `_key`: метка целиком нужна таблице, чтобы нарисовать значок с подсказкой; в столбцы и отборы не попадает.
    _strangeBy: p.strange?.by ?? null,
    _strangeAt: p.strange?.at ?? null,
    _strangeNote: p.strange?.note ?? null,
  }),
  keyOf: (p) => p.key,
  titleOf: (p) => p.fio,
};

export const coordinatorsConfig: EntityConfig<CoordinatorItem> = {
  id: 'coordinators',
  label: ru.reference.coordinators,
  fields: [f('Имя'), f('Роль', { groupable: true, multi: true }), f('Групп', { kind: 'number' }), f('Участников', { kind: 'number' }), f('Подтверждено за 30 дн.', { kind: 'number' })],
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
  if (column === 'Дата' || column === 'Набор выдан') return formatDateFull(String(value));
  return String(value);
}
