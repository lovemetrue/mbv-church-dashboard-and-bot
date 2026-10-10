import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { RejectReason } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Requests.module.css';

const a = ru.requests.act;
const REASONS: readonly RejectReason[] = ['time', 'far', 'age', 'declined', 'other'];

interface RejectFormProps {
  pending: boolean;
  /** Ошибка последнего запроса, если была. */
  notice: ReactNode;
  onSubmit: (reason: RejectReason, comment: string) => void;
  onCancel: () => void;
}

/**
 * Причина отказа от предложенной группы. Для «Другое» комментарий обязателен: без него
 * из причины ничего не понять, а учитывать её потом нечем. Проверка здесь, до запроса;
 * сервер проверяет то же самое повторно.
 */
export function RejectForm({ pending, notice, onSubmit, onCancel }: RejectFormProps) {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const commentId = useId();
  const hintId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason || pending) return;
    if (reason === 'other' && !comment.trim()) {
      setMissing(true);
      return;
    }
    onSubmit(reason, comment);
  };

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{a.rejectReasonLabel}</legend>
        <p className={styles.note}>{a.rejectLead}</p>
        {REASONS.map((value) => (
          <label key={value} className={styles.choice}>
            <input
              type="radio"
              name="reject-reason"
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                setMissing(false);
              }}
            />
            <span>{a.rejectReasons[value]}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={commentId} className={styles.fieldLabel}>
        {reason === 'other' ? a.rejectCommentRequired : a.rejectCommentOptional}
      </label>
      <textarea
        id={commentId}
        className={styles.textarea}
        rows={3}
        value={comment}
        aria-required={reason === 'other'}
        aria-invalid={missing}
        aria-describedby={missing ? hintId : undefined}
        onChange={(e) => {
          setComment(e.target.value);
          if (e.target.value.trim()) setMissing(false);
        }}
      />
      {missing && (
        <p id={hintId} className={styles.noticeError} role="alert">
          {a.rejectCommentMissing}
        </p>
      )}
      {notice}
      <div className={styles.dialogFoot}>
        <Button onClick={onCancel}>{a.cancel}</Button>
        <Button type="submit" variant="primary" disabled={!reason || pending}>
          {a.reject}
        </Button>
      </div>
    </form>
  );
}
