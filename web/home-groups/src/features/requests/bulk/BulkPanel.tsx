import { useEffect, useId, useRef, useState } from 'react';
import { pluralForm } from '../../../entities/plural';
import { ru } from '../../../shared/i18n/ru';
import { Button, Modal } from '../../../shared/ui';
import { useFormMeta } from '../../create/useFormMeta';
import styles from './Bulk.module.css';
import { BULK_LIMIT } from './selection';
import type { BulkRequest, BulkState } from './useBulk';

const b = ru.requests.bulk;

/** «Передать 2 заявки» (винительный) и «у 2 заявок» (родительный): в вопросе нужны обе формы. */
const accusative = (n: number) => `${n} ${pluralForm(n, ['заявку', 'заявки', 'заявок'])}`;
const genitive = (n: number) => `${n} ${pluralForm(n, ['заявки', 'заявок', 'заявок'])}`;

/** Значение пункта «Никто» в списке: имя координатора так не называется. */
const NOBODY = '\u0000nobody';

function question(asked: BulkRequest, n: number): string {
  if (asked.kind === 'assign') {
    return asked.who === null ? b.confirmAssignNobody(genitive(n)) : b.confirmAssign(accusative(n), asked.who);
  }
  return asked.value ? b.confirmNeedCall(genitive(n)) : b.confirmClearCall(genitive(n));
}

function confirmLabel(asked: BulkRequest): string {
  if (asked.kind === 'assign') return b.confirmAssignOk;
  return asked.value ? b.confirmNeedCallOk : b.confirmClearCallOk;
}

/**
 * Всё, что относится к массовым действиям, над списком заявок: итог прошлого действия,
 * «Выбрать все видимые» и, пока что-то выбрано, панель действий. Окно подтверждения — здесь же.
 */
export function BulkPanel({ bulk, visibleCount }: { bulk: BulkState; visibleCount: number }) {
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // «Частично выбрано» нельзя задать атрибутом, только свойством элемента.
    if (allRef.current) allRef.current.indeterminate = bulk.partlySelected;
  }, [bulk.partlySelected]);

  return (
    <div className={styles.panel}>
      {/* Область живая и есть всегда: скринридер читает только то, что в неё добавили. */}
      <div role="status" className={bulk.notice ? (bulk.notice.kind === 'ok' ? styles.noticeOk : styles.noticeError) : undefined}>
        {bulk.notice?.text}
      </div>
      {visibleCount > 0 && (
        <div className={styles.selectRow}>
          <label className={styles.selectAll}>
            <input type="checkbox" ref={allRef} checked={bulk.allSelected} onChange={bulk.toggleAll} />
            <span>{b.selectAll}</span>
          </label>
          {bulk.capped && <span className={styles.hint}>{b.selectAllCapped(visibleCount, BULK_LIMIT)}</span>}
          {bulk.limitReached && !bulk.capped && <span className={styles.hint}>{b.limitReached(BULK_LIMIT)}</span>}
        </div>
      )}
      {bulk.ids.length > 0 && <BulkBar bulk={bulk} />}
      {bulk.asked && (
        <Modal title={question(bulk.asked, bulk.ids.length)} onClose={bulk.cancel}>
          <p className={styles.confirmHint}>{b.confirmHint}</p>
          <div className={styles.dialogFoot}>
            <Button onClick={bulk.cancel} disabled={bulk.running}>
              {b.confirmCancel}
            </Button>
            <Button variant="primary" onClick={() => void bulk.confirm()} disabled={bulk.running}>
              {bulk.running ? b.working : confirmLabel(bulk.asked)}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BulkBar({ bulk }: { bulk: BulkState }) {
  const selectId = useId();
  const meta = useFormMeta();
  const [who, setWho] = useState('');
  const coordinators = meta.data?.coordinators ?? [];

  return (
    <section className={styles.bar} aria-label={b.barLabel}>
      <p className={styles.count}>{b.selected(bulk.ids.length)}</p>
      <div className={styles.assign}>
        <label htmlFor={selectId} className={styles.label}>
          {b.assignLabel}
        </label>
        <select
          id={selectId}
          className={styles.select}
          value={who}
          disabled={bulk.running || meta.isPending || meta.isError}
          onChange={(e) => setWho(e.target.value)}
        >
          <option value="" disabled>
            {b.assignPlaceholder}
          </option>
          <option value={NOBODY}>{b.assignNobody}</option>
          {coordinators.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          disabled={bulk.running || who === ''}
          onClick={() => bulk.ask({ kind: 'assign', who: who === NOBODY ? null : who })}
        >
          {b.assign}
        </Button>
      </div>
      {meta.isPending && <p className={styles.hint}>{b.assignLoading}</p>}
      {meta.isError && (
        <p className={styles.hint}>
          {b.assignListFailed}{' '}
          <Button size="sm" onClick={() => void meta.refetch()}>
            {ru.states.retry}
          </Button>
        </p>
      )}
      <div className={styles.buttons}>
        <Button disabled={bulk.running} onClick={() => bulk.ask({ kind: 'need-call', value: true })}>
          {b.needCall}
        </Button>
        <Button disabled={bulk.running} onClick={() => bulk.ask({ kind: 'need-call', value: false })}>
          {b.clearCall}
        </Button>
        <Button variant="ghost" disabled={bulk.running} onClick={bulk.clear}>
          {b.clearSelection}
        </Button>
      </div>
    </section>
  );
}
