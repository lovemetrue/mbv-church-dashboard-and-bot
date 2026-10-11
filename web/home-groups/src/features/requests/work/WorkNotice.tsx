import type { WorkBlock, WorkNotice as Notice } from './useRequestWork';
import styles from './work.module.css';

/** Сообщение блока: ошибка читается сразу (alert), подтверждение — спокойно (status). */
export function WorkNoticeLine({ notice, block }: { notice: Notice | null; block: WorkBlock }) {
  if (!notice || notice.block !== block) return null;
  return notice.kind === 'error' ? (
    <p className={styles.noticeError} role="alert">
      {notice.text}
    </p>
  ) : (
    <p className={styles.noticeOk} role="status">
      {notice.text}
    </p>
  );
}
