import type { CoordinatorItem, FormMeta, GroupItem } from '@contracts';
import { formatPhone } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { optionsWithPicked } from '../../shared/multiValue';

const m = ru.manage;

/** Описание одного поля формы правки. Имена совпадают с полями `UpdateBody` на сервере. */
export interface EditField {
  name: string;
  label: string;
  /**
   * multi — несколько галочек, значение одной строкой через запятую (см. `toggleInList`).
   * person — человек из «Людей» поиском по ФИО или телефону; значение — его ключ («u12», «p7»), пустое — не выбран.
   */
  kind: 'text' | 'select' | 'textarea' | 'date' | 'checkbox' | 'multi' | 'person';
  /** Пустое значение недопустимо: сервер всё равно отказал бы, поэтому «Сохранить» не включается. */
  required?: boolean;
  /** Для select и multi. */
  options?: string[];
  /** Подписи пунктов select, когда значение — номер записи (роль из справочника), а не сама подпись. */
  labels?: Record<string, string>;
  /** Пояснение под полем. */
  hint?: string;
  placeholder?: string;
  inputMode?: 'numeric' | 'tel';
  /** Для date: самая поздняя допустимая дата («2026-10-11»), например «не из будущего». */
  max?: string;
  /** На всю ширину окна, а не в половину. */
  wide?: boolean;
  /** Для person: поле второй позиции — человека оттуда здесь не выбрать (сервер всё равно отказал бы). */
  other?: string;
  /** Для person: можно ли отвязать (соведущего — да; ведущего только меняют, без него группы не бывает). */
  allowUnlink?: boolean;
  /** Для person: имя, записанное в группе текстом, пока человек не выбран (группа из таблицы церкви). */
  legacyName?: string | null;
}

export interface EditSpec {
  fields: EditField[];
  /** Значения при открытии формы. У флажка — '1' (отмечен) или ''. */
  initial: Record<string, string>;
  /** Пояснение под полями. */
  note?: string;
}

/**
 * Что отправить на сервер: ТОЛЬКО изменённые поля. Сервер берёт непосланное из базы, поэтому
 * незатронутое поле нельзя слать даже «как было»: закрытые поля (адрес, телефоны) формы не видела,
 * а чужую правку, пришедшую между открытием формы и «Сохранить», мы бы затёрли своими старыми значениями.
 * Очищенное необязательное поле уходит пустой строкой (так сервер его очищает); флажок — '1' или '0'.
 */
export function changedFields(spec: EditSpec, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const now = (values[f.name] ?? '').trim();
    const was = (spec.initial[f.name] ?? '').trim();
    if (now === was) continue;
    out[f.name] = f.kind === 'checkbox' ? (now ? '1' : '0') : now;
  }
  return out;
}

/** Обязательные поля, которые человек опустошил. Поле, пустое с самого начала, не считается: его вины нет. */
export function blankRequired(spec: EditSpec, values: Record<string, string>): string[] {
  return spec.fields
    .filter((f) => f.required && (values[f.name] ?? '').trim() === '' && (spec.initial[f.name] ?? '').trim() !== '')
    .map((f) => f.name);
}

/** Значение, которого нет в справочнике (устаревшее или из таблицы), остаётся выбираемым: иначе форма его теряла бы. */
const withCurrent = (list: readonly string[], current: string | null): string[] =>
  current && !list.includes(current) ? [current, ...list] : [...list];

function feedbackNow(days: number | null): string {
  if (days === null) return m.group.feedbackNever;
  if (days === 0) return m.group.feedbackToday;
  return m.group.feedbackAgo(days);
}

/**
 * Форма правки группы. Сервер не отдаёт интерфейсу «время» и «дату обратной связи» в чистом виде
 * (только собранное «Вт, вечер» и «дней назад»), поэтому эти поля пустые и отправляются, только если
 * их вписали; под ними подсказка с текущим значением.
 *
 * Отдельных полей «телефон ведущего» и «телефон соведущего» нет: ведущего и соведущего выбирают из «Людей», и номер
 * берётся из карточки человека — правят его там, в одном месте, а не в каждой группе. Записанный в группе номер
 * (из таблицы церкви) остаётся запасным, пока человек не выбран.
 */
export function groupEditSpec(g: GroupItem, meta: FormMeta): EditSpec {
  const spec = groupEditFields(g, meta);
  // Контактов сервер этому входу не прислал (чужая группа — телефоны, камерная — ещё и адрес): пустое поле адреса
  // выглядело бы как настоящее, а сохранённое затёрло бы его. Поэтому его в форме нет, а под полями сказано почему.
  if (!g.contactsHidden) return spec;
  if (!g.chamber) return { ...spec, note: m.group.phonesHiddenNote };
  return { ...spec, fields: spec.fields.filter((f) => !CHAMBER_FIELDS.has(f.name)), note: m.group.contactsHidden };
}

const CHAMBER_FIELDS: ReadonlySet<string> = new Set(['address']);

/** Подсказка под выбором человека: откуда телефон, а без выбора — какой номер показывается сейчас. */
function personHint(key: string | null, phone: string | null): string {
  return key || !phone ? m.group.personHint : `${m.group.personHint} ${m.group.personHintUnlinked(formatPhone(phone))}`;
}

function groupEditFields(g: GroupItem, meta: FormMeta): EditSpec {
  const t = m.group.fields;
  const keep = m.group.keepHint;
  return {
    fields: [
      // ФИО ведущего и соведущего текстом не правится: это люди из «Людей», имя и телефон — из их карточек.
      {
        name: 'leaderKey',
        label: t.leaderKey,
        kind: 'person',
        other: 'coLeaderKey',
        allowUnlink: false,
        legacyName: g.leaderKey ? null : g.leader,
        hint: personHint(g.leaderKey, g.phone),
      },
      {
        name: 'coLeaderKey',
        label: t.coLeaderKey,
        kind: 'person',
        other: 'leaderKey',
        legacyName: g.coLeaderKey ? null : g.coLeader,
        hint: personHint(g.coLeaderKey, g.coLeaderPhone),
      },
      { name: 'district', label: t.district, kind: 'select', required: true, options: withCurrent(meta.districts, g.district) },
      // Подбор сопоставляет сначала по адресу, а если он пуст — по метро или ориентиру: оба поля видны и правятся здесь.
      { name: 'address', label: t.address, kind: 'text', wide: true, hint: m.group.addressHint },
      { name: 'metro', label: t.metro, kind: 'text', wide: true, hint: m.group.metroHint },
      { name: 'direction', label: t.direction, kind: 'select', required: true, options: withCurrent(meta.groupDirections, g.direction) },
      { name: 'status', label: t.status, kind: 'select', required: true, options: withCurrent(meta.groupStatuses, g.status) },
      { name: 'people', label: t.people, kind: 'text', inputMode: 'numeric', placeholder: m.group.peoplePlaceholder },
      {
        name: 'capacity',
        label: t.capacity,
        kind: 'text',
        inputMode: 'numeric',
        placeholder: String(meta.defaultCapacity),
        hint: ru.create.capacityHint(meta.defaultCapacity),
      },
      { name: 'day', label: t.day, kind: 'select', options: withCurrent(ru.create.days, g.day) },
      {
        name: 'time',
        label: t.time,
        kind: 'text',
        placeholder: m.group.timePlaceholder,
        hint: `${m.group.now(g.whenText ?? m.group.notSpecified)} ${keep}`,
      },
      { name: 'composition', label: t.composition, kind: 'multi', wide: true, options: optionsWithPicked(meta.compositions, g.composition ?? '') },
      { name: 'age', label: t.age, kind: 'select', options: withCurrent(meta.ageGroups, g.ageText) },
      { name: 'coordinator', label: t.coordinator, kind: 'select', options: withCurrent(meta.coordinators, g.coordinator) },
      { name: 'feedbackAt', label: t.feedbackAt, kind: 'date', hint: `${feedbackNow(g.verifiedDaysAgo)} ${keep}` },
      { name: 'openedOn', label: t.openedOn, kind: 'date', hint: m.group.openedOnHint },
      { name: 'training', label: t.training, kind: 'text' },
      { name: 'comment', label: t.comment, kind: 'textarea', wide: true },
      { name: 'checked', label: t.checked, kind: 'checkbox', wide: true },
      { name: 'campaignRegistered', label: t.campaignRegistered, kind: 'checkbox', wide: true },
      { name: 'campaignOnly', label: t.campaignOnly, kind: 'checkbox', wide: true },
      { name: 'doNotRefer', label: m.group.doNotRefer, kind: 'checkbox', wide: true, hint: m.group.doNotReferHint },
      { name: 'chamber', label: m.group.chamber, kind: 'checkbox', wide: true, hint: m.group.chamberHint },
    ],
    initial: {
      district: g.district,
      metro: g.metro ?? '',
      direction: g.direction,
      status: g.status,
      people: g.people === null ? '' : String(g.people),
      capacity: g.capacityOwn === null ? '' : String(g.capacityOwn),
      day: g.day ?? '',
      time: '',
      composition: g.composition ?? '',
      age: g.ageText ?? '',
      training: g.training ?? '',
      checked: g.checked ? '1' : '',
      campaignRegistered: g.campaignRegistered ? '1' : '',
      campaignOnly: g.campaignOnly ? '1' : '',
      coordinator: g.coordinator ?? '',
      leaderKey: g.leaderKey ?? '',
      coLeaderKey: g.coLeaderKey ?? '',
      address: g.address ?? '',
      feedbackAt: '',
      openedOn: g.openedOn ?? '',
      comment: g.comment ?? '',
      doNotRefer: g.doNotRefer ? '1' : '',
      chamber: g.chamber ? '1' : '',
    },
  };
}

/** Роли — из справочника ролей галочками (их бывает несколько): уходят номерами через запятую (`roleIds`). */
export function coordinatorEditSpec(c: CoordinatorItem, meta: FormMeta): EditSpec {
  const t = m.coordinator.fields;
  const options = meta.teamRoles.map((r) => String(r.id));
  return {
    fields: [
      // Участник команды — человек из «Людей»: его меняют выбором, а ФИО правят в его карточке (имя следует за ней).
      { name: 'personKey', label: t.name, kind: 'person', required: true, wide: true, allowUnlink: false, legacyName: c.personKey ? null : c.name },
      {
        name: 'roleIds',
        label: t.role,
        kind: 'multi',
        required: true,
        wide: true,
        options,
        labels: Object.fromEntries(meta.teamRoles.map((r) => [String(r.id), r.name])),
        hint: ru.create.coordinatorRoleHint,
      },
    ],
    // В порядке списка, как их складывает `toggleInList`: иначе форма сочла бы неизменённые роли правкой.
    initial: { personKey: c.personKey ?? '', roleIds: options.filter((id) => c.roleIds.includes(Number(id))).join(', ') },
    note: m.coordinator.renameNote,
  };
}
