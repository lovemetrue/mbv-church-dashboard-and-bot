import { useEffect, useMemo, useRef } from 'react';
import type { RequestsView } from '@contracts';
import { BUCKET_LABEL, LIST_BUCKETS, type BucketFilter } from '../../entities/buckets';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Chip, EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { countBuckets, filterByBucket, searchRequests } from './model';
import { MatchingPanel } from './MatchingPanel';
import { RequestCard, type RequestNeighbors } from './RequestCard';
import { RequestList } from './RequestList';
import styles from './Requests.module.css';

export function RequestsScreen() {
  const query = useRequests();
  if (query.isPending) return <LoadingState lines={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <RequestsContent data={query.data} />;
}

export function RequestsContent({ data }: { data: RequestsView }) {
  const nav = useAppNav();
  const found = useMemo(() => searchRequests(data.items, nav.search), [data.items, nav.search]);
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

  const neighbors = useNeighbors(visible, selected?.id ?? null, nav.selectRequest);

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <MatchingPanel matching={data.matching} />
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
        {visible.length ? (
          <RequestList items={visible} selectedId={nav.requestId} onSelect={nav.selectRequest} />
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
