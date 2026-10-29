import { useCanChange } from '../../../shared/access';
import { useState } from 'react';
import type { GroupItem, GroupMember, PersonItem } from '@contracts';
import { formatPhone } from '../../../entities/format';
import { usePeople } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { AgeTag, Button, DrawerSection, Pill, StrangeBadge } from '../../../shared/ui';
import manage from '../Manage.module.css';
import { AddMemberDialog } from './AddMemberDialog';
import { MemberEditDialog, MemberRemoveDialog } from './MemberDialogs';
import { formatDayMonth, formatDayMonthYear } from './model';
import styles from './Members.module.css';

const t = ru.members;

/**
 * Где живёт человек — строкой под телефоном: адрес и район из его карточки в «Людях». Без того и другого — «район, метро,
 * ориентир», как он написал. Контакты чужих людей сервер уже скрыл, здесь только показываем, что пришло.
 */
function whereText(p: PersonItem | undefined): string {
  if (!p) return '';
  const where = [p.address, p.district].filter(Boolean).join(' · ');
  return where || (p.place ?? '');
}

/** ФИО кнопкой: открывает карточку человека рядом с группой, а не уводит в «Люди» — так их удобно сверять. */
function PersonName({ fio, personKey, active }: { fio: string; personKey: string | null; active: boolean }) {
  const nav = useAppNav();
  if (!personKey) return <b className={styles.name}>{fio}</b>;
  return (
    <button type="button" className={styles.name} title={t.openPerson} aria-pressed={active} onClick={() => (active ? nav.closePeek() : nav.peekPerson(personKey))}>
      {fio}
    </button>
  );
}

function MemberRow({
  m,
  person,
  linkable,
  active,
  canChange,
  onEdit,
  onRemove,
}: {
  m: GroupMember;
  /** Карточка человека из «Людей» — возраст и адрес; нет её (справочник не пришёл) — строки просто короче. */
  person: PersonItem | undefined;
  linkable: boolean;
  /** Его карточка сейчас открыта рядом. */
  active: boolean;
  canChange: boolean;
  onEdit: (m: GroupMember) => void;
  onRemove: (m: GroupMember) => void;
}) {
  const nav = useAppNav();
  const when = m.kind === 'placed' ? formatDayMonth(m.date) : formatDayMonthYear(m.date);
  const whenText = when ? (m.kind === 'placed' ? t.placedOn(when) : t.joinedOn(when)) : '';
  const where = whereText(person);
  return (
    <li className={styles.row} data-active={active || undefined}>
      <div className={styles.who}>
        <PersonName fio={m.fio} personKey={linkable ? m.personKey : null} active={active} />
        {person?.ageLabel && <AgeTag>{person.ageLabel}</AgeTag>}
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
      {where && <p className={styles.meta}>{where}</p>}
      {m.note && <p className={styles.rowNote}>{m.note}</p>}
      <div className={styles.rowActions}>
        {m.kind === 'placed' ? (
          // Направленных утвердила заявка, поэтому и менять их надо там: здесь только переход.
          <Button size="sm" aria-label={t.openRequestAria(m.fio)} onClick={() => nav.openRequest(m.id)}>
            {t.openRequest}
          </Button>
        ) : (
          canChange && <>
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
  const nav = useAppNav();
  const people = usePeople();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [saved, setSaved] = useState(false);
  const canChange = useCanChange();

  // Ведущий и соведущий — тоже люди группы: они в составе первыми, по ссылкам группы (миграции 030 и 054), а не копией.
  // Внесённый ещё и участником показывается один раз — строкой ведущего.
  type Leader = { role: string; fio: string; key: string | null };
  const leaders = ([
    g.leader ? { role: t.leaderRole, fio: g.leader, key: g.leaderKey } : null,
    g.coLeader ? { role: t.coLeaderRole, fio: g.coLeader, key: g.coLeaderKey } : null,
  ] as (Leader | null)[]).filter((x): x is Leader => x !== null);
  const leaderKeys = new Set(leaders.map((l) => l.key).filter(Boolean));
  const members = g.members.filter((m) => !leaderKeys.has(m.personKey));
  const placed = members.filter((m) => m.kind === 'placed');
  const manual = members.filter((m) => m.kind === 'manual');
  // Пока справочник людей не пришёл, имя уже кнопка; нет человека в справочнике — просто текст (карточки открывать не из чего).
  const byKey = people.data ? new Map(people.data.items.map((p) => [p.key, p])) : null;
  const rows = (list: GroupMember[]) =>
    list.map((m) => (
      <MemberRow
        key={`${m.kind}-${m.id}`}
        m={m}
        person={byKey?.get(m.personKey)}
        active={nav.peekKey === m.personKey}
        canChange={canChange}
        linkable={byKey === null || byKey.has(m.personKey)}
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
    <DrawerSection title={t.sectionTitle(leaders.length + members.length)}>
      {leaders.length > 0 && (
        <>
          <h4 className={styles.sub}>{t.leadersTitle}</h4>
          <ul className={styles.list} aria-label={t.leadersTitle}>
            {leaders.map((l) => {
              const p = l.key ? byKey?.get(l.key) : undefined;
              const where = whereText(p);
              const active = l.key !== null && nav.peekKey === l.key;
              return (
                <li key={l.role} className={styles.row} data-active={active || undefined}>
                  <div className={styles.who}>
                    <PersonName fio={l.fio} personKey={l.key} active={active} />
                    {p?.ageLabel && <AgeTag>{p.ageLabel}</AgeTag>}
                    {/* Ведущий, внесённый и участником, показан строкой ведущего — метку участника он не теряет. */}
                    <StrangeBadge mark={g.members.find((m) => l.key && m.personKey === l.key)?.strange ?? null} />
                  </div>
                  <p className={styles.meta}>
                    {l.role}
                    {p?.phone && (
                      <>
                        {' · '}
                        <span className="num">{formatPhone(p.phone)}</span>
                      </>
                    )}
                  </p>
                  {where && <p className={styles.meta}>{where}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {leaders.length + members.length === 0 && <p className={styles.empty}>{t.empty}</p>}
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
      {canChange && (
        <div className={styles.addRow}>
          <Button aria-label={t.addAria} onClick={() => setAdding(true)}>
            <span aria-hidden="true">+ </span>
            {t.add}
          </Button>
        </div>
      )}
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
