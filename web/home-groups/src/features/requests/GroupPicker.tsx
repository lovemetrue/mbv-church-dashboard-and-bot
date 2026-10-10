import { useMemo, useState, type ReactNode } from 'react';
import type { GroupBrief, GroupItem, RequestItem } from '@contracts';
import { useGroups } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button, ErrorState, LoadingState } from '../../shared/ui';
import styles from './Requests.module.css';

const a = ru.requests.act;

/** Группа для списка: краткая карточка плюс признаки, из-за которых её нельзя выбрать. */
interface Option {
  group: GroupBrief;
  /** Почему выбрать нельзя; null — можно. «Мест нет» сюда не входит: это вопрос при утверждении. */
  blocked: string | null;
}

const blockedReason = (g: Pick<GroupItem, 'doNotRefer' | 'acceptsNew'> | undefined): string | null => {
  if (!g) return null;
  if (g.doNotRefer) return a.pickDoNotRefer;
  if (!g.acceptsNew) return a.pickClosed;
  return null;
};

/**
 * Состав списка: запасные варианты предложения сверху (их выбрал расчёт, и они ближе всего
 * к делу), дальше остальные группы — сначала из района человека, затем те, куда можно
 * направить, затем где есть места. Главная группа предложения не входит: её утверждает
 * основная кнопка, а «другая» по смыслу — не она.
 */
export function buildOptions(r: RequestItem, groups: readonly GroupItem[]): { alternatives: Option[]; others: Option[] } {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const mainId = r.proposal?.main.group.id;
  const alternatives: Option[] = (r.proposal?.alternatives ?? [])
    .filter((c) => c.group.id !== mainId)
    .map((c) => ({ group: c.group, blocked: blockedReason(byId.get(c.group.id)) }));
  const taken = new Set([mainId, ...alternatives.map((o) => o.group.id)]);
  const others = groups
    .filter((g) => !taken.has(g.id))
    .map<Option>((g) => ({ group: g, blocked: blockedReason(g) }))
    .sort(
      (x, y) =>
        Number(y.group.district === r.district) - Number(x.group.district === r.district) ||
        Number(x.blocked !== null) - Number(y.blocked !== null) ||
        Number(y.group.free > 0) - Number(x.group.free > 0) ||
        x.group.code.localeCompare(y.group.code, 'ru'),
    );
  return { alternatives, others };
}

const matches = (g: GroupBrief, q: string): boolean =>
  !q || [g.code, g.leader, g.district, g.metro ?? '', g.whenText ?? ''].join(' ').toLowerCase().includes(q);

function OptionRow({ o, selected, onPick }: { o: Option; selected: boolean; onPick: () => void }) {
  const { group: g } = o;
  const where = [g.district, g.metro, g.whenText].filter(Boolean).join(' · ');
  return (
    <li>
      <label className={`${styles.choice} ${o.blocked ? styles.choiceOff : ''}`}>
        <input type="radio" name="other-group" checked={selected} disabled={o.blocked !== null} onChange={onPick} />
        <span className={styles.choiceBody}>
          <b>{g.code}</b> <span>{g.leader}</span>{' '}
          <span className={styles.note}>{where}</span>{' '}
          <span className={g.free > 0 ? styles.note : styles.noSeats}>
            {o.blocked ?? (g.free > 0 ? a.pickSeats(g.free, g.capacity) : a.pickNoSeats)}
          </span>
        </span>
      </label>
    </li>
  );
}

interface GroupPickerProps {
  r: RequestItem;
  pending: boolean;
  /** Ошибка последнего запроса, если была. */
  notice: ReactNode;
  onSubmit: (group: GroupBrief) => void;
  onCancel: () => void;
}

/** Выбор другой группы для заявки. Выбор ещё не решение: утверждает кнопка внизу. */
export function GroupPicker({ r, pending, notice, onSubmit, onCancel }: GroupPickerProps) {
  const query = useGroups();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { alternatives, others } = useMemo(
    () => (query.data ? buildOptions(r, query.data.items) : { alternatives: [], others: [] }),
    [r, query.data],
  );

  if (query.isPending) return <LoadingState lines={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const q = search.trim().toLowerCase();
  const alt = alternatives.filter((o) => matches(o.group, q));
  const rest = others.filter((o) => matches(o.group, q));
  const chosen = [...alternatives, ...others].find((o) => o.group.id === selectedId)?.group;

  const section = (title: string, list: Option[]) =>
    list.length > 0 && (
      <>
        <h3 className={styles.h4}>{title}</h3>
        <ul className={styles.choices}>
          {list.map((o) => (
            <OptionRow key={o.group.id} o={o} selected={selectedId === o.group.id} onPick={() => setSelectedId(o.group.id)} />
          ))}
        </ul>
      </>
    );

  return (
    <div>
      <p className={styles.note}>{a.pickFor(r.fio)}</p>
      <input
        type="search"
        className={styles.search}
        value={search}
        placeholder={a.pickSearch}
        aria-label={a.pickSearchLabel}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div role="radiogroup" aria-label={a.pickListLabel}>
        {section(a.pickAlternatives, alt)}
        {section(a.pickAll, rest)}
        {alt.length + rest.length === 0 && <p className={styles.note}>{a.pickNothing}</p>}
      </div>
      {notice}
      <div className={styles.dialogFoot}>
        <Button onClick={onCancel}>{a.cancel}</Button>
        <Button variant="primary" disabled={!chosen || pending} onClick={() => chosen && onSubmit(chosen)}>
          {chosen ? a.pickSubmit(chosen.code) : a.pickSubmitIdle}
        </Button>
      </div>
    </div>
  );
}
