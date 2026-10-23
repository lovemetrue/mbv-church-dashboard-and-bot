import { useState } from 'react';
import type { CoordinatorItem, GroupItem } from '@contracts';
import { groupLabel } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Button, DrawerSection } from '../../shared/ui';
import { IconButton, Pencil, PhoneTools } from '../contact/ContactTools';
import { DeleteRecord } from './DeleteRecord';
import { CoordinatorEditDialog, GroupEditDialog } from './EditDialogs';
import styles from './Manage.module.css';
import { useCanDelete } from './useManage';

const m = ru.manage;

/**
 * «Править» и «Удалить» в карточке записи. Подтверждение «Изменения сохранены» живёт здесь, а не в
 * окне: окно после сохранения закрывается, а результат нельзя оставлять только в данных на экране.
 */
function Actions({
  editAria,
  edit,
  remove,
}: {
  editAria: string;
  edit: (close: () => void, saved: () => void) => React.ReactNode;
  remove: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <div className={styles.actions}>
        <Button
          aria-label={editAria}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
        >
          {m.edit}
        </Button>
        {remove}
      </div>
      {saved && (
        <p className={styles.saved} role="status">
          {m.saved}
        </p>
      )}
      {editing &&
        edit(
          () => setEditing(false),
          () => {
            setEditing(false);
            setSaved(true);
          },
        )}
    </>
  );
}

/**
 * Значки в шапке карточки группы, как у заявки: правка (карандаш), затем звонок, письмо и копирование номера ведущего.
 * Подтверждение «Изменения сохранены» — здесь же: окно после сохранения закрывается, а результат нельзя оставлять только
 * в данных на экране.
 */
export function GroupHeaderTools({ g }: { g: GroupItem }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <IconButton
        label={m.group.editAria(groupLabel(g))}
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        <Pencil />
      </IconButton>
      <PhoneTools phone={g.phone} name={g.leader} noPhone={m.group.noPhone} hiddenHint={g.contactsHidden ? m.group.phonesHidden : undefined} />
      {saved && (
        <span className={styles.saved} role="status">
          {m.saved}
        </span>
      )}
      {editing && (
        <GroupEditDialog
          g={g}
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

/** «Удалить» в карточке группы (правка — карандашом в шапке). После удаления карточка закрывается: записи в списке больше нет. */
export function GroupActions({ g, onDeleted }: { g: GroupItem; onDeleted: () => void }) {
  const label = groupLabel(g);
  return (
    <div className={styles.actions}>
      <DeleteRecord ariaLabel={m.group.deleteAria(label)} title={m.group.deleteTitle(label)} path={`groups/${g.id}/delete`} onDeleted={onDeleted} />
    </div>
  );
}

export function CoordinatorActions({ c, onDeleted }: { c: CoordinatorItem; onDeleted: () => void }) {
  return (
    <Actions
      editAria={m.coordinator.editAria(c.name)}
      edit={(close, saved) => <CoordinatorEditDialog c={c} onClose={close} onSaved={saved} />}
      remove={
        <DeleteRecord
          ariaLabel={m.coordinator.deleteAria(c.name)}
          title={m.coordinator.deleteTitle(c.name)}
          path={`coordinators/${c.id}/delete`}
          onDeleted={onDeleted}
        />
      }
    />
  );
}

/**
 * «Удалить заявку» в самом конце карточки заявки: после журнала, подальше от рабочих кнопок.
 * Раздела нет вовсе, если вход не полный: пустой раздел оставил бы в карточке голую линию.
 * `onDeleted` закрывает карточку.
 */
export function DeleteRequestSection({ id, fio, onDeleted }: { id: number; fio: string; onDeleted: () => void }) {
  const canDelete = useCanDelete();
  if (!canDelete) return null;
  return (
    <DrawerSection>
      <div className={styles.actions}>
        <DeleteRecord
          label={m.request.delete}
          ariaLabel={m.request.deleteAria(fio)}
          title={m.request.deleteTitle(fio)}
          path={`requests/${id}/delete`}
          onDeleted={onDeleted}
        />
      </div>
    </DrawerSection>
  );
}

/**
 * «Удалить регистрацию» в конце карточки человека. Только для участника (есть `userId`): у заявки из таблицы
 * регистрации нет, стирать нечего. Удаление необратимо и уносит заявки и рассылки человека, поэтому в окне
 * подтверждения так и сказано. Раздела нет вовсе, если вход не полный. `onDeleted` закрывает карточку.
 */
export function DeletePersonSection({ userId, fio, onDeleted }: { userId: number | null; fio: string; onDeleted: () => void }) {
  const canDelete = useCanDelete();
  if (!canDelete || userId === null) return null;
  return (
    <DrawerSection>
      <div className={styles.actions}>
        <DeleteRecord
          label={m.person.delete}
          ariaLabel={m.person.deleteAria(fio)}
          title={m.person.deleteTitle(fio)}
          text={m.person.deleteText}
          path={`people/${userId}/delete`}
          onDeleted={onDeleted}
        />
      </div>
    </DrawerSection>
  );
}
