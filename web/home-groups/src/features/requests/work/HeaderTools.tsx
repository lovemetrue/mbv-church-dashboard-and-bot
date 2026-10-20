import { useState } from 'react';
import { ArrowOut, ContactEditDialog, IconButton, Pencil, PhoneTools } from '../../contact';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { isOpenSubject } from './WorkPlace';
import type { WorkSubject } from './subject';

const w = ru.requests.work;
const c = ru.contact;

/**
 * Значки в шапке карточки заявки: правка данных (карандаш), звонок, письмо, копирование номера (общие с карточкой группы,
 * см. `PhoneTools`) и переход в выбранную группу.
 */
export function HeaderTools({ subject, group }: { subject: WorkSubject; group?: { id: number; code: string } | null }) {
  const nav = useAppNav();
  const [editing, setEditing] = useState(false);

  return (
    <>
      {isOpenSubject(subject) && (
        <IconButton label={c.editAria(subject.fio)} onClick={() => setEditing(true)}>
          <Pencil />
        </IconButton>
      )}
      <PhoneTools phone={subject.phone} name={subject.fio} noPhone={isOpenSubject(subject) ? w.noPhone : w.noPhoneClosed} />
      {group && (
        <IconButton label={c.openGroup(group.code)} onClick={() => nav.openGroup(group.id)}>
          <ArrowOut />
        </IconButton>
      )}
      {editing && (
        <ContactEditDialog
          title={c.editTitle(subject.fio)}
          values={subject}
          path={`requests/${subject.id}/edit`}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  );
}
