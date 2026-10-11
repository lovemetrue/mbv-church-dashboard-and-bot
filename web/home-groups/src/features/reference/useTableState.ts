import { useCallback, useMemo } from 'react';
import {
  parseTableState,
  sameFilters,
  serializeTableState,
  TABLE_PARAMS,
  type TableState,
} from '../../shared/filters';
import { useAppNav } from '../../shared/nav';
import type { EntityConfig } from './config';

/**
 * Метка «отбор по умолчанию снят». Без неё пустой отбор в адресе нельзя отличить от «человек ещё
 * ничего не трогал»: после «Сбросить всё» умолчание вернулось бы само.
 */
const NO_DEFAULT = 'nodef';

/**
 * Состояние таблицы справочника хранится в адресе. Запись идёт с replace: подбор отбора —
 * это десятки мелких правок, и «назад» должно уводить со страницы, а не откатывать по одной.
 */
export function useTableState<T>(config: EntityConfig<T>) {
  const nav = useAppNav();
  const { params, update } = nav;

  const defaults = config.defaultFilters;
  const state = useMemo(() => {
    const parsed = parseTableState(params, config.fields, config.columns);
    // Умолчание действует, пока в адресе нет ни отбора, ни метки «снято». Смена вкладки или
    // сущности очищает адрес, поэтому при новом открытии справочника оно применяется заново.
    const useDefault = !!defaults?.length && !params.has('f') && !params.has(NO_DEFAULT);
    return useDefault ? { ...parsed, filters: defaults.map((f) => ({ ...f })) } : parsed;
  }, [params, config, defaults]);

  const setState = useCallback(
    (next: TableState) => {
      const serialized = serializeTableState(next, config.defaultColumns);
      const patch: Record<string, string[] | string | null> = {};
      for (const key of TABLE_PARAMS) {
        const values = serialized.getAll(key);
        patch[key] = values.length === 0 ? null : key === 'f' || key === 'col' ? values : (values[0] ?? null);
      }
      if (defaults?.length) {
        // Отбор, равный умолчанию, остаётся «неявным»: в адрес он не пишется, иначе любая правка
        // (например, ввод в поиск) превращала бы умолчание в явный отбор, а потом его потеряла.
        if (sameFilters(next.filters, defaults)) {
          patch['f'] = null;
          patch[NO_DEFAULT] = null;
        } else {
          patch[NO_DEFAULT] = next.filters.length === 0 ? '1' : null;
        }
      }
      update(patch, { replace: true });
    },
    [config, update, defaults],
  );

  const columns = state.columns ?? config.defaultColumns;
  return { state, setState, columns };
}
