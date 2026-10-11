import { useId, useState, type FormEvent } from 'react';
import type { GroupBrief, GroupItem, LogEntry, RequestItem } from '@contracts';
import { BUCKET_LABEL } from '../../entities/buckets';
import { formatDateShort, formatPhone, groupLabel } from '../../entities/format';
import { useGroups } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { AgeTag, Button, Drawer, DrawerSection, KeyValue, NewGroupIcon, Pill, type KvRow } from '../../shared/ui';
import { CandidateCard } from './CandidateCard';
import { SavedTag } from './SavedTag';
import { isCreationEntry, knownParams, understoodTime, unavailableReason, type UnavailableReason } from './model';
import { ActionDialogs, ActionNoticeLine, isActionable, RequestActions } from './RequestActions';
import styles from './Requests.module.css';
import { useRequestActions, type RequestActionsState } from './useRequestActions';
import { useRequestParams, type ParamField } from './useRequestParams';

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

/** Кто предложил группу и напоминание, что предложение ещё не решение. */
function ProposalSource({ proposal }: { proposal: NonNullable<RequestItem['proposal']> }) {
  return (
    <>
      <p className={styles.source}>
        <b>{proposal.source === 'agent' ? ru.requests.act.sourceAgent : ru.requests.act.sourceScript}</b>
        <SavedTag saved={proposal.saved} dataChanged={proposal.dataChanged} explained />
        <span className={styles.note}>{ru.requests.act.notApproved}</span>
      </p>
      {proposal.dataChanged && <p className={styles.changedNote}>{ru.requests.rematch.changedHint}</p>}
    </>
  );
}

const ALT_REASON_TEXT: Record<UnavailableReason, string> = {
  doNotRefer: ru.requests.alt.doNotRefer,
  closed: ru.requests.alt.closed,
  noSeats: ru.requests.alt.noSeats,
};

/** «Утвердить эту группу» под запасным вариантом. Отключена, если в группу сейчас нельзя; причина сказана словами. */
function VariantAction({
  r,
  group,
  act,
  registry,
}: {
  r: RequestItem;
  group: GroupBrief;
  act: RequestActionsState;
  registry: ReadonlyMap<number, GroupItem>;
}) {
  const why = unavailableReason(group, registry.get(group.id));
  const reasonId = useId();
  return (
    <div className={styles.variantAction}>
      <Button
        disabled={why !== null || act.pending}
        aria-label={ru.requests.alt.approveAria(group.code)}
        aria-describedby={why ? reasonId : undefined}
        onClick={() => act.open({ requestId: r.id, kind: 'confirm', group })}
      >
        {ru.requests.alt.approve}
      </Button>
      {why && (
        <p id={reasonId} className={styles.variantReason}>
          {ALT_REASON_TEXT[why]}
        </p>
      )}
    </div>
  );
}

/** Группа, место в которой отдано другой заявке: выбрать её можно, сервер сам спросит про места. */
function DisplacedVariant({
  r,
  displaced,
  act,
  registry,
}: {
  r: RequestItem;
  displaced: NonNullable<NonNullable<RequestItem['proposal']>['displaced']>;
  act: RequestActionsState;
  registry: ReadonlyMap<number, GroupItem>;
}) {
  const g = displaced.group;
  const where = [g.district, g.metro, g.whenText].filter(Boolean).join(' · ');
  return (
    <article className={styles.cand}>
      <div className={styles.candHead}>
        <b>Группа {groupLabel(g)}</b>
        {g.isNew && <NewGroupIcon />}
        <span className={styles.note}>{[g.leader, g.format].filter(Boolean).join(' · ')}</span>
      </div>
      <p className={styles.note}>{ru.requests.alt.displacedBy(displaced.takenBy.join(', '))}</p>
      <div className={styles.candFoot}>
        <span className={styles.free}>
          {where ? `${where} · ` : ''}мест: {g.free} из {g.capacity}
        </span>
      </div>
      <VariantAction r={r} group={g} act={act} registry={registry} />
    </article>
  );
}

/** «Другие варианты»: запасные группы и группа, место в которой отдано другим. У каждой своя кнопка. */
function OtherVariants({ r, act }: { r: RequestItem; act: RequestActionsState }) {
  const groups = useGroups();
  const p = r.proposal;
  if (!p) return null;
  const registry = new Map<number, GroupItem>((groups.data?.items ?? []).map((g) => [g.id, g]));
  const shown = new Set([p.main.group.id, ...p.alternatives.map((a) => a.group.id)]);
  const displaced = p.displaced && !shown.has(p.displaced.group.id) ? p.displaced : null;
  if (p.alternatives.length === 0 && !displaced) return null;
  return (
    <div className={styles.variants}>
      <h4 className={styles.h4}>{ru.requests.otherVariants}</h4>
      {p.alternatives.map((a) => (
        <CandidateCard
          key={a.group.id}
          candidate={a}
          action={<VariantAction r={r} group={a.group} act={act} registry={registry} />}
        />
      ))}
      {displaced && <DisplacedVariant r={r} displaced={displaced} act={act} registry={registry} />}
    </div>
  );
}

function Proposal({ r, act }: { r: RequestItem; act: RequestActionsState }) {
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
        {!p && <RequestActions r={r} act={act} />}
        {p && (
          <>
            <ProposalSource proposal={p} />
            <div className={styles.callout}>
              {ru.requests.weakPlan(p.main.confidence ?? p.main.score, groupLabel(p.main.group))}
            </div>
            {displaced}
            <CandidateCard candidate={p.main} main />
            <RequestActions r={r} act={act} />
            <OtherVariants r={r} act={act} />
          </>
        )}
      </>
    );
  }

  // Предложения нет, но заявка открыта: «Подобрать заново» может его найти, когда данные пополнились.
  if (!p) return <RequestActions r={r} act={act} />;
  return (
    <>
      <ProposalSource proposal={p} />
      {displaced}
      <CandidateCard candidate={p.main} main />
      <p className={styles.note}>
        {ru.requests.basedOn(p.knownParams)}
        {r.responsible ? ` ${ru.requests.responsible}: ${r.responsible}${r.responsible.endsWith('.') ? '' : '.'}` : ''}
      </p>
      <RequestActions r={r} act={act} />
      <OtherVariants r={r} act={act} />
    </>
  );
}

const pr = ru.requests.params;

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 13.5l.7-3L10.8 3a1.4 1.4 0 0 1 2 2l-7.6 7.6-2.7.9Z" />
      <path d="M9.6 4.2l2.2 2.2" />
    </svg>
  );
}

/** Строка параметра, которую можно поправить: поле ввода вместо значения, пока человек правит. */
interface ParamItem {
  title: string;
  on: boolean;
  value: string;
  hint: string;
  /** Если задано, у строки есть карандаш и правится это поле. */
  field?: ParamField;
  /** Откуда значение: слова человека или правка координатора. */
  source?: 'anketa' | 'manual' | null;
  /** Как система поняла слова человека (только для времени). */
  understood?: string;
  editLabel?: string;
  placeholder?: string;
  /** Текст, который сейчас записан (для поля ввода). */
  current?: string | null;
}

function Params({ r }: { r: RequestItem }) {
  const [hasDistrict, hasAge, hasTime, hasStreet] = r.dataFill;
  const known = knownParams(r);
  const edit = useRequestParams(r.id);
  const [editing, setEditing] = useState<ParamField | null>(null);
  const [draft, setDraft] = useState('');
  const editable = r.bucket !== 'done' && r.bucket !== 'cancelled';

  const timeUnderstood = understoodTime(r);
  const timeText = r.scheduleInfo.text ?? timeUnderstood ?? '';
  const streetText = r.streetInfo.text ?? r.street ?? '';
  const items: ParamItem[] = [
    {
      title: ru.requests.paramDistrict,
      on: hasDistrict,
      value: hasDistrict ? (r.district ?? '') : ru.requests.paramDistrictUnknown,
      hint: hasDistrict ? '' : r.place ? `Место «${r.place}» не разобралось в район` : '',
    },
    // Район и возраст пока не правятся из карточки: карандаша у них нет.
    { title: ru.requests.paramAge, on: hasAge, value: r.ageLabel ?? ru.requests.paramUnknown, hint: ru.requests.paramAgeHint },
    {
      title: ru.requests.paramTime,
      on: hasTime,
      value: timeText || ru.requests.paramUnknown,
      hint: ru.requests.paramTimeHint,
      field: 'schedule',
      source: r.scheduleInfo.text ? r.scheduleInfo.source : null,
      understood: r.scheduleInfo.text ? (timeUnderstood ? pr.understood(timeUnderstood) : pr.notUnderstood) : undefined,
      editLabel: pr.editTime,
      placeholder: pr.placeholderTime,
      current: r.scheduleInfo.text,
    },
    {
      title: ru.requests.paramStreet,
      on: hasStreet,
      value: streetText || ru.requests.paramUnknown,
      hint: ru.requests.paramStreetHint,
      field: 'street',
      source: r.streetInfo.text ? r.streetInfo.source : null,
      editLabel: pr.editStreet,
      placeholder: pr.placeholderStreet,
      current: r.streetInfo.text,
    },
  ];

  const open = (it: ParamItem) => {
    edit.clearNotice();
    setDraft(it.current ?? (it.field === 'schedule' ? timeText : streetText));
    setEditing(it.field!);
  };
  const submit = async (e: FormEvent, it: ParamItem) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || text === (it.current ?? '')) return;
    if (await edit.save(it.field!, text)) setEditing(null);
  };
  const removeEdit = async (it: ParamItem) => {
    if (await edit.save(it.field!, null)) setEditing(null);
  };

  return (
    <details className={styles.fold} open={r.bucket === 'human' || known < 4}>
      <summary>
        {ru.requests.paramsTitle} ({known} из 4)
      </summary>
      <ul className={styles.params}>
        {items.map((it) => {
          const isEditing = it.field !== undefined && editing === it.field;
          return (
            <li key={it.title} className={`${styles.param} ${it.on ? styles.paramOn : ''}`}>
              <span className={styles.mark} aria-hidden="true" />
              <div className={styles.paramBody}>
                <div className={styles.paramTitle}>
                  {it.title}
                  {!isEditing && (
                    <small>
                      {it.value}
                      <span className="visually-hidden">
                        {' '}
                        ({it.on ? ru.requests.paramKnown : ru.requests.paramUnknown})
                      </span>
                    </small>
                  )}
                </div>
                {isEditing ? (
                  <form className={styles.paramForm} onSubmit={(e) => void submit(e, it)} noValidate>
                    <input
                      type="text"
                      className={styles.paramInput}
                      aria-label={it.title}
                      value={draft}
                      maxLength={200}
                      placeholder={it.placeholder}
                      disabled={edit.pending}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className={styles.paramFoot}>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={edit.pending || !draft.trim() || draft.trim() === (it.current ?? '')}
                      >
                        {edit.pending ? pr.saving : pr.save}
                      </Button>
                      <Button disabled={edit.pending} onClick={() => setEditing(null)}>
                        {pr.cancel}
                      </Button>
                      {it.source === 'manual' && (
                        <Button disabled={edit.pending} onClick={() => void removeEdit(it)}>
                          {pr.remove}
                        </Button>
                      )}
                    </div>
                    <div className={styles.hint}>{pr.limit}</div>
                  </form>
                ) : (
                  <>
                    {it.source && (
                      <div className={styles.hint}>{it.source === 'manual' ? pr.sourceManual : pr.sourceAnketa}</div>
                    )}
                    {it.understood && <div className={styles.hint}>{it.understood}</div>}
                    {it.hint && <div className={styles.hint}>{it.hint}</div>}
                  </>
                )}
              </div>
              {it.field && editable && !isEditing && (
                <Button variant="ghost" aria-label={it.editLabel} disabled={edit.pending} onClick={() => open(it)}>
                  <PencilIcon />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {edit.notice &&
        (edit.notice.kind === 'error' ? (
          <p className={styles.noticeError} role="alert">
            {edit.notice.text}
          </p>
        ) : (
          <p className={styles.noticeOk} role="status">
            {edit.notice.text}
            {edit.notice.hint && <span className={styles.noticeHint}>{edit.notice.hint}</span>}
          </p>
        ))}
    </details>
  );
}

/** Запись журнала «Заявка создана»: раскрывается, чтобы сверить анкету и то, как её поняла система. */
function CreationDetails({ r }: { r: RequestItem }) {
  const o = ru.requests.original;
  const time = understoodTime(r);
  const filled: KvRow[] = r.original.map((f) => ({ label: f.label, value: f.value }));
  const understood: KvRow[] = [
    { label: o.district, value: r.district ?? o.districtNone },
    { label: o.age, value: r.ageLabel ?? o.ageNone },
    { label: o.time, value: time ?? o.timeNone },
    { label: o.street, value: r.street ?? o.streetNone },
  ];
  return (
    <div className={styles.origin}>
      <h4 className={styles.originTitle}>{o.filledTitle}</h4>
      {filled.length ? <KeyValue rows={filled} /> : <p className={styles.note}>{o.filledEmpty}</p>}
      <h4 className={styles.originTitle}>{o.understoodTitle}</h4>
      <KeyValue rows={understood} />
    </div>
  );
}

function LogRow({ r, l }: { r: RequestItem; l: LogEntry }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const date = l.at ? <span className="num">{formatDateShort(l.at)} · </span> : null;
  if (!isCreationEntry(l.text)) {
    return (
      <li>
        {date}
        {l.text}
      </li>
    );
  }
  return (
    <li>
      <button type="button" className={styles.logToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span>
          {date}
          <span>{l.text}</span>
        </span>
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <div id={bodyId} hidden={!open}>
        {open && <CreationDetails r={r} />}
      </div>
    </li>
  );
}

export interface RequestNeighbors {
  /** Место в списке (с единицы); null — заявки в списке уже нет (например, после «Утвердить»). */
  position: number | null;
  total: number;
  prevId: number | null;
  nextId: number | null;
  onGo: (id: number) => void;
}

/** «← Предыдущая · 3 из 54 · Следующая →»: переход по текущему отфильтрованному списку. */
function NeighborsNav({ n, closed }: { n: RequestNeighbors; closed: boolean }) {
  const t = ru.requests.nav;
  return (
    <nav className={styles.neighbors} aria-label={t.label}>
      <Button disabled={n.prevId === null} onClick={() => n.prevId !== null && n.onGo(n.prevId)}>
        {t.prev}
      </Button>
      <span className={`${styles.neighborsPos} num`} aria-live="polite">
        {n.position !== null ? t.position(n.position, n.total) : ''}
      </span>
      {/* После «Утвердить» заявка уходит из очереди: следующая становится главным действием. */}
      <Button variant={closed ? 'primary' : 'default'} disabled={n.nextId === null} onClick={() => n.nextId !== null && n.onGo(n.nextId)}>
        {closed ? t.nextAfter : t.next}
      </Button>
    </nav>
  );
}

export function RequestCard({ r, onClose, neighbors }: { r: RequestItem; onClose: () => void; neighbors?: RequestNeighbors }) {
  // Состояние действий держим здесь, а не в кнопках: после «Утвердить» кнопки пропадают,
  // а подтверждение должно остаться на экране.
  const act = useRequestActions(r);
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
      {neighbors && <NeighborsNav n={neighbors} closed={r.bucket === 'done' || neighbors.position === null} />}
      <DrawerSection title={ru.requests.proposalTitle}>
        {/* Пока открыто окно, ошибка показывается в нём. */}
        {!act.dialog && <ActionNoticeLine notice={act.notice} />}
        {r.callback && isActionable(r) && <div className={styles.callout}>{ru.requests.act.callbackMark}</div>}
        <Proposal r={r} act={act} />
      </DrawerSection>
      <ActionDialogs r={r} act={act} />
      <DrawerSection title={ru.requests.contacts}>
        <KeyValue rows={contacts} />
      </DrawerSection>
      <DrawerSection>
        <Params key={r.id} r={r} />
      </DrawerSection>
      <DrawerSection title={ru.requests.log}>
        {r.log.length ? (
          <ul className={styles.log}>
            {r.log
              .map((l, i) => ({ l, i }))
              .reverse()
              .map(({ l, i }) => (
                // Ключ по порядку в исходном журнале: новые записи дописываются в конец и не сдвигают раскрытые.
                <LogRow key={`${r.id}-${i}`} r={r} l={l} />
              ))}
          </ul>
        ) : (
          <p className={styles.note}>{ru.requests.logEmpty}</p>
        )}
      </DrawerSection>
    </Drawer>
  );
}
