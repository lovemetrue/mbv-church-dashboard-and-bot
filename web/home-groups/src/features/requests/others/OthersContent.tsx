import { useMemo } from 'react';
import type { RequestsView as RequestsData } from '@contracts';
import { OTHER_FILTERS, type OtherFilter } from '../../../entities/others';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Chip, EmptyState } from '../../../shared/ui';
import { ClosedNote } from '../ClosedNote';
import { filterByResponsible } from '../model';
import { ResponsibleSelect } from '../ResponsibleSelect';
import styles from '../Requests.module.css';
import { ViewSwitch } from '../ViewSwitch';
import { countOthers, filterOthers, matchesOtherSearch, openOthersCount } from './model';
import { OtherCard } from './OtherCard';
import { OtherList } from './OtherList';

const t = ru.requests.others;

const FILTER_LABEL: Record<OtherFilter, string> = {
  open: t.filterOpen,
  done: t.filterDone,
  cancelled: t.filterCancelled,
  all: t.filterAll,
};

/**
 * Режим «Другие обращения»: обращения, которые не идут в подбор группы. Поиск шапки и «В работе у»
 * общие с заявками и сужают список до чипов, как там. Открытая карточка ищется среди всех обращений,
 * а не среди показанных: ссылка на закрытое обращение работает и при чипе «Открытые».
 */
export function OthersContent({
  data,
  note,
  onClosed,
  onHideNote,
}: {
  data: RequestsData;
  note: string | null;
  onClosed: (text: string) => void;
  onHideNote: () => void;
}) {
  const nav = useAppNav();
  const all = data.others;
  const found = useMemo(
    () => filterByResponsible(all.filter((o) => matchesOtherSearch(o, nav.search)), nav.responsible),
    [all, nav.search, nav.responsible],
  );
  const counts = useMemo(() => countOthers(found), [found]);
  const visible = useMemo(() => filterOthers(found, nav.otherFilter), [found, nav.otherFilter]);
  const selected = nav.requestId != null ? all.find((o) => o.id === nav.requestId) : undefined;

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <ViewSwitch view="others" openOthers={openOthersCount(all)} onChange={nav.setView} />
        <ClosedNote note={note} onHide={onHideNote} />
        <div className={styles.bar} role="group" aria-label={t.chipsLabel}>
          {OTHER_FILTERS.map((f) => (
            <Chip key={f} pressed={nav.otherFilter === f} count={counts[f]} onClick={() => nav.setOtherFilter(f)}>
              {FILTER_LABEL[f]}
            </Chip>
          ))}
        </div>
        <div className={styles.tools} role="group" aria-label={ru.requests.toolsLabel}>
          <ResponsibleSelect items={all} value={nav.responsible} onChange={nav.setResponsible} />
        </div>
        {visible.length ? (
          <OtherList items={visible} selectedId={nav.requestId} onSelect={nav.selectRequest} />
        ) : (
          <div className={styles.listbox}>
            <EmptyState>{ru.states.nothingFound}</EmptyState>
          </div>
        )}
        <p className={styles.legendNote}>{t.legend}</p>
      </div>

      {nav.requestId != null ? (
        selected ? (
          <OtherCard
            item={selected}
            onClose={nav.closeRequest}
            onClosed={(text) => {
              onClosed(text);
              nav.closeRequest();
            }}
          />
        ) : (
          <aside className={styles.placeholder} role="status">
            <EmptyState>{t.notFound}</EmptyState>
          </aside>
        )
      ) : (
        <aside className={styles.placeholder}>
          <EmptyState hint={t.emptyPaneHint}>{t.emptyPane}</EmptyState>
        </aside>
      )}
    </div>
  );
}
