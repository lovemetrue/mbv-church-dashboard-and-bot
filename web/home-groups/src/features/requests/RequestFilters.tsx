import { useMemo } from 'react';
import type { RequestItem } from '@contracts';
import type { Filter } from '../../shared/filters';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Popover } from '../../shared/ui';
import { FilterPanel, filterChipLabel } from '../reference/FilterPanel';
import refStyles from '../reference/Reference.module.css';
import { parseRequestFilters, REQUEST_FIELDS, REQUEST_FILTER_COLUMNS, REQUEST_PRESETS, requestRow, serializeRequestFilters } from './filters';

const t = ru.requests.filters;
const CONFIG = { fields: REQUEST_FIELDS, columns: REQUEST_FILTER_COLUMNS, presets: REQUEST_PRESETS };

/** Отборы заявок из адреса. Запись с replace: подбор условий — десяток мелких правок, «назад» должно уводить со страницы. */
export function useRequestFilters() {
  const nav = useAppNav();
  const raw = nav.params.getAll('f');
  const key = raw.join('\u0000');
  // Разбираем заново, только когда условия в адресе поменялись: массив из params новый на каждую отрисовку.
  const filters = useMemo(() => parseRequestFilters(key ? key.split('\u0000') : []), [key]);
  // Открытая заявка могла не пройти новый отбор: карточку закрываем, как при смене чипа.
  const set = (next: Filter[]) => nav.update({ f: next.length ? serializeRequestFilters(next) : null, req: null }, { replace: true });
  return { filters, key, set };
}

/** Кнопка «Фильтры» с окном конструктора — то же окно, что в справочниках; сохранять вид — общей кнопкой «Мои виды». */
export function RequestFiltersButton({ items, filters, onChange }: { items: readonly RequestItem[]; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  // Значения для списков — из всех заявок, а не из уже отобранных: иначе второе условие нельзя было бы выбрать.
  const rows = useMemo(() => items.map(requestRow), [items]);
  return (
    <Popover label={t.button} badge={filters.length || undefined} title={t.button}>
      <FilterPanel
        config={CONFIG}
        rows={rows}
        state={{ filters, text: '', columns: null, group: null, sort: null }}
        views={[]}
        onChange={(next) => onChange(next.filters)}
        onDeleteView={() => undefined}
      />
    </Popover>
  );
}

/** Текущие условия чипами под панелью: видно, почему список короче, и любое снимается одним нажатием. */
export function RequestFilterChips({ filters, onChange }: { filters: Filter[]; onChange: (f: Filter[]) => void }) {
  if (filters.length === 0) return null;
  return (
    <ul className={refStyles.fchips} aria-label={ru.reference.currentFilter}>
      {filters.map((fl, i) => (
        <li key={`${fl.field}-${fl.op}-${fl.value}-${i}`} className={refStyles.fchip}>
          {filterChipLabel(fl)}
          <button
            type="button"
            aria-label={`${ru.reference.removeFilter}: ${filterChipLabel(fl)}`}
            onClick={() => onChange(filters.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
