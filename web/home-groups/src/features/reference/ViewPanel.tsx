import { useId } from 'react';
import type { TableState } from '../../shared/filters';
import { ru } from '../../shared/i18n/ru';
import type { EntityConfig } from './config';
import styles from './Reference.module.css';

interface ViewPanelProps<T> {
  config: EntityConfig<T>;
  state: TableState;
  columns: readonly string[];
  onChange: (next: TableState) => void;
}

/** Содержимое окна «Вид таблицы»: группировка и набор столбцов. */
export function ViewPanel<T>({ config, state, columns, onChange }: ViewPanelProps<T>) {
  const uid = useId();
  const groupable = config.fields.filter((d) => d.groupable);

  const toggle = (col: string, on: boolean) => {
    // Столбец порядка не меняет: показываем в порядке справочника, а не в порядке включения.
    const set = new Set(columns);
    if (on) set.add(col);
    else set.delete(col);
    if (set.size === 0) return; // таблица без столбцов не нужна
    onChange({ ...state, columns: config.columns.filter((c) => set.has(c)) });
  };

  return (
    <div className={styles.panelBody}>
      {groupable.length > 0 && (
        <>
          <h3 className={styles.h3}>
            <label htmlFor={`${uid}-gb`}>{ru.reference.group}</label>
          </h3>
          <select
            id={`${uid}-gb`}
            className={styles.select}
            value={state.group ?? ''}
            onChange={(e) => onChange({ ...state, group: e.target.value || null })}
          >
            <option value="">{ru.reference.noGrouping}</option>
            {groupable.map((d) => (
              <option key={d.key} value={d.key}>
                {d.key}
              </option>
            ))}
          </select>
        </>
      )}
      <fieldset className={styles.fieldset}>
        <legend className={styles.h3}>{ru.reference.columns}</legend>
        <div className={styles.colmenu}>
          {config.columns.map((c) => (
            <label key={c} className={styles.colLabel}>
              <input type="checkbox" checked={columns.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
