import type { FormMeta } from '@contracts';
import { ru } from '../../shared/i18n/ru';

export interface Option {
  value: string;
  label: string;
}

/** Описание одного поля формы. Имя совпадает с именем поля в теле запроса API. */
export interface FieldSpec {
  name: string;
  label: string;
  /** checkbox — уходит «1», когда отмечен; multi — несколько галочек, одной строкой через запятую (см. `toggleInList`). */
  kind: 'text' | 'date' | 'textarea' | 'select' | 'checkbox' | 'multi';
  required?: boolean;
  /** Для select и multi. */
  options?: Option[];
  /**
   * Выбор в этом поле подставляет значения в другие поля, а само поле на сервер не уходит: так работает
   * «Подобрать из зарегистрированных» — ФИО и телефон потом можно поправить руками.
   */
  fills?: (value: string) => Record<string, string>;
  /**
   * Как `fills`, но само поле тоже уходит на сервер: выбор статуса «Потенциальная» отмечает «40 дней» (их можно
   * снять руками).
   */
  presets?: (value: string) => Record<string, string>;
  /** На всю ширину окна, а не в половину. */
  wide?: boolean;
  /** Пояснение под полем; связано с ним через aria-describedby. */
  hint?: string;
  placeholder?: string;
  inputMode?: 'numeric' | 'tel';
  autoComplete?: string;
  /** Подпись пустого пункта select; по умолчанию «не выбрано» (для обязательных — «выберите…»). */
  emptyLabel?: string;
  /**
   * Поле видно только при этом условии. Скрытое поле не рисуется, не проверяется и не уходит на сервер
   * (физически исключается из тела, а не отправляется пустым): ответ зависит от соседнего поля.
   */
  showWhen?: (values: Record<string, string>) => boolean;
}

export interface FormSpec {
  /** Пояснение над полями. */
  intro?: string;
  fields: FieldSpec[];
  /** Закрытое поле «Адрес»: рисуется отдельным блоком внизу формы. */
  address?: FieldSpec;
  initial: Record<string, string>;
}

/** Статус заявки, при котором человек уже в группе (как `DONE` на сервере). */
const DONE_STATUS = 'Исполнена';

const opts = (list: readonly string[]): Option[] => list.map((v) => ({ value: v, label: v }));

/** Значение по умолчанию берём, только если сервер его знает: иначе он отказал бы в первой же отправке. */
const known = (list: readonly string[], value: string): string => (list.includes(value) ? value : '');

/**
 * Сегодняшняя дата для поля «Дата заявки». Собираем из локальных частей, а не через
 * `toISOString()`: в плюсовом поясе (Москва) утром она бы дала вчерашний день.
 */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Улица и дом, удобные дни и время, хобби, профессия, семья — одни и те же в заявке и регистрации, как в форме правки
 * («Править данные»): по адресу и времени идёт подбор, по остальному ищут группу «своих». Дни — галочками, время —
 * из трёх частей суток: сервер складывает их во фразу «пн, ср вечером», которую понимает подбор.
 */
function personFields(meta: FormMeta, showWhen?: FieldSpec['showWhen']): FieldSpec[] {
  const c = ru.contact.fields;
  const when = showWhen ? { showWhen } : {};
  return [
    { name: 'address', label: c.address, kind: 'text', wide: true, placeholder: c.addressPlaceholder, autoComplete: 'off', ...when },
    { name: 'days', label: c.days, kind: 'multi', wide: true, options: meta.scheduleDays, ...when },
    { name: 'time', label: c.time, kind: 'select', options: meta.scheduleTimes, emptyLabel: c.timeAny, ...when },
  ];
}

/** Хобби, профессия и семья: необязательные, без условий — их спрашивают у всех. */
function profileFields(): FieldSpec[] {
  const c = ru.contact.fields;
  return [
    { name: 'hobby', label: c.hobby, kind: 'text', autoComplete: 'off' },
    { name: 'profession', label: c.profession, kind: 'text', autoComplete: 'off' },
    { name: 'family', label: c.family, kind: 'text', wide: true, autoComplete: 'off' },
  ];
}

export function requestSpec(meta: FormMeta, now: Date = new Date()): FormSpec {
  const t = ru.create.requestFields;
  const types = meta.requestTypes.map((x) => ({ value: x.value, label: x.label }));
  return {
    fields: [
      { name: 'fio', label: t.fio, kind: 'text', required: true, wide: true, autoComplete: 'off' },
      { name: 'type', label: t.type, kind: 'select', required: true, options: types, hint: ru.create.requestTypeHint },
      { name: 'status', label: t.status, kind: 'select', required: true, options: opts(meta.requestStatuses) },
      { name: 'phone', label: t.phone, kind: 'text', inputMode: 'tel', autoComplete: 'off' },
      { name: 'age', label: t.age, kind: 'select', options: opts(meta.ageGroups) },
      { name: 'place', label: t.place, kind: 'text', wide: true, autoComplete: 'off' },
      ...personFields(meta),
      ...profileFields(),
      { name: 'requestedAt', label: t.requestedAt, kind: 'date' },
      { name: 'responsible', label: t.responsible, kind: 'select', options: opts(meta.coordinators) },
      { name: 'source', label: t.source, kind: 'text', wide: true, autoComplete: 'off' },
      // Куда человек уже ходит — только у исполненной заявки: так она сразу попадает в состав группы. У открытой
      // заявки группу выбирает подбор («Утвердить»), и второе поле о том же разошлось бы с ним. Поэтому и
      // текстового «Ходит в группу» из таблицы в форме нет: это то же самое, только без связи с группой.
      {
        name: 'groupId',
        label: t.groupId,
        kind: 'select',
        wide: true,
        options: meta.groups.map((g) => ({ value: String(g.id), label: `${g.leader} · ${g.code}` })),
        emptyLabel: ru.create.groupNotSet,
        showWhen: (v) => v['status'] === DONE_STATUS,
      },
      // Дальше — поля из таблицы церкви, как в форме старого дашборда: по ним служители ведут заявку вручную.
      { name: 'ministry', label: t.ministry, kind: 'text', autoComplete: 'off' },
      // Рекомендация — имя ведущего, как в таблице, а не номер: выбор из списка, чтобы не отправить человека не туда из-за опечатки.
      {
        name: 'recommended',
        label: t.recommended,
        kind: 'select',
        options: uniqueLeaders(meta.groups).map((v) => ({ value: v, label: v })),
        emptyLabel: ru.create.groupNotRecommended,
      },
      { name: 'recommendedAt', label: t.recommendedAt, kind: 'date' },
      { name: 'attendance', label: t.attendance, kind: 'text', autoComplete: 'off' },
      { name: 'cancelReason', label: t.cancelReason, kind: 'text', wide: true, autoComplete: 'off' },
      { name: 'note', label: t.note, kind: 'textarea', wide: true },
      { name: 'extra', label: t.extra, kind: 'textarea', wide: true },
    ],
    initial: {
      type: known(types.map((x) => x.value), 'join_group'),
      status: known(meta.requestStatuses, 'Новая'),
      requestedAt: todayIso(now),
      source: ru.create.defaultSource,
    },
  };
}

/** Ведущие без повторов: у одного человека бывает две группы, а рекомендуют его по имени. */
const uniqueLeaders = (groups: FormMeta['groups']): string[] => [...new Set(groups.map((g) => g.leader))];

export function groupSpec(meta: FormMeta): FormSpec {
  const t = ru.create.groupFields;
  const fields: FieldSpec[] = [
    { name: 'leader', label: t.leader, kind: 'text', required: true, wide: true, autoComplete: 'off' },
    { name: 'district', label: t.district, kind: 'select', required: true, options: opts(meta.districts) },
    { name: 'format', label: t.format, kind: 'select', required: true, options: opts(meta.groupFormats) },
    {
      name: 'status',
      label: t.status,
      kind: 'select',
      required: true,
      options: opts(meta.groupStatuses),
      // Потенциальная группа по умолчанию участвует в «40 днях» (просьба служителей); сервер делает так же, если галочки нет.
      presets: (v): Record<string, string> => (v === 'Потенциальная' ? { campaignRegistered: '1' } : {}),
    },
    { name: 'phone', label: t.phone, kind: 'text', inputMode: 'tel', autoComplete: 'off' },
    { name: 'coLeader', label: t.coLeader, kind: 'text', autoComplete: 'off' },
    { name: 'coLeaderPhone', label: t.coLeaderPhone, kind: 'text', inputMode: 'tel', autoComplete: 'off' },
    { name: 'age', label: t.age, kind: 'select', options: opts(meta.ageGroups) },
    { name: 'composition', label: t.composition, kind: 'multi', wide: true, options: opts(meta.compositions) },
    { name: 'metro', label: t.metro, kind: 'text', autoComplete: 'off' },
    { name: 'day', label: t.day, kind: 'select', options: opts(ru.create.days) },
    { name: 'time', label: t.time, kind: 'text', placeholder: ru.create.timePlaceholder, autoComplete: 'off' },
    { name: 'people', label: t.people, kind: 'text', inputMode: 'numeric', placeholder: ru.create.peoplePlaceholder, autoComplete: 'off' },
    {
      name: 'capacity',
      label: t.capacity,
      kind: 'text',
      inputMode: 'numeric',
      placeholder: String(meta.defaultCapacity),
      hint: ru.create.capacityHint(meta.defaultCapacity),
      autoComplete: 'off',
    },
    { name: 'coordinator', label: t.coordinator, kind: 'select', options: opts(meta.coordinators) },
    { name: 'training', label: t.training, kind: 'text', autoComplete: 'off' },
    { name: 'feedbackAt', label: t.feedbackAt, kind: 'date' },
    { name: 'comment', label: t.comment, kind: 'textarea', wide: true },
    { name: 'checked', label: t.checked, kind: 'checkbox' },
    { name: 'campaignRegistered', label: t.campaignRegistered, kind: 'checkbox' },
    { name: 'campaignOnly', label: t.campaignOnly, kind: 'checkbox' },
  ];
  // Готовых вести группу из бота можно выбрать: ФИО и телефон подставятся и останутся правимыми.
  // Список пуст — поле не рисуем: выбирать не из кого.
  if (meta.leaderCandidates.length > 0) {
    fields.splice(1, 0, {
      name: 'leaderCandidate',
      label: t.leaderCandidate,
      kind: 'select',
      wide: true,
      options: meta.leaderCandidates.map((c) => ({ value: String(c.id), label: c.label })),
      emptyLabel: ru.create.leaderCandidateEmpty,
      fills: (value) => {
        const c = meta.leaderCandidates.find((x) => String(x.id) === value);
        return c ? { leader: c.fullName, ...(c.phone ? { phone: c.phone } : {}) } : {};
      },
    });
  }
  return {
    fields,
    address: { name: 'address', label: t.address, kind: 'text', wide: true, autoComplete: 'off' },
    initial: { status: known(meta.groupStatuses, 'Функционирует') },
  };
}

/** Координатор: ФИО и роль из справочника ролей (уходит номером роли, а не словами). */
export function coordinatorSpec(meta: FormMeta): FormSpec {
  const t = ru.create.coordinatorFields;
  return {
    fields: [
      { name: 'name', label: t.name, kind: 'text', required: true, wide: true, autoComplete: 'off' },
      {
        name: 'roleId',
        label: t.role,
        kind: 'select',
        required: true,
        wide: true,
        options: meta.teamRoles.map((r) => ({ value: String(r.id), label: r.name })),
        hint: ru.create.coordinatorRoleHint,
      },
    ],
    initial: {},
  };
}

/**
 * Ответы про Малую группу, после которых анкета бота задаёт следующий вопрос: «уже состоит» —
 * кто ведущий, «готов открыть / дать дом / хочет присоединиться» — район и возраст. «Ведёт» и пустой
 * ответ вопросов не добавляют. Значения — коды сервера (`MDG_STATUSES`), не подписи.
 */
const MDG_ASKS_LEADER: readonly string[] = ['member'];
const MDG_ASKS_PLACE: readonly string[] = ['open', 'home', 'join'];

/** Регистрация участника: для тех, кто заполнил анкету на бумаге и своего чата с ботом не имеет. */
export function registrationSpec(meta: FormMeta): FormSpec {
  const t = ru.create.registration.fields;
  const r = ru.create.registration;
  const c = ru.contact.fields;
  return {
    intro: r.lead,
    fields: [
      { name: 'fio', label: t.fio, kind: 'text', required: true, wide: true, autoComplete: 'off' },
      { name: 'phone', label: t.phone, kind: 'text', required: true, inputMode: 'tel', autoComplete: 'off' },
      { name: 'church', label: t.church, kind: 'select', options: opts(meta.churches), emptyLabel: r.churchEmpty },
      {
        name: 'mdgStatus',
        label: t.mdgStatus,
        kind: 'select',
        wide: true,
        options: meta.mdgStatuses.map((x) => ({ value: x.value, label: x.label })),
        emptyLabel: r.mdgEmpty,
        hint: r.mdgHint,
      },
      {
        name: 'leaderName',
        label: t.leaderName,
        kind: 'text',
        wide: true,
        autoComplete: 'off',
        showWhen: (v) => MDG_ASKS_LEADER.includes(v['mdgStatus'] ?? ''),
      },
      {
        name: 'location',
        label: t.location,
        kind: 'text',
        autoComplete: 'off',
        showWhen: (v) => MDG_ASKS_PLACE.includes(v['mdgStatus'] ?? ''),
      },
      {
        name: 'age',
        label: t.age,
        kind: 'select',
        options: opts(meta.ageGroups),
        showWhen: (v) => MDG_ASKS_PLACE.includes(v['mdgStatus'] ?? ''),
      },
      // Те же вопросы, что бот задаёт после возраста («Когда удобно?», «Где живёте?»): по ним идёт подбор группы,
      // и человек с бумажной анкетой не должен попадать в подбор хуже, чем записавшийся через бот.
      ...personFields(meta, (v) => MDG_ASKS_PLACE.includes(v['mdgStatus'] ?? '')),
      ...profileFields(),
      { name: 'preferredContact', label: t.preferredContact, kind: 'text', wide: true, autoComplete: 'off' },
      { name: 'comment', label: t.comment, kind: 'textarea', wide: true },
    ],
    initial: {},
  };
}
