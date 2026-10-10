import type { CoordinatorItem, GroupItem, PersonItem } from '@contracts';
import { formatDateFull, formatPhone, groupLabel, healthTone } from '../../entities/format';
import { useGroups } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, Drawer, DrawerSection, KeyValue, LoadingState, Meter, Pill, type KvRow } from '../../shared/ui';
import styles from './Reference.module.css';

const noValue = <span className={styles.note}>{ru.reference.notSpecified}</span>;
const orNone = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? noValue : v);

function verifiedText(days: number | null): string {
  if (days === null) return ru.reference.verifiedNever;
  if (days === 0) return ru.reference.verifiedToday;
  return ru.reference.verifiedAgo(days);
}

/** «подтверждена 6 дн. назад» / «не подтверждалась»: для списка групп координатора. */
function verifiedSentence(days: number | null): string {
  if (days === null) return 'не подтверждалась';
  return `подтверждена ${verifiedText(days)}`;
}

export function GroupCard({ g, onClose }: { g: GroupItem; onClose: () => void }) {
  const nav = useAppNav();
  const tone = healthTone(g.health.score);
  const rows: KvRow[] = [
    { label: 'Возраст', value: orNone(g.ageText) },
    { label: 'Когда', value: g.whenText ?? <Pill tone="human">{ru.reference.notSpecified}</Pill> },
    {
      label: 'Места',
      value: (
        <>
          {ru.reference.seats(g.people, g.capacity, g.free)}
          {g.placedNew > 0 && (
            <span className={styles.placedNote}>
              <b className={styles.placedMark}>{ru.reference.placedNew(g.placedNew)}</b>
              {ru.reference.placedNewHint}
            </span>
          )}
        </>
      ),
    },
    { label: 'Подтверждена', value: verifiedText(g.verifiedDaysAgo) },
    { label: 'Координатор', value: orNone(g.coordinator) },
    { label: 'Формат', value: orNone(g.format) },
    { label: 'Состав', value: orNone(g.composition) },
    { label: 'Со-ведущий', value: orNone(g.coLeader) },
    { label: 'Телефон', value: g.phone ? <span className="num">{formatPhone(g.phone)}</span> : noValue },
    { label: 'Статус', value: g.status },
    { label: 'Принимает новых', value: g.acceptsNew ? ru.reference.yes : ru.reference.no },
    ...(g.doNotRefer ? [{ label: 'Не направлять', value: <Pill tone="crit">{ru.reference.yes}</Pill> }] : []),
    ...(g.comment ? [{ label: 'Комментарий', value: g.comment }] : []),
  ];
  return (
    <Drawer
      label={`Карточка группы ${groupLabel(g)}`}
      title={`Группа ${groupLabel(g)}`}
      subtitle={[g.leader, g.district, g.metro].filter(Boolean).join(' · ')}
      onClose={onClose}
    >
      <DrawerSection title={ru.reference.health}>
        <div className={styles.healthHead}>
          <Meter value={g.health.score} tone={tone} width={120} label={`${ru.reference.health}: ${ru.reference.healthOf(g.health.score)}`} />
          <b className="num">{ru.reference.healthOf(g.health.score)}</b>
        </div>
        <ul className={styles.checks}>
          {g.health.items.map((i) => (
            <li key={i.label} className={i.ok ? styles.checkOk : styles.checkBad}>
              <span className={styles.checkIcon} aria-hidden="true">
                {i.ok ? '✓' : '✕'}
              </span>
              <span>
                <span className="visually-hidden">{i.ok ? 'Есть: ' : 'Нет: '}</span>
                {i.label}
              </span>
              <em className="num">{i.ok ? `+${i.points}` : `0 из ${i.points}`}</em>
            </li>
          ))}
        </ul>
        <div className={styles.cardActions}>
          <Button variant="primary" soon>
            {ru.reference.askLeader}
          </Button>
          <Button soon>{ru.reference.verifyManually}</Button>
        </div>
        <p className={styles.note}>{ru.reference.verifyNote}</p>
      </DrawerSection>
      <DrawerSection title={ru.reference.groupData}>
        <KeyValue rows={rows} />
      </DrawerSection>
      <DrawerSection title={ru.reference.plannedTitle}>
        {g.plannedRequests.length ? (
          <ul className={styles.planned}>
            {g.plannedRequests.map((r) => (
              <li key={r.id} className={styles.plannedRow}>
                <div className={styles.plannedMain}>
                  <b>{r.fio}</b>
                  <span>
                    {[r.ageLabel, r.place].filter(Boolean).join(' · ')} · {ru.requests.confidence} {r.confidence}
                  </span>
                </div>
                <Button size="sm" onClick={() => nav.openRequest(r.id)} aria-label={`${ru.reference.openPlanned} заявку: ${r.fio}`}>
                  {ru.reference.openPlanned}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>{ru.reference.plannedNone}</p>
        )}
      </DrawerSection>
    </Drawer>
  );
}

export function PersonCard({ p, onClose }: { p: PersonItem; onClose: () => void }) {
  const nav = useAppNav();
  const rows: KvRow[] = [
    { label: 'ФИО', value: p.fio },
    { label: 'Телефон', value: p.phone ? <span className="num">{formatPhone(p.phone)}</span> : noValue },
    { label: 'Возраст', value: orNone(p.ageLabel) },
    { label: 'Район', value: orNone(p.district) },
    { label: 'Откуда', value: p.from },
    { label: 'Малая группа', value: p.mdgLabel },
    { label: 'Дата', value: p.date ? formatDateFull(p.date) : noValue },
  ];
  return (
    <Drawer label={`Карточка человека: ${p.fio}`} title={p.fio} onClose={onClose}>
      <DrawerSection>
        <KeyValue rows={rows} />
      </DrawerSection>
      {p.requestId !== null && (
        <DrawerSection>
          <Button variant="primary" onClick={() => nav.openRequest(p.requestId as number)}>
            {ru.reference.openRequest}
          </Button>
        </DrawerSection>
      )}
    </Drawer>
  );
}

export function CoordinatorCard({ c, onClose }: { c: CoordinatorItem; onClose: () => void }) {
  const groups = useGroups();
  const mine = groups.data?.items.filter((g) => g.coordinator === c.name) ?? [];
  const rows: KvRow[] = [
    { label: 'Имя', value: c.name },
    { label: 'Роль', value: c.role },
    { label: 'Групп', value: c.groups },
    { label: 'Участников', value: c.people },
    { label: 'Подтверждено за 30 дн.', value: c.verified30 },
  ];
  return (
    <Drawer label={`Карточка координатора: ${c.name}`} title={c.name} subtitle={c.role} onClose={onClose}>
      <DrawerSection>
        <KeyValue rows={rows} />
      </DrawerSection>
      <DrawerSection title={ru.reference.coordinatorGroups}>
        {groups.isPending ? (
          <LoadingState lines={2} />
        ) : mine.length ? (
          <ul className={styles.planned}>
            {mine.map((g) => (
              <li key={g.id} className={styles.plannedRow}>
                <div className={styles.plannedMain}>
                  <b>
                    {groupLabel(g)} · {g.leader}
                  </b>
                  <span>
                    {g.district} · {verifiedSentence(g.verifiedDaysAgo)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>{ru.reference.coordinatorGroupsNone}</p>
        )}
      </DrawerSection>
    </Drawer>
  );
}
