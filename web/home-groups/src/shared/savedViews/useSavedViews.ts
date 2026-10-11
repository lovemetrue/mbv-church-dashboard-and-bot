import { useCallback, useState } from 'react';
import { addView, removeView, viewsOf, type AddError, type StoredView, type ViewScope } from './model';
import { readViews, writeViews } from './storage';

/**
 * Виды одного экрана. Состояние держим в React и пишем в браузер при каждом изменении:
 * если запись не удалась, список всё равно работает (`persisted: false`), а не пропадает.
 */
export function useSavedViews(scope: ViewScope) {
  const [all, setAll] = useState<StoredView[]>(readViews);
  const [persisted, setPersisted] = useState(true);

  const commit = useCallback((next: StoredView[]) => {
    setAll(next);
    setPersisted(writeViews(next));
  }, []);

  const save = useCallback(
    (name: string, query: string): { error: AddError | null; name: string } => {
      const r = addView(all, scope, name, query);
      if (r.error) return { error: r.error, name };
      commit(r.views);
      return { error: null, name: name.trim().replace(/\s+/g, ' ') };
    },
    [all, scope, commit],
  );

  const remove = useCallback((name: string) => commit(removeView(all, scope, name)), [all, scope, commit]);

  return { views: viewsOf(all, scope), persisted, save, remove };
}
