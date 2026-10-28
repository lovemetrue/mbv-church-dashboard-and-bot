import { useEffect, useMemo, useRef, useState } from 'react';
import type { RequestsView } from '@contracts';
import { BUCKET_LABEL, LIST_BUCKETS, type BucketFilter } from '../../entities/buckets';
import { useCanChange } from '../../shared/access';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { SavedViewsMenu } from '../../shared/savedViews';
import { Button, Chip, EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { countBuckets, filterByBucket, filterByResponsible, searchRequests } from './model';
import { useResponsible } from './useResponsible';
import { BulkPanel } from './bulk/BulkPanel';
import { useBulk } from './bulk/useBulk';
import { ClosedNote } from './ClosedNote';
import { MatchingPanel } from './MatchingPanel';
import { OthersContent } from './others/OthersContent';
import { openOthersCount } from './others/model';
import { RequestCard, type RequestNeighbors } from './RequestCard';
import { RequestList } from './RequestList';
import styles from './Requests.module.css';
import { ResponsibleSelect } from './ResponsibleSelect';
import { useNewArrivals } from './useNewArrivals';
import { ViewSwitch } from './ViewSwitch';

export function RequestsScreen() {
  const query = useRequests();
  if (query.isPending) return <LoadingState lines={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <RequestsContent data={query.data} />;
}

/**
 * Экран «Заявки» в одном из двух режимов списка: «Хотят в группу» (подбор) или «Другие обращения».
 * Итог закрытия хранится здесь, выше обоих списков: карточка после закрытия уходит с экрана, а итог
 * должен пережить и её, и переключение режима.
 */
export function RequestsContent({ data }: { data: RequestsView }) {
  const nav = useAppNav();
  const [note, setNote] = useState<string | null>(null);
  // Сервер старой версии мог ещё не прислать `others`: без этой подстраховки экран заявок упал бы целиком.
  const safe = data.others ? data : { ...data, others: [] };
  const props = { data: safe, note, onClosed: setNote, onHideNote: () => setNote(null) };
  return nav.view === 'wait' ? <WaitingContent {...props} /> : <OthersContent {...props} kind={nav.view} />;
}

function WaitingContent({
  data,
  note,
  onClosed,
  onHideNote,
}: {
  data: RequestsView;
  note: string | null;
  onClosed: (text: string) => void;
  onHideNote: () => void;
}) {
  const nav = useAppNav();
  const resp = useResponsible('wait');
  // Поиск и «В работе у» сужают список до чипов: счётчики, очередь обзвона и «Следующая заявка»
  // считаются по одному и тому же найденному.
  const found = useMemo(
    () => filterByResponsible(searchRequests(data.items, nav.search), resp.value, resp.myName),
    [data.items, nav.search, resp.value, resp.myName],
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
  const changed = useMemo(
    () => data.items.filter((r) => r.bucket !== 'done' && r.bucket !== 'cancelled' && r.proposal?.dataChanged),
    [data.items],
  );

  const neighbors = useNeighbors(visible, selected?.id ?? null, nav.selectRequest);
  // Выбор для массовых действий принадлежит текущему списку: сменился чип, поиск или «В работе у» — выбор сброшен.
  const bulk = useBulk(visible, `${nav.bucket}\u0000${nav.search}\u0000${resp.value}`);
  // «Только чтение» ничего не меняет: ни массовых действий, ни флажков выбора у него нет.
  const canChange = useCanChange();

  return (
    <div className={styles.work}>
      <div className={styles.main}>
        <ViewSwitch view="wait" others={data.others} items={data.items} onChange={nav.setView} />
        <ClosedNote note={note} onHide={onHideNote} />
        <MatchingPanel matching={data.matching} assistant={data.assistant} changed={changed} />
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
          <Chip pressed={nav.bucket === 'strange'} count={counts.strange} onClick={() => nav.setBucket('strange')}>
            {ru.strange.chip}
          </Chip>
        </div>
        <div className={styles.tools} role="group" aria-label={ru.requests.toolsLabel}>
          <ResponsibleSelect items={data.items} value={resp.value} mine={resp.myName !== null} onChange={resp.set} />
          <SavedViewsMenu scope="requests" />
        </div>
        {canChange && <BulkPanel bulk={bulk} visibleCount={visible.length} />}
        {visible.length ? (
          <RequestList
            items={visible}
            selectedId={nav.requestId}
            onSelect={nav.selectRequest}
            selection={canChange ? { isPicked: bulk.isPicked, toggle: bulk.toggle, limitReached: bulk.limitReached } : null}
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
          <RequestCard
            r={selected}
            onClose={nav.closeRequest}
            neighbors={neighbors}
            onClosed={(text) => {
              onClosed(text);
              nav.closeRequest();
            }}
          />
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
