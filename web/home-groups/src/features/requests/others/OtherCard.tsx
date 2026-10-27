import type { OtherItem } from '@contracts';
import { formatDateShort, formatPhone } from '../../../entities/format';
import { ru } from '../../../shared/i18n/ru';
import { AgeTag, Drawer, DrawerSection, KeyValue, Pill, StrangeBadge, StrangeBanner, type KvRow } from '../../../shared/ui';
import { DeleteRequestSection } from '../../manage';
import { GroupFromRequestSection, OwnGroupLink } from '../../create';
import { tableRows } from '../tableRows';
import { subjectOfOther } from '../work/subject';
import { HeaderTools } from '../work/HeaderTools';
import { WorkPlace } from '../work/WorkPlace';
import { PersonLink } from '../work/PersonLink';
import { useAppNav } from '../../../shared/nav';
import { Button } from '../../../shared/ui';
import { STATE_TONE, statusLabel } from './OtherList';
import styles from './Others.module.css';
import { PairsBlock } from './PairsBlock';
import { ProspectsBlock } from './ProspectsBlock';
import { ReconcileBlock } from './ReconcileBlock';

const o = ru.requests.others;

const noValue = <span className={styles.note}>{ru.reference.notSpecified}</span>;

/**
 * Итог закрытого обращения: что сделано (разбор по справочникам, «Закрыть»), кем и когда, и группы ссылками. Без
 * этого «обработанное» выглядело пустым: «Разобрать все готовые» ответственного не ставит, а группа была только в ленте.
 */
function OutcomeBlock({ outcome }: { outcome: NonNullable<OtherItem['outcome']> }) {
  const nav = useAppNav();
  const meta = [outcome.at ? formatDateShort(outcome.at) : null, outcome.by ? ru.requests.outcomeBy(outcome.by) : null].filter(Boolean).join(' · ');
  return (
    <DrawerSection title={ru.requests.outcomeTitle}>
      <p className={styles.outcome}>{outcome.text}</p>
      {meta && <p className={styles.note}>{meta}</p>}
      {outcome.groups.length > 0 && (
        <div className={styles.outcomeGroups}>
          {outcome.groups.map((g) => (
            <Button key={g.id} size="sm" aria-label={ru.requests.outcomeGroup(g.code)} onClick={() => nav.openGroup(g.id)}>
              {g.code}
            </Button>
          ))}
        </div>
      )}
    </DrawerSection>
  );
}

/**
 * Карточка обращения: заголовок с типом, суть обращения, «Разбор» (если сервер сверил человека со справочником
 * групп), контакты, блок «Работа с заявкой», как пришла и лента.
 * Предложений группы и кнопок «Утвердить» здесь нет: такие обращения в подбор не идут.
 * Закрыть или вернуть в работу — в блоке работы, как у заявки.
 * Ключи блоков с состоянием у каждого свои (не просто id обращения): одинаковые у соседей React путает, оставляет блоки
 * прежнего обращения, и их кнопки действуют на то обращение, а не на открытое.
 */
export function OtherCard({ item, onClose, onClosed }: { item: OtherItem; onClose: () => void; onClosed: (text: string) => void }) {
  const contacts: KvRow[] = [
    { label: ru.requests.phone, value: item.phone ? <span className="num">{formatPhone(item.phone)}</span> : noValue },
    { label: ru.requests.place, value: item.place ?? noValue },
    ...(item.address ? [{ label: ru.contact.fields.address, value: item.address }] : []),
    ...(item.schedule ? [{ label: ru.contact.fields.schedule, value: item.schedule }] : []),
    ...(item.hobby ? [{ label: ru.contact.fields.hobby, value: item.hobby }] : []),
    ...(item.profession ? [{ label: ru.contact.fields.profession, value: item.profession }] : []),
    ...(item.family ? [{ label: ru.contact.fields.family, value: item.family }] : []),
    { label: ru.requests.source, value: item.source },
    { label: ru.requests.status, value: item.status },
    ...(item.waitingDays != null && item.state === 'open' ? [{ label: ru.requests.waiting, value: `${item.waitingDays} дн.` }] : []),
    ...(item.responsible ? [{ label: ru.requests.responsible, value: item.responsible }] : []),
    ...tableRows(item.table, { finalGroup: true }),
  ];
  return (
    <Drawer
      docked
      label={o.cardLabel(item.fio)}
      title={
        <>
          {item.fio}
          <StrangeBadge mark={item.strange} size={18} />
        </>
      }
      subtitle={
        <>
          <Pill tone={STATE_TONE[item.state]}>{statusLabel(item)}</Pill>
          <span className={styles.typeInTitle}>{item.typeLabel}</span>
          {item.ageLabel && <AgeTag>{item.ageLabel}</AgeTag>}
          {item.ownGroup && <OwnGroupLink group={item.ownGroup} />}
        </>
      }
      tools={<HeaderTools subject={subjectOfOther(item)} />}
      onClose={onClose}
    >
      <StrangeBanner mark={item.strange} />
      {item.gist && (
        <DrawerSection title={o.gistTitle}>
          <p className={styles.gistBig}>{item.gist}</p>
        </DrawerSection>
      )}
      {item.state === 'open' && item.callback && <div className={styles.callout}>{o.callbackMark}</div>}
      {item.state === 'cancelled' && item.cancelReason && <div className={styles.callout}>{o.cancelReason(item.cancelReason)}</div>}
      {item.prospects && (
        <DrawerSection>
          <ProspectsBlock p={item.prospects} />
        </DrawerSection>
      )}
      {item.pairs && (
        <DrawerSection>
          <PairsBlock p={item.pairs} />
        </DrawerSection>
      )}
      {item.outcome && <OutcomeBlock outcome={item.outcome} />}
      {item.reconcile && <ReconcileBlock key={`reconcile-${item.id}`} item={item} rec={item.reconcile} onClosed={onClosed} />}
      <DrawerSection title={ru.requests.contacts}>
        <KeyValue rows={contacts} />
        <PersonLink personKey={item.personKey} fio={item.fio} />
      </DrawerSection>
      <WorkPlace key={`work-${item.id}`} subject={subjectOfOther(item)} onClosed={onClosed} />
      <GroupFromRequestSection key={`own-group-${item.id}`} requestId={item.id} ownGroup={item.ownGroup} />
      <DrawerSection title={o.original}>
        {item.original.length ? (
          <KeyValue rows={item.original.map((f) => ({ label: f.label, value: f.value }))} />
        ) : (
          <p className={styles.note}>{o.originalEmpty}</p>
        )}
      </DrawerSection>
      <DrawerSection title={o.log}>
        {item.log.length ? (
          <ul className={styles.log}>
            {item.log
              .map((l, i) => ({ l, i }))
              .reverse()
              .map(({ l, i }) => (
                <li key={`${item.id}-${i}`}>
                  {l.at && <span className="num">{formatDateShort(l.at)} · </span>}
                  {l.text}
                </li>
              ))}
          </ul>
        ) : (
          <p className={styles.note}>{o.logEmpty}</p>
        )}
      </DrawerSection>
      <DeleteRequestSection id={item.id} fio={item.fio} onDeleted={onClose} />
    </Drawer>
  );
}
