import type { RequestItem } from '@contracts';
import { BUCKET_LABEL } from '../../entities/buckets';
import { formatDateShort, formatPhone, groupLabel } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { AgeTag, Button, Drawer, DrawerSection, KeyValue, Pill, type KvRow } from '../../shared/ui';
import { CandidateCard } from './CandidateCard';
import { knownParams } from './model';
import styles from './Requests.module.css';

const noValue = <span className={styles.note}>{ru.reference.notSpecified}</span>;

function noPlanHint(code: NonNullable<RequestItem['noPlan']>['code']): string {
  switch (code) {
    case 'place':
      return ru.requests.noPlanPlace;
    case 'nogroup':
      return ru.requests.noPlanNogroup;
    case 'taken':
      return ru.requests.noPlanTaken;
  }
}

function Proposal({ r }: { r: RequestItem }) {
  if (r.bucket === 'done') {
    const text = r.finalGroup
      ? `${groupLabel(r.finalGroup)}, ${r.finalGroup.leader}`
      : (r.finalGroupText ?? ru.reference.notSpecified);
    return (
      <div className={styles.approved}>
        ✓ {ru.requests.approvedPrefix} {r.finalGroup ? 'группа ' : ''}
        {text}
      </div>
    );
  }

  const p = r.proposal;
  const displaced = p?.displaced ? (
    <div className={styles.callout}>
      {ru.requests.displaced(
        groupLabel(p.displaced.group),
        p.displaced.group.whenText ?? '',
        p.displaced.takenBy.join(', '),
      )}
    </div>
  ) : null;

  // Слабый план (нужна помощь, но кандидат всё же есть): показываем его, но не как готовое решение.
  if (r.bucket === 'human') {
    return (
      <>
        {r.noPlan && (
          <div className={styles.noPlan}>
            <b>{ru.requests.noPlanTitle}</b> {r.noPlan.reason}. {noPlanHint(r.noPlan.code)}
          </div>
        )}
        {!r.noPlan && !p && (
          <div className={styles.noPlan}>
            <b>{ru.requests.noPlanTitle}</b> {ru.requests.noPlanWeak}
          </div>
        )}
        {p && (
          <>
            <div className={styles.callout}>
              {ru.requests.weakPlan(p.main.confidence ?? p.main.score, groupLabel(p.main.group))}
            </div>
            {displaced}
            <CandidateCard candidate={p.main} main />
            <div className={styles.actions}>
              <Button soon>{ru.requests.approveAnyway}</Button>
            </div>
          </>
        )}
      </>
    );
  }

  if (!p) return null;
  return (
    <>
      {displaced}
      <CandidateCard candidate={p.main} main />
      <p className={styles.note}>
        {ru.requests.basedOn(p.knownParams)}
        {r.responsible ? ` ${ru.requests.responsible}: ${r.responsible}${r.responsible.endsWith('.') ? '' : '.'}` : ''}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" soon>
          {ru.requests.approve}
        </Button>
        <Button soon>{ru.requests.callThis}</Button>
        <Button variant="ghost" soon>
          {ru.requests.decline}
        </Button>
      </div>
      {p.alternatives.length > 0 && (
        <>
          <h4 className={styles.h4}>{ru.requests.otherVariants}</h4>
          {p.alternatives.map((a) => (
            <CandidateCard key={a.group.id} candidate={a} />
          ))}
        </>
      )}
    </>
  );
}

function Params({ r }: { r: RequestItem }) {
  const [hasDistrict, hasAge, hasTime, hasStreet] = r.dataFill;
  const known = knownParams(r);
  const time = [r.days.join(', ') || (hasTime ? ru.requests.paramAnyDay : ''), r.slot ?? ''].filter(Boolean).join(' · ');
  const items = [
    {
      title: ru.requests.paramDistrict,
      on: hasDistrict,
      value: hasDistrict ? (r.district ?? '') : ru.requests.paramDistrictUnknown,
      hint: hasDistrict ? '' : r.place ? `Место «${r.place}» не разобралось в район` : '',
    },
    { title: ru.requests.paramAge, on: hasAge, value: r.ageLabel ?? ru.requests.paramUnknown, hint: ru.requests.paramAgeHint },
    { title: ru.requests.paramTime, on: hasTime, value: hasTime ? time : ru.requests.paramUnknown, hint: ru.requests.paramTimeHint },
    { title: ru.requests.paramStreet, on: hasStreet, value: hasStreet ? (r.street ?? '') : ru.requests.paramUnknown, hint: ru.requests.paramStreetHint },
  ];
  return (
    <details className={styles.fold} open={r.bucket === 'human' || known < 4}>
      <summary>
        {ru.requests.paramsTitle} ({known} из 4)
      </summary>
      <ul className={styles.params}>
        {items.map((it) => (
          <li key={it.title} className={`${styles.param} ${it.on ? styles.paramOn : ''}`}>
            <span className={styles.mark} aria-hidden="true" />
            <div>
              <div className={styles.paramTitle}>
                {it.title}
                <small>
                  {it.value}
                  <span className="visually-hidden">
                    {' '}
                    ({it.on ? ru.requests.paramKnown : ru.requests.paramUnknown})
                  </span>
                </small>
              </div>
              {it.hint && <div className={styles.hint}>{it.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{ru.requests.paramsEditLater}</p>
    </details>
  );
}

export function RequestCard({ r, onClose }: { r: RequestItem; onClose: () => void }) {
  const contacts: KvRow[] = [
    { label: ru.requests.phone, value: r.phone ? <span className="num">{formatPhone(r.phone)}</span> : noValue },
    { label: ru.requests.place, value: r.place ?? noValue },
    { label: ru.requests.source, value: r.source },
    { label: ru.requests.status, value: r.status },
    ...(r.waitingDays != null ? [{ label: ru.requests.waiting, value: `${r.waitingDays} дн.` }] : []),
    ...(r.responsible ? [{ label: ru.requests.responsible, value: r.responsible }] : []),
    ...(r.note ? [{ label: ru.requests.note, value: r.note }] : []),
  ];
  return (
    <Drawer
      docked
      label={`Карточка заявки: ${r.fio}`}
      title={r.fio}
      subtitle={
        <>
          <Pill tone={r.bucket === 'cancelled' ? 'plain' : r.bucket}>{BUCKET_LABEL[r.bucket]}</Pill>
          {r.ageLabel && <AgeTag>{r.ageLabel}</AgeTag>}
        </>
      }
      onClose={onClose}
    >
      <DrawerSection title={ru.requests.proposalTitle}>
        <Proposal r={r} />
      </DrawerSection>
      <DrawerSection title={ru.requests.contacts}>
        <KeyValue rows={contacts} />
      </DrawerSection>
      <DrawerSection>
        <Params r={r} />
      </DrawerSection>
      <DrawerSection title={ru.requests.log}>
        {r.log.length ? (
          <ul className={styles.log}>
            {[...r.log].reverse().map((l, i) => (
              <li key={i}>
                {l.at ? <span className="num">{formatDateShort(l.at)} · </span> : null}
                {l.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>{ru.requests.logEmpty}</p>
        )}
      </DrawerSection>
    </Drawer>
  );
}
