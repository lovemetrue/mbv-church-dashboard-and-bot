import { useCallback, useMemo } from 'react';
import {
  parseTableState,
  serializeTableState,
  TABLE_PARAMS,
  type TableState,
} from '../../shared/filters';
import { useAppNav } from '../../shared/nav';
import type { EntityConfig } from './config';

/**
 * Состояние таблицы справочника хранится в адресе. Запись идёт с replace: подбор отбора —
 * это десятки мелких правок, и «назад» должно уводить со страницы, а не откатывать по одной.
 */
export function useTableState<T>(config: EntityConfig<T>) {
  const nav = useAppNav();
  const { params, update } = nav;

  const state = useMemo(
    () =>
      parseTableState(
        params,
        config.fields,
        config.columns,
      ),
    [params, config],
  );

  const setState = useCallback(
    (next: TableState) => {
      const serialized = serializeTableState(next, config.defaultColumns);
      const patch: Record<string, string[] | string | null> = {};
      for (const key of TABLE_PARAMS) {
        const values = serialized.getAll(key);
        patch[key] = values.length === 0 ? null : key === 'f' || key === 'col' ? values : (values[0] ?? null);
      }
      update(patch, { replace: true });
    },
    [config, update],
  );

  const columns = state.columns ?? config.defaultColumns;
  return { state, setState, columns };
}
