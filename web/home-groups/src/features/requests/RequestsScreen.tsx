import { useEffect, useId, useMemo, useRef } from 'react';
import type { RequestsView } from '@contracts';
import { BUCKET_LABEL, LIST_BUCKETS, type BucketFilter } from '../../entities/buckets';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { RESP_NOBODY, useAppNav } from '../../shared/nav';
import { SavedViewsMenu } from '../../shared/savedViews';
import { Button, Chip, EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { countBuckets, filterByBucket, filterByResponsible, responsibleNames, searchRequests } from './model';
import { BulkPanel } from './bulk/BulkPanel';
import { useBulk } from './bulk/useBulk';
import { MatchingPanel } from './MatchingPanel';
import { RequestCard, type RequestNeighbors } from './RequestCard';
import { RequestList } from './RequestList';
import styles from './Requests.module.css';
import { useNewArrivals } from './useNewArrivals';

export function RequestsScreen() {
  const query = useRequests();
  if (query.isPending) return <LoadingState lines={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <RequestsContent data={query.data} />;
}

export function RequestsContent({ data }: { data: RequestsView }) {
  const nav = useAppNav();
  // Поиск и «В работе у» сужают список до чипов: счётчики, очередь обзвона и «Следующая заявка»
  // считаются по одному и тому же найденному.
  const found = useMemo(
    () => filterByResponsible(searchRequests(data.items, nav.search), nav.responsible),
    [data.items, nav.search, nav.responsible],
  );
  const counts = useMemo(() => countBuckets(found), [found]);
  const visible = useMemo(() => filterByBucket(found, nav.bucket), [found, nav.bucket]);
  const selected = nav.requestId != null ? data.items.find((r) => r.id === nav.requestId) : undefined;

  // Очередь обзвона открывается с первой заявки. Только в момент перехода на «К обзвону»:
  // иначе после «✕» карточка открывалась бы снова.
  const prevBucket = useRef<BucketFilter | null>(null);
  useEffect(() => {
    if (nav.bucket === 'queue' && prevBucket.current !== 'queue' && nav.requestId == null && visible[0]) {
      nav.update({ req: String(visible[0].id) }, { replace: true });
    }
    prevBucket.current = nav.bucket;
  }, [nav, visible]);

  const arrivals = useNewArrivals(data.items);
  // Заявки с изменившимися данными: их закреплённые предложения устарели. Утверждённых не считаем.
  const dataChanged = useMemo(
    () => data.items.filter((r) => r.bucket !== 'done' && r.bucket !== 'cancelled' && r.proposal?.dataChanged).length,
    [data.items],
  );

  const neighbors = useNeighbors(visible, selected?.id ?? null, nav.selectRequest);
  // Выбор для массовых действий принадлежит текущему списку: сменился чип, поиск или «В работе у» — выбор сброшен.
  const bulk = useBulk(visible, `${nav.bucket}\u0000${nav.search}\u0000${nav.responsible}`);

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <MatchingPanel matching={data.matching} dataChanged={dataChanged} />
        {/* Область живая и есть всегда: скринридер читает только то, что в неё добавили. */}
        <div role="status" className={arrivals.count > 0 ? styles.arrived : undefined}>
          {arrivals.count > 0 && (
            <>
              <span>{ru.requests.arrived.text(arrivals.count)}</span>
              <Button variant="ghost" onClick={arrivals.dismiss}>
                {ru.requests.arrived.hide}
              </Button>
            </>
          )}
        </div>
        <div className={styles.bar} role="group" aria-label={ru.requests.chipsLabel}>
          <Chip pressed={nav.bucket === 'all'} count={counts.all} onClick={() => nav.setBucket('all')}>
            Все
          </Chip>
          <Chip pressed={nav.bucket === 'queue'} count={counts.queue} onClick={() => nav.setBucket('queue')}>
            {ru.requests.queueChip}
          </Chip>
          {LIST_BUCKETS.map((b) => (
            <Chip key={b} pressed={nav.bucket === b} count={counts[b]} onClick={() => nav.setBucket(b)}>
              {BUCKET_LABEL[b]}
            </Chip>
          ))}
        </div>
        <div className={styles.tools} role="group" aria-label={ru.requests.toolsLabel}>
          <ResponsibleSelect items={data.items} value={nav.responsible} onChange={nav.setResponsible} />
          <SavedViewsMenu scope="requests" />
        </div>
        <BulkPanel bulk={bulk} visibleCount={visible.length} />
        {visible.length ? (
          <RequestList
            items={visible}
            selectedId={nav.requestId}
            onSelect={nav.selectRequest}
            selection={{ isPicked: bulk.isPicked, toggle: bulk.toggle, limitReached: bulk.limitReached }}
          />
        ) : (
          <div className={styles.listbox}>
            <EmptyState>{ru.states.nothingFound}</EmptyState>
          </div>
        )}
        <p className={styles.legendNote}>{ru.requests.legend}</p>
      </div>

      {nav.requestId != null ? (
        selected ? (
          <RequestCard r={selected} onClose={nav.closeRequest} neighbors={neighbors} />
        ) : (
          <aside className={styles.placeholder} role="status">
            <EmptyState>{ru.requests.notFound}</EmptyState>
          </aside>
        )
      ) : (
        <aside className={styles.placeholder}>
          <EmptyState hint={ru.requests.emptyPaneHint}>{ru.requests.emptyPane}</EmptyState>
        </aside>
      )}
    </div>
  );
}

/** Список «В работе у». Имена берём из всех заявок, а не из найденных: иначе выбор сам себя сужал бы. */
function ResponsibleSelect({
  items,
  value,
  onChange,
}: {
  items: RequestsView['items'];
  value: string;
  onChange: (who: string) => void;
}) {
  const id = useId();
  const names = useMemo(() => responsibleNames(items), [items]);
  // Имя из старой ссылки, которого в очереди уже нет, оставляем в списке: иначе выбор показывал бы
  // «Все», а список при этом был бы пуст.
  const extra = value && value !== RESP_NOBODY && !names.includes(value) ? value : null;
  return (
    <div className={styles.respBox}>
      <label htmlFor={id} className={styles.respLabel}>
        {ru.requests.respFilterLabel}
      </label>
      <select id={id} className={styles.respSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{ru.requests.respFilterAll}</option>
        <option value={RESP_NOBODY}>{ru.requests.respFilterNobody}</option>
        {[...names, ...(extra ? [extra] : [])].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Соседи открытой заявки по текущему списку (с учётом поиска, чипа и порядка).
 *
 * После «Утвердить» заявка уходит из очереди и из списка пропадает. Чтобы «Следующая заявка»
 * не терялась именно тогда, когда она нужнее всего, помним последний порядок, в котором заявка
 * ещё была, и берём ближайших, кто остался в списке.
 */
function useNeighbors(
  visible: readonly { id: number }[],
  selectedId: number | null,
  go: (id: number) => void,
): RequestNeighbors | undefined {
  const last = useRef<{ id: number; ids: number[] } | null>(null);
  if (selectedId === null) return undefined;
  const ids = visible.map((r) => r.id);
  const at = ids.indexOf(selectedId);
  if (at >= 0) {
    last.current = { id: selectedId, ids };
    return { position: at + 1, total: ids.length, prevId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null, onGo: go };
  }
  const old = last.current?.id === selectedId ? last.current.ids : null;
  if (!old) return undefined;
  const was = old.indexOf(selectedId);
  const alive = new Set(ids);
  return {
    position: null,
    total: ids.length,
    prevId: old.slice(0, was).reverse().find((id) => alive.has(id)) ?? null,
    nextId: old.slice(was + 1).find((id) => alive.has(id)) ?? null,
    onGo: go,
  };
}
