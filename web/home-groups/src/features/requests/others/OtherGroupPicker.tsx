import { useId, useMemo, useState } from 'react';
import type { GroupBrief } from '@contracts';
import { useGroups } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { Button, ErrorState, LoadingState } from '../../../shared/ui';
import styles from './Others.module.css';

const r = ru.requests.others.reconcile;

const label = (g: GroupBrief) => r.candidate(g.code, g.leader, g.district);
const norm = (t: string) => t.toLowerCase().replaceAll('ё', 'е').replaceAll('й', 'и');

/**
 * Каждое слово запроса должно найтись в коде, ведущем, районе или метро: порядок слов не важен («Дмитрий Коновалов» найдёт
 * «Коновалов Дмитрий»), падеж и «ё/е» не мешают. Слово, начало которого совпало с началом слова ведущего, тоже подходит,
 * иначе по половине фамилии («иши») ничего бы не появлялось, пока человек пишет.
 */
export const matches = (g: GroupBrief, q: string) => {
  const words = norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm([g.code, g.leader, g.district, g.metro ?? ''].join(' '));
  return words.every((w) => hay.includes(w) || (w.length >= 4 && hay.split(/[^\p{L}\p{N}]+/u).some((h) => h.length >= 4 && (h.startsWith(w.slice(0, -1)) || w.startsWith(h.slice(0, -1))))));
};

/**
 * «Другие группы…»: список групп из того же запроса, что у выбора другой группы при утверждении заявки
 * (`useGroups`, один и тот же кэш), поиск по коду, ведущему и району. Выбор в списке сразу добавляет группу в
 * «Добавленные группы» (их может быть несколько), оттуда её можно убрать. Блокировок «не направлять» и «мест нет»
 * здесь нет: они про подбор новых людей, а человек, который уже состоит в группе или ведёт её, туда не «направляется».
 * Запрос уходит, только когда отмечено «Другие группы…»: компонент в карточке монтируется по этой отметке.
 */
export function OtherGroupPicker({
  chosen,
  onAdd,
  onRemove,
  leaderName,
}: {
  chosen: readonly GroupBrief[];
  onAdd: (g: GroupBrief) => void;
  onRemove: (id: number) => void;
  /** Как человек назвал ведущего: сразу ищем по этому имени, чтобы нужная группа была перед глазами. */
  leaderName?: string | null;
}) {
  const query = useGroups();
  const [search, setSearch] = useState(leaderName ?? '');
  const searchId = useId();
  const selectId = useId();
  const chosenId = useId();

  const groups = useMemo<GroupBrief[]>(
    () => [...(query.data?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, 'ru')),
    [query.data],
  );

  if (query.isPending) return <LoadingState lines={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const q = search.trim();
  // Уже добавленные в списке не предлагаем: второй раз их не добавить, а выбор пропал бы без объяснений.
  const taken = new Set(chosen.map((g) => g.id));
  const shown = groups.filter((g) => !taken.has(g.id) && matches(g, q));

  return (
    <div className={styles.picker}>
      {chosen.length > 0 && (
        <>
          <p id={chosenId} className={styles.fieldLabel}>
            {r.otherChosenLabel}
          </p>
          <ul className={styles.chosen} aria-labelledby={chosenId}>
            {chosen.map((g) => (
              <li key={g.id} className={styles.chosenItem}>
                <span>{label(g)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(g.id)} aria-label={r.otherRemove(g.code)}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
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
        // Список виден сразу и сужается по мере набора: раскрывать выпадающий список, чтобы увидеть подсказки, не нужно.
        size={Math.min(6, Math.max(2, shown.length + 1))}
        value=""
        onChange={(e) => {
          const g = groups.find((x) => String(x.id) === e.target.value);
          if (g) onAdd(g);
        }}
      >
        <option value="" disabled>
          {r.otherSelectIdle}
        </option>
        {shown.map((g) => (
          <option key={g.id} value={String(g.id)}>
            {label(g)}
          </option>
        ))}
      </select>
      {shown.length === 0 && <p className={styles.note}>{r.otherNothing}</p>}
    </div>
  );
}
