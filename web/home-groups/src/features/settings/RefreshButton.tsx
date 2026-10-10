import type { UseQueryResult } from '@tanstack/react-query';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';

/** «Обновить»: перечитать данные раздела сейчас. Пока идёт чтение, кнопка занята. */
export function RefreshButton({ query }: { query: UseQueryResult<unknown> }) {
  return (
    <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
      {query.isFetching ? ru.settings.refreshing : ru.settings.refresh}
    </Button>
  );
}
