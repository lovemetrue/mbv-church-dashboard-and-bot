import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ru } from '../../shared/i18n/ru';
import { ErrorState, LoadingState } from '../../shared/ui';
import styles from './Settings.module.css';

/**
 * Загрузка, ошибка и данные одного запроса. Если данные уже есть, а очередное фоновое чтение
 * не удалось, прежние данные остаются на экране с короткой пометкой: пропадать из-за сбоя сети
 * журналу незачем.
 */
export function QueryBoundary<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError && (
          <p className={styles.noticeError} role="alert">
            {ru.settings.staleError}
          </p>
        )}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <LoadingState />;
}
