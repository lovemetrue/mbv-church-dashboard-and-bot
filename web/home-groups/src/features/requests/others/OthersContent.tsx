import { useMemo } from 'react';
import type { RequestsView as RequestsData } from '@contracts';
import { isLead, OTHER_FILTERS, RECONCILE_FILTERS, type OtherFilter, type ReconcileFilter } from '../../../entities/others';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Chip, EmptyState } from '../../../shared/ui';
import { ClosedNote } from '../ClosedNote';
import { filterByResponsible } from '../model';
import { useResponsible } from '../useResponsible';
import { ResponsibleSelect } from '../ResponsibleSelect';
import styles from '../Requests.module.css';
import { ViewSwitch } from '../ViewSwitch';
import {
  countOthers,
  countReconcile,
  filterByReconcile,
  filterOthers,
  matchesOtherSearch,
  readyToReconcile,
} from './model';
import { OtherCard } from './OtherCard';
import { OtherList } from './OtherList';
import { ReadyBulk } from './ReadyBulk';
import { useReconcileReady } from './useReconcile';

const t = ru.requests.others;

const FILTER_LABEL: Record<OtherFilter, string> = {
  open: t.filterOpen,
  done: t.filterDone,
  cancelled: t.filterCancelled,
  all: t.filterAll,
};

const RECONCILE_LABEL: Record<ReconcileFilter, string> = {
  all: t.reconcileAll,
  ready: t.reconcileReady,
  choose: t.reconcileChoose,
  missing: t.reconcileMissing,
  rest: t.reconcileRest,
};

/**
 * Режим «Другие обращения»: обращения, которые не идут в подбор группы. Поиск шапки и «В работе у»
 * общие с заявками и сужают список до чипов, как там. Открытая карточка ищется среди всех обращений,
 * а не среди показанных: ссылка на закрытое обращение работает и при чипе «Открытые».
 *
 * Под чипами состояния, пока выбраны «Открытые», стоит вторая строка чипов по разбору (что сервер нашёл в справочниках
 * групп), а над списком — «Разобрать все готовые»: он берёт номера из показанного списка, а не из всех обращений.
 */
export function OthersContent({
  data,
  kind,
  note,
  onClosed,
  onHideNote,
}: {
  data: RequestsData;
  /** leads — «Хотят открыть группу» (рабочее место координатора), others — остальные обращения. */
  kind: 'leads' | 'others';
  note: string | null;
  onClosed: (text: string) => void;
  onHideNote: () => void;
}) {
  const nav = useAppNav();
  const resp = useResponsible(kind);
  // «Хотят открыть группу» и остальные обращения приходят одним списком: делим по типу.
  const all = useMemo(() => data.others.filter((o) => (kind === 'leads') === isLead(o)), [data.others, kind]);
  const found = useMemo(
    () => filterByResponsible(all.filter((o) => matchesOtherSearch(o, nav.search)), resp.value, resp.myName),
    [all, nav.search, resp.value, resp.myName],
  );
  const counts = useMemo(() => countOthers(found), [found]);
  const recCounts = useMemo(() => countReconcile(found), [found]);
  // Отбор по разбору есть только у «Открытых»: в адресе он мог остаться от прежней ссылки, а строки чипов при других
  // состояниях нет, и скрытый отбор прятал бы обращения без объяснений.
  const recFilter: ReconcileFilter = nav.otherFilter === 'open' && kind === 'others' ? nav.reconcileFilter : 'all';
  const visible = useMemo(
    () => filterByReconcile(filterOthers(found, nav.otherFilter), recFilter),
    [found, nav.otherFilter, recFilter],
  );
  const ready = useMemo(() => readyToReconcile(visible), [visible]);
  const readyBulk = useReconcileReady();
  // Карточку ищем во всех обращениях: ссылка на «хочу открыть группу», сделанная до выделения подвкладки, открывается.
  const selected = nav.requestId != null ? data.others.find((o) => o.id === nav.requestId) : undefined;

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <ViewSwitch view={kind} others={data.others} onChange={nav.setView} />
        <ClosedNote note={note} onHide={onHideNote} />
        <div className={styles.bar} role="group" aria-label={t.chipsLabel}>
          {OTHER_FILTERS.map((f) => (
            <Chip key={f} pressed={nav.otherFilter === f} count={counts[f]} onClick={() => nav.setOtherFilter(f)}>
              {FILTER_LABEL[f]}
            </Chip>
          ))}
        </div>
        {nav.otherFilter === 'open' && kind === 'others' && (
          <div className={styles.bar} role="group" aria-label={t.reconcileChipsLabel}>
            {RECONCILE_FILTERS.map((f) => (
              <Chip key={f} pressed={recFilter === f} count={recCounts[f]} onClick={() => nav.setReconcileFilter(f)}>
                {RECONCILE_LABEL[f]}
              </Chip>
            ))}
          </div>
        )}
        <div className={styles.tools} role="group" aria-label={ru.requests.toolsLabel}>
          <ResponsibleSelect items={all} value={resp.value} mine={resp.myName !== null} onChange={resp.set} />
        </div>
        <ReadyBulk ready={ready} bulk={readyBulk} onDone={onClosed} />
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
