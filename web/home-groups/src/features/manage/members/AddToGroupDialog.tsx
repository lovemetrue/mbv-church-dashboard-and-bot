import { useCanEditGroups } from '../../../shared/access';
import { useId, useMemo, useState, type FormEvent } from 'react';
import type { GroupItem, PersonItem } from '@contracts';
import { groupLabel } from '../../../entities/format';
import { useGroups } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { Button, ErrorState, LoadingState, Modal, Pill } from '../../../shared/ui';
import manage from '../Manage.module.css';
import { normalizeText } from './model';
import styles from './Members.module.css';
import { useMemberAction } from './refresh';

const t = ru.members.person.addDialog;

export type GroupRole = 'member' | 'leader' | 'coLeader';
const ROLES: readonly GroupRole[] = ['member', 'leader', 'coLeader'];
const LIMIT = 8;

/** «участник», «соведущий» — как в разделе «Группы» карточки. */
const roleNameOf = (role: 'member' | 'coLeader'): string => (role === 'coLeader' ? ru.members.person.coLeaderOf : ru.members.person.memberOf);

/** Человек уже на этой позиции в группе: второй раз туда не добавить. */
function alreadyThere(g: GroupItem, p: PersonItem, role: GroupRole): boolean {
  if (role === 'member') return p.groups.includes(g.code);
  return role === 'leader' ? g.leaderKey === p.key : g.coLeaderKey === p.key;
}

/** Кто сейчас на позиции ведущего или соведущего — его заменят. Записанный только текстом тоже считается. */
function holderOf(g: GroupItem, p: PersonItem, role: GroupRole): string | null {
  if (role === 'member') return null;
  const key = role === 'leader' ? g.leaderKey : g.coLeaderKey;
  const name = role === 'leader' ? g.leader : g.coLeader;
  if (key === p.key) return null;
  return key || name ? name || ru.reference.notSpecified : null;
}

/**
 * «Добавить в группу» из карточки человека: участником (в состав), ведущим или соведущим. Ведущего и соведущего
 * ставит та же правка группы, что и форма группы (`leaderKey`, `coLeaderKey`), поэтому и проверки те же: человек из
 * заявки получает карточку, один человек не бывает и ведущим, и соведущим. Занятая позиция — сначала вопрос.
 */
/** «Сменить группу»: откуда человек уходит. Участник, внесённый вручную, — строка состава `memberId`; соведущий — отвязка. */
export interface MoveFrom {
  group: GroupItem;
  role: 'member' | 'coLeader';
  memberId: number | null;
}

export function AddToGroupDialog({
  p,
  move,
  onClose,
  onDone,
}: {
  p: PersonItem;
  /** Не добавить, а перевести: роль та же, из прежней группы человек уходит после того, как встал в новую. */
  move?: MoveFrom;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const uid = useId();
  const groups = useGroups();
  const { run, busy } = useMemberAction();
  const [role, setRole] = useState<GroupRole>(move?.role ?? 'member');
  const canEditGroups = useCanEditGroups();
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = groups.data?.items ?? [];
  const found = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return null;
    // Номер группы ищется и без «ДГ-0»: «12» найдёт ДГ-0012.
    return all.filter(
      (g) => g.id !== move?.group.id && normalizeText([g.code, String(g.id), g.leader, g.coLeader ?? '', g.district, g.metro ?? ''].join(' ')).includes(q),
    );
  }, [all, query, move]);
  const picked = pickedId === null ? undefined : all.find((g) => g.id === pickedId);
  const holder = picked ? holderOf(picked, p, role) : null;
  const canSubmit = !!picked && !alreadyThere(picked, p, role) && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked || !canSubmit) return;
    setError(null);
    const result =
      role === 'member'
        ? await run(`groups/${picked.id}/members/create`, { personKey: p.key })
        : await run(`groups/${picked.id}/update`, { fields: { [role === 'leader' ? 'leaderKey' : 'coLeaderKey']: p.key } });
    if (result === null) return;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (!move) {
      onDone(t.done(`${t.roles[role].toLowerCase()} в ${groupLabel(picked)}`));
      return;
    }
    // Сначала человек встал в новую группу, теперь уходит из прежней. Не вышло — так и говорим: он в обеих.
    const from = groupLabel(move.group);
    const left =
      move.role === 'coLeader'
        ? await run(`groups/${move.group.id}/update`, { fields: { coLeaderKey: '' } })
        : move.memberId !== null
          ? await run(`members/${move.memberId}/delete`, {})
          : ({ ok: false, message: '' } as const);
    if (left && left.ok) onDone(t.moveDone(roleNameOf(move.role).toLowerCase(), from, groupLabel(picked)));
    else onDone(t.moveHalf(groupLabel(picked), from, left?.message ?? ''));
  }

  return (
    <Modal title={move ? t.moveTitle(p.fio) : t.title(p.fio)} onClose={() => !busy && onClose()}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        {move && <p className={manage.note}>{t.moveFrom(roleNameOf(move.role).toLowerCase(), groupLabel(move.group))}</p>}
        <fieldset className={manage.multi} hidden={!!move}>
          <legend>{t.role}</legend>
          <div className={manage.multiList}>
            {/* Ведущего и соведущего ставит правка группы, а её распределителю не дают (`mayEditGroups` на сервере). */}
            {ROLES.filter((r) => r === 'member' || canEditGroups).map((r) => (
              <label key={r} className={manage.check}>
                <input
                  type="radio"
                  name={`${uid}-role`}
                  checked={role === r}
                  disabled={busy}
                  onChange={() => {
                    setRole(r);
                    setError(null);
                  }}
                />
                <span>{t.roles[r]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor={`${uid}-q`} className="visually-hidden">
          {t.search}
        </label>
        <input
          id={`${uid}-q`}
          className={manage.control}
          type="search"
          autoComplete="off"
          placeholder={t.searchPlaceholder}
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
        />
        {groups.isPending ? (
          <LoadingState lines={3} />
        ) : groups.isError ? (
          <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
        ) : found === null ? (
          <p className={styles.status}>{t.typeToSearch}</p>
        ) : found.length === 0 ? (
          <p className={styles.status}>{t.noMatches}</p>
        ) : (
          <ul className={styles.options} aria-label={t.list}>
            {found.slice(0, LIMIT).map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={pickedId === g.id}
                  disabled={busy}
                  onClick={() => {
                    setPickedId(g.id);
                    setError(null);
                  }}
                >
                  <span className={styles.optionName}>
                    {groupLabel(g)} · {g.leader}
                    {alreadyThere(g, p, role) && <Pill>{t.already}</Pill>}
                  </span>
                  <span className={styles.optionMeta}>{[g.district, g.metro, g.whenText].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className={picked ? styles.chosen : styles.status}>{picked ? t.chosen(`${groupLabel(picked)} · ${picked.leader}`) : t.noneChosen}</p>
        {picked && holder && role !== 'member' && (
          <p className={manage.note} role="status">
            {t.replace(t.replaceRole[role], holder)}
          </p>
        )}
        {error && (
          <p className={manage.formError} role="alert">
            {error}
          </p>
        )}
        <div className={manage.foot}>
          <Button onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? t.submitting : move ? t.moveSubmit : holder ? t.submitReplace : t.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
