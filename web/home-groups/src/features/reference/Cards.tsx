import { useCanChange } from '../../shared/access';
import { GenderField } from '../gender/GenderField';
import type { CoordinatorItem, GroupItem, PersonItem } from '@contracts';
import { formatDateFull, formatPhone, groupLabel, healthTone } from '../../entities/format';
import { registrationCardUrl, registrationQrUrl } from '../../shared/api/base';
import { useGroups } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, Drawer, DrawerSection, KeyValue, LoadingState, GroupMarks, Meter, Pill, StrangeBadge, StrangeBanner, type KvRow } from '../../shared/ui';
import { LinkButton } from '../create';
import { StrangeSection } from '../strange';
import { CoordinatorActions, DeletePersonSection, GroupActions, GroupHeaderTools, MembersSection, PersonActions, PersonGroups, PersonHeaderTools } from '../manage';
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

/**
 * Строки «Данные группы»: одни и те же в карточке справочника и в окне просмотра из заявки. `openPerson` нет —
 * значит, окно только для просмотра, и перехода к ведущему в «Люди» не будет.
 */
export function groupDataRows(g: GroupItem, openPerson?: (key: string) => void): KvRow[] {
  // Ведущий и соведущий связаны с «Людьми» (обращением «уже веду группу» или выбором в форме правки) — рядом с именем
  // переход к карточке. Ключ («u12», «p7») человеку ничего не говорит, поэтому показываем только переход.
  const person = (name: string, key: string | null, aria: string) => (
    <span className={styles.leaderLinked}>
      <span>{name}</span>
      {key && <span className={styles.note}>{ru.reference.leaderLinked}</span>}
      {key && openPerson && (
        <Button size="sm" onClick={() => openPerson(key)} aria-label={aria}>
          {ru.reference.openLeader}
        </Button>
      )}
    </span>
  );
  return [
    // Двое ведущих — двумя строками, одна под другой: так видно, что это два человека, а не одно длинное имя.
    {
      label: g.coLeader ? ru.reference.leaders : ru.reference.leader,
      value: (
        <span className={styles.leaderLines}>
          {person(g.leader, g.leaderKey, ru.reference.openLeaderAria)}
          {g.coLeader && person(g.coLeader, g.coLeaderKey, ru.reference.openCoLeaderAria)}
        </span>
      ),
    },
    { label: 'Возраст', value: orNone(g.ageText) },
    { label: 'Когда', value: g.whenText ?? <Pill tone="human">{ru.reference.notSpecified}</Pill> },
    // Ответ ведущего на досылку сам в группу не переносится: координатор сверяет его с «Когда» и адресом и правит группу.
    ...(g.leaderAnswer
      ? [
          {
            label: ru.reference.leaderAnswer,
            value: (
              <>
                {g.leaderAnswer.schedule && <div>{ru.reference.leaderAnswerWhen(g.leaderAnswer.schedule)}</div>}
                {g.leaderAnswer.address && <div>{ru.reference.leaderAnswerWhere(g.leaderAnswer.address)}</div>}
                <span className={styles.note}>{ru.reference.leaderAnswerHint}</span>
              </>
            ),
          },
        ]
      : []),
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
    { label: 'Направление', value: g.direction },
    { label: 'Состав', value: orNone(g.composition) },
    { label: 'Телефон', value: g.phone ? <span className="num">{formatPhone(g.phone)}</span> : noValue },
    ...(g.coLeaderPhone ? [{ label: 'Телефон соведущего', value: <span className="num">{formatPhone(g.coLeaderPhone)}</span> }] : []),
    { label: 'Адрес', value: g.address ? (g.addressGeo === 'found' ? `${g.address} · ${ru.reference.geoFound}` : g.addressGeo === 'missing' ? `${g.address} · ${ru.reference.geoMissing}` : g.address) : noValue },
    { label: 'Метро или ориентир', value: orNone(g.metro) },
    { label: 'Статус', value: g.status },
    // Поля, которые вводят при создании группы (как в старом дашборде): что заполнено, то и видно.
    ...(g.training ? [{ label: 'Обучение', value: g.training }] : []),
    { label: 'Данные проверены', value: g.checked ? ru.reference.yes : ru.reference.no },
    { label: '«40 дней»', value: g.campaignRegistered ? ru.reference.campaignYes : ru.reference.no },
    // Бывший статус «Кампания»: показываем только у отмеченных, «Нет» у остальных был бы шумом.
    ...(g.campaignOnly ? [{ label: 'Только в кампанию', value: ru.reference.yes }] : []),
    ...(g.doNotRefer ? [{ label: 'Не направлять', value: <Pill tone="crit">{ru.reference.yes}</Pill> }] : []),
    ...(g.chamber ? [{ label: 'Камерная', value: <Pill tone="crit">{ru.reference.yes}</Pill> }] : []),
    // Телефоны и адрес пусты не потому, что их нет: сервер скрыл контакты камерной группы от этого входа.
    ...(g.contactsHidden ? [{ label: 'Контакты', value: g.chamber ? ru.manage.group.contactsHidden : ru.manage.group.phonesHiddenNote }] : []),
    ...(g.comment ? [{ label: 'Комментарий', value: g.comment }] : []),
  ];
}

export function GroupCard({ g, onClose }: { g: GroupItem; onClose: () => void }) {
  const nav = useAppNav();
  const tone = healthTone(g.health.score);
  const rows = groupDataRows(g, nav.openPerson);
  return (
    <Drawer
      label={`Карточка группы ${groupLabel(g)}`}
      title={
        <>
          {`Группа ${groupLabel(g)}`}
          {(g.isNew || g.empty) && (
            <>
              {' '}
              <GroupMarks g={g} />
            </>
          )}
        </>
      }
      subtitle={[g.leader, g.district, g.metro].filter(Boolean).join(' · ')}
      tools={<GroupHeaderTools key={g.id} g={g} />}
      toolsBelow
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
        <GroupActions key={g.id} g={g} onDeleted={onClose} />
      </DrawerSection>
      <MembersSection key={g.id} g={g} />
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

/**
 * «Заявки и обращения» в конце карточки человека: каждая — кнопкой, которая открывает её в «Заявках» (заявку в группу —
 * в «Хотят в группу», остальное — в «Других обращениях»). Так из человека можно дойти до всего, что он оставлял.
 */
function PersonRequests({ p }: { p: PersonItem }) {
  const nav = useAppNav();
  if (p.requests.length === 0) return null;
  const t = ru.members.person;
  return (
    <DrawerSection title={t.requestsTitle}>
      <ul className={styles.planned}>
        {p.requests.map((r) => (
          <li key={r.id} className={styles.plannedRow}>
            <div className={styles.plannedMain}>
              <b>
                {r.label} №{r.id}
              </b>
              <span>{t.requestState[r.state]}</span>
            </div>
            <Button
              size="sm"
              aria-label={t.openRequestAria(r.label, r.id)}
              onClick={() => (r.kind === 'join' ? nav.openRequest(r.id) : nav.openOther(r.id, r.kind === 'lead' ? 'leads' : 'questions'))}
            >
              {ru.reference.openPlanned}
            </Button>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

export function PersonCard({ p, onClose }: { p: PersonItem; onClose: () => void }) {
  const nav = useAppNav();
  const rows: KvRow[] = [
    { label: 'ФИО', value: p.fio },
    { label: ru.gender.label, value: <GenderField key={p.key} personKey={p.key} gender={p.gender} /> },
    // «Люди» — сквозной справочник: человек из команды служения ведёт в свою строку в «Координаторах».
    ...(p.team
      ? [{
          label: ru.reference.teamTitle,
          value: (
            <>
              {p.team.role || '—'}{' '}
              <Button size="sm" variant="ghost" aria-label={ru.reference.openInTeamAria(p.fio)} onClick={() => nav.openCoordinator(p.team!.coordinatorId)}>
                {ru.reference.openInTeam}
              </Button>
            </>
          ),
        }]
      : []),
    { label: 'Телефон', value: p.phone ? <span className="num">{formatPhone(p.phone)}</span> : noValue },
    { label: 'Возраст', value: orNone(p.ageLabel) },
    { label: 'Район', value: orNone(p.district) },
    // Подбор идёт сначала по адресу, а если он не заполнен — по району, метро или ориентиру.
    { label: 'Адрес', value: p.address ? (p.addressGeo === 'found' ? `${p.address} · ${ru.reference.geoFound}` : p.addressGeo === 'missing' ? `${p.address} · ${ru.reference.geoMissing}` : p.address) : noValue },
    { label: 'Район, метро, ориентир', value: orNone(p.place) },
    { label: ru.contact.fields.schedule, value: orNone(p.schedule) },
    { label: ru.contact.fields.hobby, value: orNone(p.hobby) },
    { label: ru.contact.fields.profession, value: orNone(p.profession) },
    { label: ru.contact.fields.family, value: orNone(p.family) },
    { label: ru.contact.fields.note, value: orNone(p.note) },
    { label: 'Откуда', value: p.from },
    // Ответы регистрации: то, что служитель вписал в форму (или человек — в боте), видно и потом.
    ...(p.church ? [{ label: 'Церковь', value: p.church }] : []),
    { label: 'Малая группа', value: p.mdgLabel },
    ...(p.leaderName ? [{ label: 'Кто ведущий', value: p.leaderName }] : []),
    ...(p.preferredContact ? [{ label: 'Как удобнее связаться', value: p.preferredContact }] : []),
    { label: 'Дата', value: p.date ? formatDateFull(p.date) : noValue },
    ...(p.registrationNo !== null ? [{ label: ru.create.registration.numberRow, value: <span className="num">№{p.registrationNo}</span> }] : []),
    ...(p.registrationNo !== null
      ? [{ label: 'Набор', value: p.kitIssuedOn ? `${ru.reference.kitIssued} ${formatDateFull(p.kitIssuedOn)}` : ru.reference.kitNotIssued }]
      : []),
  ];
  // Печатная карточка и QR строятся по участнику: у заявки из таблицы без участника их нет,
  // и у участника без номера регистрации тоже (карточку нечем подписать).
  const registrationLinks = p.userId !== null && p.registrationNo !== null ? { card: registrationCardUrl(p.userId), qr: registrationQrUrl(p.userId) } : null;
  return (
    <Drawer
      label={`Карточка человека: ${p.fio}`}
      title={
        <>
          {p.fio}
          <StrangeBadge mark={p.strange} size={18} />
        </>
      }
      tools={<PersonHeaderTools key={p.key} p={p} />}
      toolsBelow
      onClose={onClose}
    >
      <StrangeBanner mark={p.strange} />
      <DrawerSection>
        <KeyValue rows={rows} />
        <PersonActions key={p.key} p={p} onDeleted={onClose} />
      </DrawerSection>
      <DrawerSection>
        <StrangeSection key={p.key} target={{ kind: 'person', key: p.key }} mark={p.strange} />
      </DrawerSection>
      <PersonGroups p={p} />
      {registrationLinks && (
        <DrawerSection>
          <div className={styles.cardActions}>
            <LinkButton href={registrationLinks.card}>{ru.create.registration.cardLink}</LinkButton>
            <LinkButton href={registrationLinks.qr}>{ru.create.registration.qrLink}</LinkButton>
          </div>
        </DrawerSection>
      )}
      <PersonRequests p={p} />
      <DeletePersonSection userId={p.userId} fio={p.fio} onDeleted={onClose} />
    </Drawer>
  );
}

export function CoordinatorCard({ c, onClose }: { c: CoordinatorItem; onClose: () => void }) {
  const groups = useGroups();
  const canChange = useCanChange();
  const nav = useAppNav();
  const mine = groups.data?.items.filter((g) => g.coordinator === c.name) ?? [];
  // Участник команды — человек из «Людей»: имя и телефон оттуда, а переход ведёт в его карточку.
  const personKey = c.personKey;
  const rows: KvRow[] = [
    {
      label: 'Имя',
      value: personKey ? (
        <>
          {c.name}{' '}
          <Button size="sm" variant="ghost" aria-label={ru.reference.openInPeopleAria(c.name)} onClick={() => nav.openPerson(personKey)}>
            {ru.reference.openInPeople}
          </Button>
        </>
      ) : (
        <>
          {c.name} · <span className={styles.note}>{ru.reference.coordinatorNoPerson}</span>
        </>
      ),
    },
    { label: ru.reference.coordinatorPhone, value: c.phone ? <span className="num">{formatPhone(c.phone)}</span> : noValue },
    { label: 'Роль', value: c.role },
    { label: 'Групп', value: c.groups },
    { label: 'Участников', value: c.people },
    { label: 'Подтверждено за 30 дн.', value: c.verified30 },
  ];
  return (
    <Drawer label={`Карточка координатора: ${c.name}`} title={c.name} subtitle={c.role} onClose={onClose}>
      <DrawerSection>
        <KeyValue rows={rows} />
        {canChange && <CoordinatorActions key={c.id} c={c} onDeleted={onClose} />}
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
