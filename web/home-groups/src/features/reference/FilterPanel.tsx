import { useId, useState } from 'react';
import {
  distinctValues,
  filterLabel,
  needsValue,
  IN_SEP,
  opsFor,
  sameFilters,
  type Cell,
  type Filter,
  type Op,
  type Preset,
  type Row,
  type SavedView,
  type TableState,
} from '../../shared/filters';
import { ru } from '../../shared/i18n/ru';
import { Button, Chip } from '../../shared/ui';
import type { EntityConfig } from './config';
import styles from './Reference.module.css';

export const OP_SYMBOL: Record<Op, string> = ru.reference.ops;

/** Подпись чипа отбора. «≠» читается как «не», потому что «Статус ≠ Закрыта» человеку труднее, чем «Статус: не «Закрыта»». */
export const filterChipLabel = (fl: Filter): string =>
  fl.op === 'ne' ? ru.reference.notEqualChip(fl.field, fl.value) : filterLabel(fl, OP_SYMBOL);

interface FilterPanelProps<T> {
  /** Поля, их порядок и быстрые отборы. Нужна не вся сущность справочника: тем же окном отбирают и заявки. */
  config: Pick<EntityConfig<T>, 'fields' | 'columns' | 'presets'>;
  /** Все строки сущности (до отборов): из них берутся значения для списка. */
  rows: readonly Row[];
  state: TableState;
  views: readonly SavedView[];
  onChange: (next: TableState) => void;
  /** Нет — сохранять вид здесь нельзя: у «Заявок» для этого общая кнопка «Мои виды». */
  onSaveView?: (name: string) => void;
  onDeleteView: (name: string) => void;
}

/** Содержимое окна «Фильтры»: быстрые отборы, сохранённые виды, конструктор условий. */
export function FilterPanel<T>({ config, rows, state, views, onChange, onSaveView, onDeleteView }: FilterPanelProps<T>) {
  const uid = useId();
  const [field, setField] = useState('');
  const [op, setOp] = useState<Op>('in');
  const [value, setValue] = useState('');
  // Отмеченные значения для «=» у текста: можно несколько (условие «in»).
  const [picked, setPicked] = useState<string[]>([]);
  const [viewName, setViewName] = useState('');

  const def = config.fields.find((d) => d.key === field);
  const ops = opsFor(def);
  const isNumeric = def?.kind === 'number';
  const isDate = def?.kind === 'date';
  const options = def && !isNumeric && !isDate ? distinctValues(rows, def) : [];
  const canAdd = !!def && (!needsValue(op) || (op === 'in' ? picked.length > 0 : value.trim() !== ''));

  const applyPreset = (p: Preset) => onChange({ ...state, filters: p.filters.map((x) => ({ ...x })) });
  const applyView = (v: SavedView) =>
    onChange({
      ...state,
      filters: v.filters.map((x) => ({ ...x })),
      columns: v.columns && v.columns.length ? v.columns : null,
      group: v.group ?? null,
      sort: v.sort ?? null,
    });

  const onFieldChange = (key: string) => {
    setField(key);
    const nextOps = opsFor(config.fields.find((d) => d.key === key));
    // Условие, которого у нового поля нет (например, «≥» у текста), заменяем на первое доступное.
    if (!nextOps.includes(op)) setOp(nextOps[0] ?? 'eq');
    setValue('');
    setPicked([]);
  };

  const add = () => {
    if (!canAdd) return;
    const v = op === 'in' ? picked.join(IN_SEP) : needsValue(op) ? value.trim() : '';
    onChange({ ...state, filters: [...state.filters, { field, op, value: v }] });
    setValue('');
    setPicked([]);
  };

  return (
    <div className={styles.panelBody}>
      <h3 className={styles.h3}>{ru.reference.quickFilters}</h3>
      <div className={styles.chips}>
        {config.presets.map((p) => (
          <Chip key={p.name} pressed={sameFilters(state.filters, p.filters)} onClick={() => applyPreset(p)}>
            {p.name}
          </Chip>
        ))}
      </div>

      {views.length > 0 && (
        <>
          <h3 className={styles.h3}>{ru.reference.savedViews}</h3>
          <div className={styles.chips}>
            {views.map((v) => (
              <span key={v.name} className={styles.viewItem}>
                <Chip pressed={sameFilters(state.filters, v.filters)} onClick={() => applyView(v)}>
                  {v.name}
                </Chip>
                <button
                  type="button"
                  className={styles.viewDelete}
                  aria-label={`${ru.reference.deleteView}: ${v.name}`}
                  onClick={() => onDeleteView(v.name)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      <h3 className={styles.h3}>{ru.reference.customFilter}</h3>
      <div className={styles.builder}>
        <label className="visually-hidden" htmlFor={`${uid}-field`}>
          {ru.reference.field}
        </label>
        <select id={`${uid}-field`} className={styles.select} value={field} onChange={(e) => onFieldChange(e.target.value)}>
          <option value="">{ru.reference.fieldPlaceholder}</option>
          {config.columns.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor={`${uid}-op`}>
          {ru.reference.condition}
        </label>
        <select id={`${uid}-op`} className={styles.select} value={op} onChange={(e) => setOp(e.target.value as Op)}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_SYMBOL[o]}
            </option>
          ))}
        </select>
        {needsValue(op) && (
          <>
            <label className="visually-hidden" htmlFor={`${uid}-val`}>
              {ru.reference.value}
            </label>
            {isNumeric ? (
              <input
                id={`${uid}-val`}
                className={styles.input}
                type="text"
                inputMode="numeric"
                placeholder={ru.reference.numberPlaceholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : op === 'in' ? (
              <fieldset id={`${uid}-val`} className={styles.checkList}>
                <legend className="visually-hidden">{ru.reference.value}</legend>
                {options.map((v: Cell) => {
                  const text = String(v);
                  return (
                    <label key={text} className={styles.checkItem}>
                      <input
                        type="checkbox"
                        checked={picked.includes(text)}
                        onChange={() => setPicked((cur) => (cur.includes(text) ? cur.filter((x) => x !== text) : [...cur, text]))}
                      />
                      <span>{text}</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : isDate ? (
              <input id={`${uid}-val`} className={styles.input} type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <select id={`${uid}-val`} className={styles.select} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">{ru.reference.valuePlaceholder}</option>
                {options.map((v: Cell) => (
                  <option key={String(v)} value={String(v)}>
                    {String(v)}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <Button variant="primary" size="sm" disabled={!canAdd} onClick={add}>
          {ru.reference.add}
        </Button>
      </div>

      {state.filters.length > 0 && (
        <>
          <h3 className={styles.h3}>{ru.reference.currentFilter}</h3>
          <ul className={styles.currentList}>
            {state.filters.map((fl, i) => (
              <li key={`${fl.field}-${i}`}>{filterLabel(fl, OP_SYMBOL)}</li>
            ))}
          </ul>
          <div className={styles.builder}>
            {onSaveView && (
              <>
                <label className="visually-hidden" htmlFor={`${uid}-name`}>
                  {ru.reference.viewName}
                </label>
                <input
                  id={`${uid}-name`}
                  className={styles.input}
                  type="text"
                  placeholder={ru.reference.viewName}
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!viewName.trim()}
                  onClick={() => {
                    onSaveView(viewName.trim());
                    setViewName('');
                  }}
                >
                  {ru.reference.saveView}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...state, filters: [] })}>
              {ru.reference.resetAll}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
