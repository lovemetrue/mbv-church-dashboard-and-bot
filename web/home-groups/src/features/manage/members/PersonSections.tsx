import { useCanChange, useCanEditGroups } from '../../../shared/access';
import { useState } from 'react';
import type { GroupItem, PersonItem } from '@contracts';
import { groupLine } from '../../../entities/format';
import { useGroups } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button, DrawerSection, Pill } from '../../../shared/ui';
import { DeleteRecord } from '../DeleteRecord';
import { ContactEditDialog } from '../../contact';
import { IconButton, Pencil, PhoneTools } from '../../contact/ContactTools';
import { AddToGroupDialog, type MoveFrom } from './AddToGroupDialog';
import manage from '../Manage.module.css';
import styles from './Members.module.css';

const t = ru.members.person;

/** Код группы кнопкой, которая открывает группу; пока группы нет в списке — просто код. */
function GroupCode({ code, byCode }: { code: string; byCode: Map<string, GroupItem> }) {
  const nav = useAppNav();
  const g = byCode.get(code);
  return g ? (
    <Button size="sm" title={groupLine(g)} aria-label={t.openGroup(code)} onClick={() => nav.openGroup(g.id)}>
      {code}
    </Button>
  ) : (
    <Pill>{code}</Pill>
  );
}

type RoleKind = 'leader' | 'coLeader' | 'member';

/**
 * «Группы» в карточке человека: где он ведущий, соведущий и участник — код группы кнопкой (открывает группу) и
 * «Сменить» рядом. Участник, внесённый вручную, и соведущий переводятся в другую группу (`AddToGroupDialog` с `move`);
 * направленного через сервис меняют в его заявке, а ведущего не переводят — у группы должен остаться ведущий.
 * «+ Добавить в группу» ставит человека ещё в одну группу участником, ведущим или соведущим.
 */
export function PersonGroups({ p }: { p: PersonItem }) {
  const nav = useAppNav();
  const groups = useGroups();
  const [dialog, setDialog] = useState<{ move?: MoveFrom } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const canChange = useCanChange();
  const canEditGroups = useCanEditGroups();
  const byCode = new Map((groups.data?.items ?? []).map((g) => [g.code, g]));
  const rows: { kind: RoleKind; label: string; codes: string[] }[] = [
    { kind: 'leader' as const, label: t.leaderOf, codes: p.leads.filter((l) => l.role === 'leader').map((l) => l.code) },
    { kind: 'coLeader' as const, label: t.coLeaderOf, codes: p.leads.filter((l) => l.role === 'coLeader').map((l) => l.code) },
    { kind: 'member' as const, label: t.memberOf, codes: p.groups },
  ].filter((r) => r.codes.length > 0);

  const change = (kind: RoleKind, code: string) => {
    const g = byCode.get(code);
    if (!g || !canChange) return null;
    if (kind === 'leader') return <p className={styles.hint}>{t.leaderStays}</p>;
    // Соведущего переводит правка группы, а её распределителю не дают.
    if (kind === 'coLeader' && !canEditGroups) return null;
    const member = kind === 'member' ? g.members.find((m) => m.personKey === p.key) : undefined;
    if (member?.kind === 'placed') {
      // Направлен через сервис: состав держит утверждённая заявка, и менять группу надо там (вернуть в работу).
      return (
        <Button size="sm" aria-label={t.changeInRequestAria(code)} onClick={() => nav.openRequest(member.id)}>
          {t.changeInRequest}
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        aria-label={t.changeAria(code)}
        onClick={() => {
          setDone(null);
          setDialog({ move: { group: g, role: kind, memberId: member?.id ?? null } });
        }}
      >
        {t.change}
      </Button>
    );
  };

  return (
    <DrawerSection title={t.groupsTitle}>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t.groupsNone}</p>
      ) : (
        rows.map((r) => (
          <div key={r.kind} className={styles.roleRow}>
            <span className={styles.roleLabel}>{r.label}</span>
            <div className={styles.roleGroups}>
              {r.codes.map((code) => (
                <div key={code} className={styles.codes}>
                  <GroupCode code={code} byCode={byCode} />
                  {change(r.kind, code)}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div className={styles.addRow} hidden={!canChange}>
        <Button
          aria-label={t.addToGroupAria(p.fio)}
          onClick={() => {
            setDone(null);
            setDialog({});
          }}
        >
          {t.addToGroup}
        </Button>
      </div>
      {done && (
        <p className={manage.saved} role="status">
          {done}
        </p>
      )}
      {dialog && (
        <AddToGroupDialog
          p={p}
          move={dialog.move}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setDone(text);
          }}
        />
      )}
    </DrawerSection>
  );
}

/**
 * Значки в шапке карточки человека, как у группы и заявки: правка (карандаш), затем звонок, письмо и копирование
 * номера. Править можно любого человека: у внесённой вручную (p<id>) данные лежат в самой карточке, у регистрации и
 * человека из заявки (u<id>, r<id>) — в регистрации и заявках, и правка идёт в обе стороны.
 */
export function PersonHeaderTools({ p }: { p: PersonItem }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const path = p.personId === null ? `people/${p.key}/update` : `persons/${p.personId}/update`;
  const canChange = useCanChange();
  return (
    <>
      {canChange && <IconButton
        label={t.editAria(p.fio)}
        onClick={() => {
          setSaved(false);
          setEditing(true);
        }}
      >
        <Pencil />
      </IconButton>}
      <PhoneTools phone={p.phone} name={p.fio} noPhone={t.noPhone} hiddenHint={p.contactsHidden ? t.phonesHidden : undefined} />
      {saved && (
        <span className={manage.saved} role="status">
          {ru.manage.saved}
        </span>
      )}
      {editing && (
        <ContactEditDialog
          title={t.editTitle(p.fio)}
          values={p}
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

/** «Удалить» карточку, внесённую вручную (правка — карандашом в шапке). Только полным входом (кнопку прячет `DeleteRecord`). */
export function PersonActions({ p, onDeleted }: { p: PersonItem; onDeleted: () => void }) {
  if (p.personId === null) return null;
  return (
    <div className={manage.actions}>
      <DeleteRecord
        label={t.delete}
        ariaLabel={t.deleteAria(p.fio)}
        title={t.deleteTitle(p.fio)}
        text={t.deleteText}
        path={`persons/${p.personId}/delete`}
        onDeleted={onDeleted}
      />
    </div>
  );
}
