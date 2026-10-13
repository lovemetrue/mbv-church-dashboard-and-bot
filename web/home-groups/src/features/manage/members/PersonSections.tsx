import { useState } from 'react';
import type { PersonItem } from '@contracts';
import { groupLine } from '../../../entities/format';
import { useGroups } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button, DrawerSection, Modal, Pill } from '../../../shared/ui';
import { DeleteRecord } from '../DeleteRecord';
import { useGuardedClose } from '../EditDialogs';
import { EditForm } from '../EditForm';
import manage from '../Manage.module.css';
import styles from './Members.module.css';
import { personEditSpec } from './personSpec';
import { refreshAfterContact, refreshAfterMembers } from './refresh';

const t = ru.members.person;

/** «Состоит в группах» в карточке человека: коды групп кнопками, которые открывают группу. */
export function PersonGroups({ p }: { p: PersonItem }) {
  const nav = useAppNav();
  const groups = useGroups();
  const byCode = new Map((groups.data?.items ?? []).map((g) => [g.code, g]));
  return (
    <DrawerSection title={t.groupsTitle}>
      {p.groups.length === 0 ? (
        <p className={styles.empty}>{t.groupsNone}</p>
      ) : (
        <div className={styles.codes}>
          {p.groups.map((code) => {
            const g = byCode.get(code);
            // Группы нет в списке (пока грузится или скрыта): код всё равно показываем, но не как кнопку.
            return g ? (
              <Button key={code} size="sm" title={groupLine(g)} aria-label={t.openGroup(code)} onClick={() => nav.openGroup(g.id)}>
                {code}
              </Button>
            ) : (
              <Pill key={code}>{code}</Pill>
            );
          })}
        </div>
      )}
    </DrawerSection>
  );
}

function PersonEditDialog({ p, path, onClose, onSaved }: { p: PersonItem; path: string; onClose: () => void; onSaved: () => void }) {
  const guard = useGuardedClose(onClose);
  return (
    <Modal title={t.editTitle(p.fio)} onClose={guard.close}>
      <EditForm
        spec={personEditSpec(p)}
        path={path}
        onClose={guard.close}
        onSaved={onSaved}
        onBusyChange={guard.setBusy}
        refresh={p.personId === null ? refreshAfterContact : refreshAfterMembers}
      />
    </Modal>
  );
}

/**
 * Правка и удаление карточки. Править можно любого человека: у внесённой вручную (p<id>) данные лежат в самой
 * карточке, у регистрации и человека из заявки (u<id>, r<id>) — в регистрации и заявках, и правка идёт в обе
 * стороны. Удалять можно только внесённую вручную, и только полным входом (кнопку прячет `DeleteRecord`).
 */
export function PersonActions({ p, onDeleted }: { p: PersonItem; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const personId = p.personId;
  const path = personId === null ? `people/${p.key}/update` : `persons/${personId}/update`;
  return (
    <>
      <div className={manage.actions}>
        <Button
          aria-label={t.editAria(p.fio)}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
        >
          {t.edit}
        </Button>
        {personId !== null && (
          <DeleteRecord
            label={t.delete}
            ariaLabel={t.deleteAria(p.fio)}
            title={t.deleteTitle(p.fio)}
            text={t.deleteText}
            path={`persons/${personId}/delete`}
            onDeleted={onDeleted}
          />
        )}
      </div>
      {saved && (
        <p className={manage.saved} role="status">
          {ru.manage.saved}
        </p>
      )}
      {editing && (
        <PersonEditDialog
          p={p}
          path={path}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
        />
      )}
    </>
  );
}
