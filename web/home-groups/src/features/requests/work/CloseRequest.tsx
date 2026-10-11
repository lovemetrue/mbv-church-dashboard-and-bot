import { useId, useState, type FormEvent } from 'react';
import type { CancelReason, CloseBody } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button, Modal } from '../../../shared/ui';
import type { WorkSubject } from './subject';
import styles from './work.module.css';
import { WorkNoticeLine } from './WorkNotice';
import type { RequestWorkState } from './useRequestWork';

const c = ru.requests.close;

/** Длина комментария по контракту: больше сервер не примет. */
const COMMENT_MAX = 500;
/** Порядок причин — как в старом дашборде: сначала самые частые. */
const REASONS: readonly CancelReason[] = ['declined', 'no_answer', 'duplicate', 'self_found', 'other'];

/** Итог для сообщения на экране. Комментарий в него не попадает: он может содержать личное. */
function resultText(body: CloseBody): string {
  return body.outcome === 'done' ? c.resultDone : c.resultCancel(c.resultReasons[body.reason ?? 'other']);
}

function CloseForm({
  work,
  onSubmit,
  onCancel,
}: {
  work: RequestWorkState;
  onSubmit: (body: CloseBody, result: string) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<CloseBody['outcome'] | null>(null);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const commentId = useId();
  const hintId = useId();
  const doneId = useId();
  const cancelId = useId();
  const needComment = outcome === 'cancel' && reason === 'other';
  const ready = outcome === 'done' || (outcome === 'cancel' && reason !== null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || work.pending) return;
    const text = comment.trim();
    // Для «Другое» без пояснения из причины ничего не понять; сервер проверяет то же, но так быстрее и понятнее.
    if (needComment && !text) {
      setMissing(true);
      return;
    }
    // Причина принадлежит только аннулированию: выбрали причину и передумали — она не уходит.
    const body: CloseBody = outcome === 'done' ? { outcome } : { outcome: 'cancel', reason: reason! };
    if (text) body.comment = text;
    onSubmit(body, resultText(body));
  };

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{c.outcomeLegend}</legend>
        <label className={styles.choice}>
          {/* Имя — только название выбора, пояснение читается как описание: иначе имя кнопки выбора было бы абзацем. */}
          <input
            type="radio"
            name="close-outcome"
            checked={outcome === 'done'}
            disabled={work.pending}
            aria-labelledby={`${doneId}-t`}
            aria-describedby={`${doneId}-h`}
            onChange={() => {
              setOutcome('done');
              setMissing(false);
            }}
          />
          <span>
            <span id={`${doneId}-t`}>{c.outcomeDone}</span>
            <small id={`${doneId}-h`} className={styles.choiceHint}>
              {c.outcomeDoneHint}
            </small>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name="close-outcome"
            checked={outcome === 'cancel'}
            disabled={work.pending}
            aria-labelledby={`${cancelId}-t`}
            aria-describedby={`${cancelId}-h`}
            onChange={() => setOutcome('cancel')}
          />
          <span>
            <span id={`${cancelId}-t`}>{c.outcomeCancel}</span>
            <small id={`${cancelId}-h`} className={styles.choiceHint}>
              {c.outcomeCancelHint}
            </small>
          </span>
        </label>
      </fieldset>
      {outcome === 'cancel' && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{c.reasonLegend}</legend>
          {REASONS.map((value) => (
            <label key={value} className={styles.choice}>
              <input
                type="radio"
                name="close-reason"
                checked={reason === value}
                disabled={work.pending}
                onChange={() => {
                  setReason(value);
                  setMissing(false);
                }}
              />
              <span>{c.reasons[value]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label htmlFor={commentId} className={styles.label}>
        {needComment ? c.commentRequired : c.commentOptional}
      </label>
      <textarea
        id={commentId}
        className={styles.textarea}
        rows={3}
        maxLength={COMMENT_MAX}
        value={comment}
        disabled={work.pending}
        aria-required={needComment}
        aria-invalid={missing}
        aria-describedby={missing ? `${hintId}-missing` : hintId}
        onChange={(e) => {
          setComment(e.target.value);
          if (e.target.value.trim()) setMissing(false);
        }}
      />
      <p id={hintId} className={styles.hint}>
        {c.commentHint}
      </p>
      {missing && (
        <p id={`${hintId}-missing`} className={styles.noticeError} role="alert">
          {c.commentMissing}
        </p>
      )}
      {/* Ошибка запроса — в окне, пока оно открыто: так не теряется введённое. */}
      <WorkNoticeLine notice={work.notice} block="close" />
      <div className={styles.dialogFoot}>
        <Button disabled={work.pending} onClick={onCancel}>
          {c.cancel}
        </Button>
        <Button type="submit" variant="primary" aria-label={c.submitAria} disabled={!ready || work.pending}>
          {work.pending ? c.submitting : c.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * «Закрыть заявку…» у открытой записи и «Вернуть в работу» у закрытой (обработанной, утверждённой,
 * аннулированной). Оба действия идут через окно: закрытие просит исход и причину, возврат — подтверждение,
 * потому что снимает группу.
 *
 * `onClosed` вызывается после успешного закрытия, когда списки уже перечитаны: тот, кто показывает
 * карточку, закрывает её и оставляет на экране итог (заявка из списка могла пропасть — её аннулировали).
 */
export function CloseRequest({
  subject,
  work,
  onClosed,
}: {
  subject: WorkSubject;
  work: RequestWorkState;
  onClosed: (text: string) => void;
}) {
  const headId = useId();
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const isOpen = subject.state === 'open';

  const show = (kind: 'close' | 'reopen') => {
    work.clearNotice();
    setDialog(kind);
  };
  // Пока запрос идёт, окно не закрывается: ответ придёт в него же.
  const dismiss = () => {
    if (!work.pending) setDialog(null);
  };

  const close = async (body: CloseBody, result: string) => {
    if (await work.close(body, c.closedNote(subject.fio, result))) {
      setDialog(null);
      onClosed(c.closedNote(subject.fio, result));
    }
  };
  const reopen = async () => {
    if (await work.reopen()) setDialog(null);
  };

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {isOpen ? c.title : c.reopenTitle}
      </h4>
      <Button disabled={work.pending} onClick={() => show(isOpen ? 'close' : 'reopen')}>
        {isOpen ? c.openBtn : c.reopenBtn}
      </Button>
      <p className={styles.hint}>{isOpen ? c.openHint : c.reopenHint}</p>
      {dialog === null && <WorkNoticeLine notice={work.notice} block="close" />}
      {dialog === 'close' && (
        <Modal title={c.dialogTitle} onClose={dismiss}>
          <CloseForm work={work} onSubmit={(b, r) => void close(b, r)} onCancel={dismiss} />
        </Modal>
      )}
      {dialog === 'reopen' && (
        <Modal title={c.reopenDialogTitle} onClose={dismiss}>
          <p className={styles.confirm}>{subject.kind === 'request' ? c.reopenTextRequest : c.reopenTextOther}</p>
          <WorkNoticeLine notice={work.notice} block="close" />
          <div className={styles.dialogFoot}>
            <Button disabled={work.pending} onClick={dismiss}>
              {c.cancel}
            </Button>
            <Button variant="primary" disabled={work.pending} onClick={() => void reopen()}>
              {work.pending ? c.reopening : c.reopenBtn}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
