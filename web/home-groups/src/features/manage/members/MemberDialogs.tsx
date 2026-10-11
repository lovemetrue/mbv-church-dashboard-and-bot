import { useRef, useState } from 'react';
import type { GroupMember } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button, Modal } from '../../../shared/ui';
import { DangerButton } from '../DeleteRecord';
import { useGuardedClose } from '../EditDialogs';
import { EditForm } from '../EditForm';
import type { EditSpec } from '../editSpec';
import manage from '../Manage.module.css';
import { todayIso } from './model';
import { refreshAfterMembers, useMemberAction } from './refresh';

const t = ru.members;

/** Правятся только дата и заметка: имя и телефон человека живут в его карточке, а не в составе. */
export function memberEditSpec(m: GroupMember): EditSpec {
  return {
    fields: [
      // Не позже сегодняшнего дня: сервер такую дату всё равно отклонил бы.
      { name: 'joinedOn', label: t.editDialog.joinedOn, kind: 'date', max: todayIso() },
      { name: 'note', label: t.editDialog.note, kind: 'textarea', wide: true },
    ],
    // Дата приходит ISO; при времени в хвосте поле даты её бы не приняло.
    initial: { joinedOn: (m.date ?? '').slice(0, 10), note: m.note ?? '' },
    note: t.editDialog.hint,
  };
}

export function MemberEditDialog({ m, onClose, onSaved }: { m: GroupMember; onClose: () => void; onSaved: () => void }) {
  const guard = useGuardedClose(onClose);
  return (
    <Modal title={t.editDialog.title(m.fio)} onClose={guard.close}>
      <EditForm
        spec={memberEditSpec(m)}
        path={`members/${m.id}/update`}
        onClose={guard.close}
        onSaved={onSaved}
        onBusyChange={guard.setBusy}
        refresh={refreshAfterMembers}
      />
    </Modal>
  );
}

/**
 * Убрать из состава: запись скрывается, а карточка человека в справочнике остаётся. Подтверждение нужно,
 * потому что вернуть человека можно только внеся заново. Пока идёт запрос, окно не закрывается.
 */
export function MemberRemoveDialog({ m, onClose, onRemoved }: { m: GroupMember; onClose: () => void; onRemoved: () => void }) {
  const { run, busy } = useMemberAction();
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function confirm() {
    setError(null);
    const result = await run(`members/${m.id}/delete`, {});
    // null — повторное нажатие, пока первый запрос не закончился: ответит первый.
    if (result === null) return;
    if (result.ok) onRemoved();
    else setError(result.message);
  }

  return (
    <Modal title={t.removeDialog.title(m.fio)} onClose={() => !busyRef.current && onClose()}>
      <p className={manage.confirm}>{t.removeDialog.text}</p>
      {error && (
        <p className={manage.formError} role="alert">
          {error}
        </p>
      )}
      <div className={`${manage.foot} ${manage.footStatic}`}>
        <Button onClick={onClose} disabled={busy}>
          {ru.manage.cancel}
        </Button>
        <DangerButton solid disabled={busy} onClick={() => void confirm()}>
          {busy ? t.removeDialog.working : t.removeDialog.confirm}
        </DangerButton>
      </div>
    </Modal>
  );
}
