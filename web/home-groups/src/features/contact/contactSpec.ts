import { formatPhone } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import type { EditSpec } from '../manage/editSpec';

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
}

/** Порядок и подписи полей — единственное место: форма правки у людей и у заявок строится только отсюда. */
export function contactEditSpec(v: ContactValues): EditSpec {
  return {
    fields: [
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
    ],
    initial: {
      fio: v.fio,
      phone: v.phone ? formatPhone(v.phone) : '',
      age: v.ageLabel ?? '',
      place: v.place ?? '',
      address: v.address ?? '',
      schedule: v.schedule ?? '',
      hobby: v.hobby ?? '',
      profession: v.profession ?? '',
      family: v.family ?? '',
      note: v.note ?? '',
    },
    note: f.sharedHint,
  };
}
