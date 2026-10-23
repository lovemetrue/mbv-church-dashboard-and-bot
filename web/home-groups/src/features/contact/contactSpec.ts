import type { RequestTableFields } from '@contracts';
import { formatPhone } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import type { EditField, EditSpec } from '../manage/editSpec';

const f = ru.contact.fields;

/**
 * Данные человека так, как их показывают и правят: одно и то же у карточки в «Людях» и у заявки. Любая запись, у которой
 * есть эти поля (`PersonItem`, `WorkSubject`), подходит как есть, поэтому форма не знает, откуда её открыли.
 */
export interface ContactValues {
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  place: string | null;
  address: string | null;
  schedule: string | null;
  hobby: string | null;
  profession: string | null;
  family: string | null;
  note: string | null;
  /** Только у заявки: поля из таблицы церкви. У человека в «Людях» их нет, и форма их не рисует. */
  table?: RequestTableFields;
  /** Контакты скрыты сервером (запись не своя): полей с ними в форме нет, иначе маска затёрла бы настоящий номер. */
  contactsHidden?: boolean;
}

/** Поля, которых при скрытых контактах в форме нет: сервер их не прислал. */
const HIDDEN_CONTACT_FIELDS: ReadonlySet<string> = new Set(['phone', 'address', 'hobby', 'profession', 'family']);

/** Порядок и подписи полей — единственное место: формы правки и добавления человека строятся только отсюда. */
export const CONTACT_FIELD_DEFS: EditField[] = [
  { name: 'fio', label: f.fio, kind: 'text', required: true, wide: true },
  { name: 'phone', label: f.phone, kind: 'text', inputMode: 'tel', placeholder: f.phonePlaceholder },
  { name: 'age', label: f.age, kind: 'text', placeholder: f.agePlaceholder },
  { name: 'place', label: f.place, kind: 'text', wide: true, placeholder: f.placePlaceholder },
  { name: 'address', label: f.address, kind: 'text', wide: true, placeholder: f.addressPlaceholder },
  { name: 'schedule', label: f.schedule, kind: 'text', wide: true, placeholder: f.schedulePlaceholder },
  { name: 'hobby', label: f.hobby, kind: 'text' },
  { name: 'profession', label: f.profession, kind: 'text' },
  { name: 'family', label: f.family, kind: 'text', wide: true },
  { name: 'note', label: f.note, kind: 'textarea', wide: true },
];

export type ContactName = 'fio' | 'phone' | 'age' | 'place' | 'address' | 'schedule' | 'hobby' | 'profession' | 'family' | 'note';

const rf = ru.create.requestFields;

/**
 * Поля заявки из таблицы церкви — как в строке заявки старого дашборда. Это свойство самой заявки, а не человека:
 * сервер не переносит их в регистрацию и другие его заявки.
 */
const TABLE_FIELD_DEFS: EditField[] = [
  { name: 'source', label: rf.source, kind: 'text' },
  { name: 'ministry', label: rf.ministry, kind: 'text' },
  { name: 'recommended', label: rf.recommended, kind: 'text' },
  { name: 'recommendedAt', label: rf.recommendedAt, kind: 'date' },
  { name: 'attendance', label: rf.attendance, kind: 'text' },
  { name: 'extra', label: rf.extra, kind: 'textarea', wide: true },
];

export function contactEditSpec(v: ContactValues): EditSpec {
  const t = v.table;
  const all = t ? [...CONTACT_FIELD_DEFS, ...TABLE_FIELD_DEFS] : CONTACT_FIELD_DEFS;
  return {
    fields: v.contactsHidden ? all.filter((x) => !HIDDEN_CONTACT_FIELDS.has(x.name)) : all,
    initial: {
      ...(t
        ? {
            source: t.source ?? '',
            ministry: t.ministry ?? '',
            recommended: t.recommended ?? '',
            recommendedAt: t.recommendedAt ?? '',
            attendance: t.attendance ?? '',
            extra: t.extra ?? '',
          }
        : {}),
      fio: v.fio,
      phone: v.phone ? formatPhone(v.phone) : '',
      age: v.ageLabel ?? '',
      place: v.place ?? '',
      address: v.address ?? '',
      schedule: v.schedule ?? '',
      hobby: v.hobby ?? '',
      profession: v.profession ?? '',
      family: v.family ?? '',
      // У заявки показ склеивает заметку с «Дополнительно»; править надо порознь, иначе сохранение заметки задвоило бы «Дополнительно».
      note: (t ? t.note : v.note) ?? '',
    },
    note: v.contactsHidden ? `${f.sharedHint} ${f.contactsHidden}` : f.sharedHint,
  };
}
