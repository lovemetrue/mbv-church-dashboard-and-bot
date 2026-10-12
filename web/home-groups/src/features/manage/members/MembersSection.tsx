import { useState } from 'react';
import type { GroupItem, GroupMember } from '@contracts';
import { formatPhone } from '../../../entities/format';
import { usePeople } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button, DrawerSection, Pill, StrangeBadge } from '../../../shared/ui';
import manage from '../Manage.module.css';
import { AddMemberDialog } from './AddMemberDialog';
import { MemberEditDialog, MemberRemoveDialog } from './MemberDialogs';
import { formatDayMonth, formatDayMonthYear } from './model';
import styles from './Members.module.css';

const t = ru.members;

function MemberRow({
  m,
  linkable,
  onEdit,
  onRemove,
}: {
  m: GroupMember;
  linkable: boolean;
  onEdit: (m: GroupMember) => void;
  onRemove: (m: GroupMember) => void;
}) {
  const nav = useAppNav();
  const when = m.kind === 'placed' ? formatDayMonth(m.date) : formatDayMonthYear(m.date);
  const whenText = when ? (m.kind === 'placed' ? t.placedOn(when) : t.joinedOn(when)) : '';
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        {linkable ? (
          <button type="button" className={styles.name} title={t.openPerson} onClick={() => nav.openPerson(m.personKey)}>
            {m.fio}
          </button>
        ) : (
          <b className={styles.name}>{m.fio}</b>
        )}
        <StrangeBadge mark={m.strange} />
        {m.alsoIn.length > 0 && (
          // Подсказка на обёртке: у плашки своего title нет. Метка — повод проверить, не дубль ли это.
          <span title={t.alsoInHint}>
            <Pill tone="warn">{t.alsoIn(m.alsoIn.join(', '))}</Pill>
          </span>
        )}
      </div>
      {(m.phone || whenText) && (
        <p className={styles.meta}>
          {m.phone && <span className="num">{formatPhone(m.phone)}</span>}
          {m.phone && whenText && ' · '}
          {whenText}
        </p>
      )}
      {m.note && <p className={styles.rowNote}>{m.note}</p>}
      <div className={styles.rowActions}>
        {m.kind === 'placed' ? (
          // Направленных утвердила заявка, поэтому и менять их надо там: здесь только переход.
          <Button size="sm" aria-label={t.openRequestAria(m.fio)} onClick={() => nav.openRequest(m.id)}>
            {t.openRequest}
          </Button>
        ) : (
          <>
            <Button size="sm" aria-label={t.editAria(m.fio)} onClick={() => onEdit(m)}>
              {t.edit}
            </Button>
            <Button size="sm" aria-label={t.removeAria(m.fio)} onClick={() => onRemove(m)}>
              {t.remove}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * «Состав» в карточке группы: кто в группе, откуда он взялся и что с этим можно сделать. Направленные
 * через сервис (`placed`) только читаются, внесённые вручную (`manual`) правятся и убираются здесь.
 */
export function MembersSection({ g }: { g: GroupItem }) {
  const people = usePeople();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [saved, setSaved] = useState(false);

  const placed = g.members.filter((m) => m.kind === 'placed');
  const manual = g.members.filter((m) => m.kind === 'manual');
  // Пока справочник людей не пришёл, имя уже кнопка; нет человека в справочнике — просто текст (карточки открывать не из чего).
  const known = people.data ? new Set(people.data.items.map((p) => p.key)) : null;
  const rows = (list: GroupMember[]) =>
    list.map((m) => (
      <MemberRow
        key={`${m.kind}-${m.id}`}
        m={m}
        linkable={known === null || known.has(m.personKey)}
        onEdit={(x) => {
          setSaved(false);
          setEditing(x);
        }}
        onRemove={(x) => {
          setSaved(false);
          setRemoving(x);
        }}
      />
    ));

  return (
    <DrawerSection title={t.sectionTitle(g.members.length)}>
      {g.members.length === 0 && <p className={styles.empty}>{t.empty}</p>}
      {placed.length > 0 && (
        <>
          <h4 className={styles.sub}>{t.placedTitle}</h4>
          <p className={styles.hint}>{t.placedHint}</p>
          <ul className={styles.list} aria-label={t.placedTitle}>
            {rows(placed)}
          </ul>
        </>
      )}
      {manual.length > 0 && (
        <>
          <h4 className={styles.sub}>{t.manualTitle}</h4>
          <ul className={styles.list} aria-label={t.manualTitle}>
            {rows(manual)}
          </ul>
        </>
      )}
      <div className={styles.addRow}>
        <Button aria-label={t.addAria} onClick={() => setAdding(true)}>
          <span aria-hidden="true">+ </span>
          {t.add}
        </Button>
      </div>
      {saved && (
        <p className={manage.saved} role="status">
          {ru.manage.saved}
        </p>
      )}
      {adding && <AddMemberDialog g={g} onClose={() => setAdding(false)} />}
      {editing && (
        <MemberEditDialog
          m={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaved(true);
          }}
        />
      )}
      {removing && <MemberRemoveDialog m={removing} onClose={() => setRemoving(null)} onRemoved={() => setRemoving(null)} />}
    </DrawerSection>
  );
}
