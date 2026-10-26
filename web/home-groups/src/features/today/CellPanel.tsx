import type { GroupItem, MatrixCell, RequestItem } from '@contracts';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BUCKET_LABEL } from '../../entities/buckets';
import { useGroups, useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import {
  AgeTag,
  Button,
  Drawer,
  DrawerSection,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingState,
  GroupMarks,
  Pill,
  StrangeBadge,
  type KvRow,
  type PillTone,
} from '../../shared/ui';
import { cellSummary, cellTitle, isUnknownAge, isUnknownDistrict } from './model';
import styles from './Today.module.css';

type PanelTab = 'waiting' | 'groups';

const BUCKET_TONE: Record<RequestItem['bucket'], PillTone> = {
  ready: 'ready',
  callback: 'callback',
  human: 'human',
  done: 'done',
  cancelled: 'plain',
};

/** Кто дольше ждёт — выше; без даты — в конце. */
function byWaiting(a: RequestItem, b: RequestItem): number {
  return (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.id - b.id;
}

/** Новые группы сверху (их подбор тоже ставит первыми), дальше — где больше мест. */
function byNewThenFree(a: GroupItem, b: GroupItem): number {
  return Number(b.isNew) - Number(a.isNew) || b.free - a.free || a.code.localeCompare(b.code);
}

function WaitingList({ ids }: { ids: readonly number[] }) {
  const nav = useAppNav();
  const query = useRequests();
  if (ids.length === 0) return <EmptyState>{ru.today.waitingNone}</EmptyState>;
  if (query.isPending) return <LoadingState lines={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const wanted = new Set(ids);
  const items = query.data.items.filter((i) => wanted.has(i.id)).sort(byWaiting);
  return (
    <ul className={styles.plist}>
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" className={styles.prow} onClick={() => nav.openRequest(r.id)}>
            <span className={styles.prowMain}>
              <b>{r.fio}</b>
              {/* Вся строка — кнопка, поэтому значок без фокуса: подсказка у него обычный title. */}
              <StrangeBadge mark={r.strange} interactive={false} />
              {r.ageLabel && <AgeTag>{r.ageLabel}</AgeTag>}
            </span>
            <span className={styles.prowSub}>
              <Pill tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</Pill>
              <span>{ru.today.waitingSince(r.waitingDays)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GroupsList({ ids, district, age, onOpen }: { ids: readonly number[]; district: string; age: string; onOpen: (id: number) => void }) {
  const query = useGroups();
  if (ids.length === 0) {
    const noDistrict = isUnknownDistrict(district);
    const noAge = isUnknownAge(age);
    const text =
      noDistrict && noAge
        ? ru.today.groupsNoneBoth
        : noDistrict
          ? ru.today.groupsNoneDistrict
          : noAge
            ? ru.today.groupsNoneAge
            : ru.today.groupsNone;
    return <EmptyState>{text}</EmptyState>;
  }
  if (query.isPending) return <LoadingState lines={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const wanted = new Set(ids);
  const items = query.data.items.filter((g) => wanted.has(g.id)).sort(byNewThenFree);
  return (
    <ul className={styles.plist}>
      {items.map((g) => (
        <li key={g.id}>
          <button type="button" className={styles.prow} data-group={g.id} onClick={() => onOpen(g.id)}>
            <span className={styles.prowMain}>
              <b>{g.code}</b>
              <GroupMarks g={g} />
              <span className={styles.prowLeader}>{g.leader}</span>
            </span>
            <span className={styles.prowSub}>
              <span>{g.whenText ?? ru.today.whenUnknown}</span>
              <span className="num">{ru.today.seatsOf(g.free, g.capacity)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GroupCardBody({ id, onBack }: { id: number; onBack: () => void }) {
  const nav = useAppNav();
  const query = useGroups();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  const g = query.data?.items.find((x) => x.id === id);

  const back = (
    <div className={styles.backRow}>
      <Button ref={backRef} variant="ghost" size="sm" onClick={onBack}>
        {ru.today.groupBack}
      </Button>
    </div>
  );
  if (query.isPending) return <>{back}<LoadingState lines={4} /></>;
  if (query.isError) return <>{back}<ErrorState error={query.error} onRetry={() => void query.refetch()} /></>;
  if (!g) return <>{back}<EmptyState>{ru.today.groupsNone}</EmptyState></>;

  const none = <span className={styles.muted}>{ru.today.notSpecified}</span>;
  const rows: KvRow[] = [
    // Двое ведущих — двумя строками, одна под другой.
    {
      label: ru.today.groupLeader,
      value: g.coLeader ? (
        <>
          <div>{g.leader}</div>
          <div>{g.coLeader}</div>
        </>
      ) : (
        g.leader || none
      ),
    },
    { label: ru.today.groupPlace, value: [g.district, g.metro].filter(Boolean).join(' · ') || none },
    { label: ru.today.groupWhen, value: g.whenText ?? none },
    { label: ru.today.groupSeats, value: <span className="num">{ru.today.seatsOf(g.free, g.capacity)}</span> },
    { label: ru.today.groupStatus, value: g.status },
    { label: ru.today.groupDoNotRefer, value: g.doNotRefer ? <Pill tone="crit">{ru.today.yes}</Pill> : ru.today.no },
  ];
  return (
    <>
      {back}
      <DrawerSection>
        <p className={styles.cardCode}>
          <b>{g.code}</b>
          <GroupMarks g={g} />
        </p>
        <KeyValue rows={rows} />
      </DrawerSection>
      <DrawerSection title={ru.today.groupPlanned}>
        {g.plannedRequests.length ? (
          <ul className={styles.plist}>
            {g.plannedRequests.map((r) => (
              <li key={r.id} className={styles.planned}>
                <span className={styles.prowMain}>
                  <b>{r.fio}</b>
                  {r.ageLabel && <AgeTag>{r.ageLabel}</AgeTag>}
                </span>
                <Button size="sm" aria-label={`${ru.today.groupOpenRequest}: ${r.fio}`} onClick={() => nav.openRequest(r.id)}>
                  {ru.today.groupOpenRequest}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{ru.today.groupPlannedNone}</p>
        )}
      </DrawerSection>
      <DrawerSection>
        <Button
          variant="primary"
          // Одним вызовом: два подряд (вкладка, потом запись) затёрли бы друг друга, потому что правят один и тот же адрес.
          onClick={() => nav.update({ tab: 'reference', rec: String(g.id), ent: null, bucket: null, req: null })}
        >
          {ru.today.groupOpenRef}
        </Button>
      </DrawerSection>
    </>
  );
}

interface PanelState {
  key: string;
  tab: PanelTab;
  groupId: number | null;
}

/**
 * Правая панель клетки: кто ждёт и какие группы дают места. Второй уровень — карточка группы с кнопкой
 * «назад». Состояние привязано к клетке: другая клетка начинает с вкладки «Желающие», а не с того, где остановились.
 */
export function CellPanel({ district, age, cell, onClose }: { district: string; age: string; cell: MatrixCell; onClose: () => void }) {
  const key = `${district}|${age}`;
  const [state, setState] = useState<PanelState>({ key, tab: 'waiting', groupId: null });
  const st: PanelState = state.key === key ? state : { key, tab: 'waiting', groupId: null };
  const set = (patch: Partial<Omit<PanelState, 'key'>>) => setState({ ...st, ...patch });
  const uid = useId();
  const lastGroup = useRef<number | null>(null);

  // После «назад» фокус возвращается на строку группы, из которой пришли.
  useEffect(() => {
    if (st.groupId === null && lastGroup.current !== null) {
      document.querySelector<HTMLElement>(`[data-group="${lastGroup.current}"]`)?.focus({ preventScroll: true });
      lastGroup.current = null;
    }
  }, [st.groupId]);

  const title = cellTitle(district, age);
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'waiting', label: ru.today.tabWaiting(cell.requestIds.length) },
    { id: 'groups', label: ru.today.tabGroups(cell.groupIds.length) },
  ];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: PanelTab = st.tab === 'waiting' ? 'groups' : 'waiting';
    set({ tab: next });
    document.getElementById(`${uid}-${next}`)?.focus();
  };

  // Esc в карточке группы — это «назад», а не «закрыть всё»: Drawer не закрывается, если событие уже обработано.
  const onEsc = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && st.groupId !== null) {
      e.preventDefault();
      lastGroup.current = st.groupId;
      set({ groupId: null });
    }
  };

  // Заголовок и имя окна зависят от уровня: клетка или карточка группы. Данные групп уже в кэше (список открыт).
  const groups = useGroups();
  const code = st.groupId !== null ? groups.data?.items.find((g) => g.id === st.groupId)?.code : undefined;

  return (
    <Drawer
      label={code ? ru.today.groupCardLabel(code) : ru.today.panelLabel(title)}
      title={code ?? title}
      subtitle={code ? title : cellSummary(district, age, cell)}
      onClose={onClose}
    >
      <div onKeyDown={onEsc}>
        {st.groupId !== null ? (
          <GroupCardBody
            id={st.groupId}
            onBack={() => {
              lastGroup.current = st.groupId;
              set({ groupId: null });
            }}
          />
        ) : (
          <>
            <div className={styles.ptabs} role="tablist" aria-label={ru.today.tabsLabel} onKeyDown={onTabKey}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  id={`${uid}-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={st.tab === t.id}
                  aria-controls={`${uid}-panel`}
                  tabIndex={st.tab === t.id ? 0 : -1}
                  className={styles.ptab}
                  onClick={() => set({ tab: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-${st.tab}`} className={styles.ppanel}>
              {st.tab === 'waiting' ? (
                <WaitingList ids={cell.requestIds} />
              ) : (
                <GroupsList
                  ids={cell.groupIds}
                  district={district}
                  age={age}
                  onOpen={(id) => {
                    lastGroup.current = id;
                    set({ groupId: id });
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
