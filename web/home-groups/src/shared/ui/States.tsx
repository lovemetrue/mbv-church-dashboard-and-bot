import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { ru } from '../i18n/ru';
import { Button } from './Button';
import styles from './States.module.css';

export function EmptyState({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p>{children}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

/** «Загружаем…» с мерцающими полосами; role=status сообщает о загрузке скринридеру. */
export function LoadingState({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.loadingText}>{ru.states.loading}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.bar} aria-hidden="true" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className={styles.error} role="alert">
      <p>{forbidden ? ru.states.forbidden : ru.states.errorTitle}</p>
      {!forbidden && (
        <Button onClick={onRetry} variant="primary">
          {ru.states.retry}
        </Button>
      )}
    </div>
  );
}
