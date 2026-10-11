import { useId, useState } from 'react';
import type { CallResult } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button } from '../../../shared/ui';
import styles from './work.module.css';
import { WorkNoticeLine } from './WorkNotice';
import type { RequestWorkState } from './useRequestWork';

const w = ru.requests.work;

/** Длина комментария к звонку по контракту. */
const COMMENT_MAX = 500;

const RESULTS: { result: CallResult; label: string }[] = [
  { result: 'reached', label: w.callReached },
  { result: 'no_answer', label: w.callNoAnswer },
  { result: 'later', label: w.callLater },
  { result: 'refused', label: w.callRefused },
];

/**
 * «Итог звонка»: нажатие на итог сразу записывает звонок вместе с тем, что набрано в комментарии.
 * При ошибке комментарий остаётся: набирать заново было бы обидно.
 */
export function CallOutcome({ work }: { work: RequestWorkState }) {
  const headId = useId();
  const fieldId = useId();
  const hintId = useId();
  const [comment, setComment] = useState('');

  const record = async (result: CallResult) => {
    if (await work.logCall(result, comment)) setComment('');
  };

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {w.callTitle}
      </h4>
      <label className={styles.label} htmlFor={fieldId}>
        {w.callCommentLabel}
      </label>
      <textarea
        id={fieldId}
        className={styles.textarea}
        rows={2}
        maxLength={COMMENT_MAX}
        value={comment}
        disabled={work.pending}
        aria-describedby={hintId}
        onChange={(e) => setComment(e.target.value)}
      />
      <p id={hintId} className={styles.hint}>
        {w.callCommentHint}
      </p>
      <div className={styles.row}>
        {RESULTS.map((o) => (
          <Button key={o.result} disabled={work.pending} onClick={() => void record(o.result)}>
            {o.label}
          </Button>
        ))}
      </div>
      <p className={styles.hint}>{w.callHint}</p>
      <WorkNoticeLine notice={work.notice} block="call" />
    </section>
  );
}
