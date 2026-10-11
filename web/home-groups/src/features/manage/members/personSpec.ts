import type { PersonItem } from '@contracts';
import { formatPhone } from '../../../entities/format';
import { ru } from '../../../shared/i18n/ru';
import type { EditSpec } from '../editSpec';

const f = ru.members.person.fields;

/**
 * Форма правки карточки, внесённой вручную. Заметку сервер в списке людей не отдаёт, поэтому поле пустое и
 * «пишущее»: непустое заменит заметку, пустое не уходит вовсе (пустая строка стёрла бы её в базе).
 */
export function personEditSpec(p: PersonItem): EditSpec {
  return {
    fields: [
      { name: 'fio', label: f.fio, kind: 'text', required: true, wide: true },
      { name: 'phone', label: f.phone, kind: 'text', inputMode: 'tel' },
      { name: 'age', label: f.age, kind: 'text' },
      { name: 'place', label: f.place, kind: 'text', wide: true },
      { name: 'note', label: f.note, kind: 'textarea', wide: true, hint: ru.members.person.noteHint },
    ],
    initial: { fio: p.fio, phone: p.phone ? formatPhone(p.phone) : '', age: p.ageLabel ?? '', place: p.district ?? '', note: '' },
  };
}
