import { useId, useMemo, useState } from 'react';
import type { GroupBrief } from '@contracts';
import { useGroups } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { Button, ErrorState, LoadingState } from '../../../shared/ui';
import styles from './Others.module.css';

const r = ru.requests.others.reconcile;

const label = (g: GroupBrief) => r.candidate(g.code, g.leader, g.district);
const matches = (g: GroupBrief, q: string) => !q || [g.code, g.leader, g.district, g.metro ?? ''].join(' ').toLowerCase().includes(q);

/**
 * «Другая группа…»: список групп из того же запроса, что у выбора другой группы при утверждении заявки
 * (`useGroups`, один и тот же кэш), поиск по коду, ведущему и району. Блокировок «не направлять» и «мест нет» здесь
 * нет: они про подбор новых людей, а человек, который уже состоит в группе или ведёт её, туда не «направляется».
 * Запрос уходит, только когда выбрана «Другая группа…»: компонент в карточке монтируется по этому выбору.
 */
export function OtherGroupPicker({ value, onChange }: { value: GroupBrief | null; onChange: (g: GroupBrief | null) => void }) {
  const query = useGroups();
  const [search, setSearch] = useState('');
  const searchId = useId();
  const selectId = useId();

  const groups = useMemo<GroupBrief[]>(
    () => [...(query.data?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, 'ru')),
    [query.data],
  );

  if (query.isPending) return <LoadingState lines={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const q = search.trim().toLowerCase();
  const shown = groups.filter((g) => matches(g, q));
  // Выбранная группа остаётся в списке, даже если поиск её уже не находит: иначе выбор пропал бы молча.
  const list = value && !shown.some((g) => g.id === value.id) ? [value, ...shown] : shown;

  return (
    <div className={styles.picker}>
      <label htmlFor={searchId} className={styles.fieldLabel}>
        {r.otherSearchLabel}
      </label>
      <input
        id={searchId}
        type="search"
        className={styles.field}
        value={search}
        placeholder={r.otherSearchPlaceholder}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label htmlFor={selectId} className={styles.fieldLabel}>
        {r.otherSelectLabel}
      </label>
      <select
        id={selectId}
        className={styles.field}
        value={value ? String(value.id) : ''}
        onChange={(e) => onChange(groups.find((g) => String(g.id) === e.target.value) ?? null)}
      >
        <option value="" disabled>
          {r.otherSelectIdle}
        </option>
        {list.map((g) => (
          <option key={g.id} value={String(g.id)}>
            {label(g)}
          </option>
        ))}
      </select>
      {shown.length === 0 && <p className={styles.note}>{r.otherNothing}</p>}
    </div>
  );
}
