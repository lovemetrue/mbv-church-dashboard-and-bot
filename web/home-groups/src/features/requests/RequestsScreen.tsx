import { useMemo } from 'react';
import type { RequestsView } from '@contracts';
import { BUCKET_LABEL, LIST_BUCKETS } from '../../entities/buckets';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Chip, EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { countBuckets, filterByBucket, searchRequests } from './model';
import { RequestCard } from './RequestCard';
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

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <div className={styles.bar} role="group" aria-label={ru.requests.chipsLabel}>
          <Chip pressed={nav.bucket === 'all'} count={counts.all} onClick={() => nav.setBucket('all')}>
            Все
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
          <RequestCard r={selected} onClose={nav.closeRequest} />
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
