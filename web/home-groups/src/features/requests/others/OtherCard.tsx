import type { OtherItem } from '@contracts';
import { formatDateShort, formatPhone } from '../../../entities/format';
import { ru } from '../../../shared/i18n/ru';
import { AgeTag, Drawer, DrawerSection, KeyValue, Pill, StrangeBadge, StrangeBanner, type KvRow } from '../../../shared/ui';
import { DeleteRequestSection } from '../../manage';
import { subjectOfOther } from '../work/subject';
import { HeaderTools } from '../work/HeaderTools';
import { WorkPlace } from '../work/WorkPlace';
import { STATE_LABEL, STATE_TONE } from './OtherList';
import styles from './Others.module.css';
import { ReconcileBlock } from './ReconcileBlock';

const o = ru.requests.others;

const noValue = <span className={styles.note}>{ru.reference.notSpecified}</span>;

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
    ...(item.note ? [{ label: ru.requests.note, value: item.note }] : []),
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
          <Pill tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Pill>
          <span className={styles.typeInTitle}>{item.typeLabel}</span>
          {item.ageLabel && <AgeTag>{item.ageLabel}</AgeTag>}
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
      {item.reconcile && <ReconcileBlock key={`reconcile-${item.id}`} item={item} rec={item.reconcile} onClosed={onClosed} />}
      <DrawerSection title={ru.requests.contacts}>
        <KeyValue rows={contacts} />
      </DrawerSection>
      <WorkPlace key={`work-${item.id}`} subject={subjectOfOther(item)} onClosed={onClosed} />
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
