import { pluralForm } from '../../../entities/plural';
import { ru } from '../../../shared/i18n/ru';
import { Button, Modal } from '../../../shared/ui';
import { READY_BULK_LIMIT, type ReadyToReconcile } from './model';
import styles from './Others.module.css';
import type { ReadyBulkState } from './useReconcile';

const t = ru.requests.others.ready;

const appeals = (n: number) => `${n} ${pluralForm(n, ['обращение', 'обращения', 'обращений'])}`;

/**
 * «Разобрать все готовые (N)» над списком обращений и окно подтверждения. Это массовое действие над живыми
 * составами групп, поэтому окно есть, в отличие от кнопки в карточке одного обращения. Итог показывает
 * тот, кто владеет экраном (`onDone`): строка итога живёт над списком и переживает перерисовки.
 */
export function ReadyBulk({
  ready,
  bulk,
  onDone,
}: {
  ready: ReadyToReconcile;
  bulk: ReadyBulkState;
  onDone: (text: string) => void;
}) {
  if (ready.total === 0 && !bulk.error && !bulk.asked) return null;

  const confirm = async () => {
    const text = await bulk.confirm();
    if (text !== null) onDone(text);
  };

  return (
    <div className={styles.bulk}>
      {ready.total > 0 && (
        <Button variant="primary" disabled={bulk.running} onClick={() => bulk.ask(ready.ids)}>
          {t.button(ready.total)}
        </Button>
      )}
      {bulk.error && (
        <p className={styles.recError} role="alert">
          {bulk.error}
        </p>
      )}
      {bulk.asked && (
        <Modal title={t.dialogTitle} onClose={bulk.cancel}>
          <p className={styles.confirmText}>{t.text(appeals(bulk.asked.length))}</p>
          {ready.capped && <p className={styles.note}>{t.capped(ready.total, READY_BULK_LIMIT)}</p>}
          <div className={styles.dialogFoot}>
            <Button onClick={bulk.cancel} disabled={bulk.running}>
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={bulk.running}>
              {bulk.running ? t.working : t.confirm}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
