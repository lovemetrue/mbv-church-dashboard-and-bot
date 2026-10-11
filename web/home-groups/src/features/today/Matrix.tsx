import type { CellLevel, MatrixCell, TodayView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { EmptyState } from '../../shared/ui';
import {
  MATRIX_MODES,
  MATRIX_SORTS,
  buildView,
  cellLabel,
  cellSummary,
  colTotals,
  grandTotals,
  hiddenNote,
  isUnknownAge,
  isUnknownDistrict,
  rowTotals,
  type MatrixMode,
  type MatrixPrefs,
  type MatrixSort,
  type Totals,
} from './model';
import { Tip } from './Tip';
import styles from './Today.module.css';

const LEVEL_CLASS: Record<CellLevel, string | undefined> = {
  crit: styles.cellCrit,
  warn: styles.cellWarn,
  ok: styles.cellOk,
  zero: styles.cellZero,
};

const MODE_LABEL: Record<MatrixMode, string> = {
  balance: ru.today.modeBalance,
  waiting: ru.today.modeWaiting,
  places: ru.today.modePlaces,
};
const SORT_LABEL: Record<MatrixSort, string> = {
  shortage: ru.today.sortShortage,
  alpha: ru.today.sortAlpha,
};

export interface CellRef {
  district: string;
  age: string;
}

function Segment<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.segment} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className={styles.segBtn} aria-pressed={value === o} onClick={() => onChange(o)}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function TotalsText({ t, className }: { t: Totals; className?: string }) {
  return (
    <span className={`${styles.totals} ${className ?? ''}`}>
      <span className="num">{ru.today.totalWaiting(t.demand)}</span>
      <span className="num">{ru.today.totalPlaces(t.supply)}</span>
    </span>
  );
}

function CellButton({
  district,
  cell,
  mode,
  selected,
  onOpen,
}: {
  district: string;
  cell: MatrixCell;
  mode: MatrixMode;
  selected: boolean;
  onOpen: (ref: CellRef) => void;
}) {
  const special = isUnknownDistrict(district) || isUnknownAge(cell.age);
  const label = cellLabel(cell, mode, special);
  return (
    <Tip text={cellSummary(district, cell.age, cell)}>
      {(aria) => (
        <button
          type="button"
          {...aria}
          className={`${styles.cell} ${LEVEL_CLASS[cell.level] ?? ''} ${special ? styles.cellSpecial : ''}`}
          // Имя начинается с «Район, возраст», а дальше — то, что написано в клетке: так подпись не расходится с именем.
          aria-label={`${district}, ${cell.age}: ${label.big} ${label.word}`}
          aria-haspopup="dialog"
          aria-expanded={selected}
          onClick={() => onOpen({ district, age: cell.age })}
        >
          <b className="num">{label.big}</b>
          <span className={styles.cellWord}>{label.word}</span>
          {label.small && <small className={`${styles.cellSmall} num`}>{label.small}</small>}
        </button>
      )}
    </Tip>
  );
}

/**
 * Пульт «район × возраст». Крупно — то, что выбрано в режиме показа, словами (не «+34 / спрос 1 · мест 35»);
 * цвет по уровню клетки лишь подсвечивает, смысл всегда есть и в тексте. На телефоне таблица
 * превращается в карточки районов (CSS), страница вбок не ползёт.
 */
export function Matrix({
  data,
  prefs,
  onPrefs,
  selected,
  onOpen,
}: {
  data: TodayView;
  prefs: MatrixPrefs;
  onPrefs: (patch: Partial<MatrixPrefs>) => void;
  selected: CellRef | null;
  onOpen: (ref: CellRef) => void;
}) {
  const view = buildView(data, prefs);
  const hidden = hiddenNote(view.hiddenRows, view.hiddenAges);
  const grand = grandTotals(view.rows);
  const nothing = view.rows.length === 0 || view.ages.length === 0;

  return (
    <>
      <div className={styles.mxControls}>
        <Segment label={ru.today.modeLabel} options={MATRIX_MODES} labels={MODE_LABEL} value={prefs.mode} onChange={(mode) => onPrefs({ mode })} />
        <Segment label={ru.today.sortLabel} options={MATRIX_SORTS} labels={SORT_LABEL} value={prefs.sort} onChange={(sort) => onPrefs({ sort })} />
        <label className={styles.hideEmpty}>
          <input type="checkbox" checked={prefs.hideEmpty} onChange={(e) => onPrefs({ hideEmpty: e.target.checked })} />
          {ru.today.hideEmpty}
        </label>
      </div>
      {prefs.hideEmpty && hidden && <p className={styles.hiddenNote}>{hidden}</p>}

      {nothing ? (
        <EmptyState>{ru.today.matrixEmpty}</EmptyState>
      ) : (
        <div className={styles.mxWrap} role="region" aria-label={ru.today.matrixLabel}>
          <table className={styles.matrix} role="table" data-hide-empty={prefs.hideEmpty}>
            <thead role="rowgroup" className={styles.mxThead}>
              <tr role="row">
                <th scope="col" role="columnheader" className={styles.mxCorner}>
                  {ru.today.matrixDistrict}
                </th>
                {view.ages.map((age) => (
                  <th
                    key={age}
                    scope="col"
                    role="columnheader"
                    className={`${styles.mxHead} ${isUnknownAge(age) ? styles.mxSpecialHead : ''}`}
                  >
                    {age}
                    {isUnknownAge(age) && <small>{ru.today.matrixUnknownAgeHint}</small>}
                  </th>
                ))}
                <th scope="col" role="columnheader" className={`${styles.mxHead} ${styles.mxTotalHead}`}>
                  {ru.today.matrixTotal}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {view.rows.map((row) => {
                const special = isUnknownDistrict(row.district);
                return (
                  <tr key={row.district} role="row" className={special ? styles.mxSpecialRow : undefined}>
                    <th scope="row" role="rowheader" className={styles.mxRow}>
                      {row.district}
                      {special && <small>{ru.today.matrixUnknownDistrictHint}</small>}
                    </th>
                    {view.ages.map((age) => {
                      const cell = row.cells.find((c) => c.age === age);
                      return (
                        <td key={age} role="cell" className={`${styles.mxTd} ${cell && cell.demand === 0 && cell.supply === 0 ? styles.mxTdZero : ''}`} data-age={age}>
                          {cell && (
                            <CellButton
                              district={row.district}
                              cell={cell}
                              mode={prefs.mode}
                              selected={selected?.district === row.district && selected.age === age}
                              onOpen={onOpen}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td role="cell" className={styles.mxTotalTd} data-age={ru.today.matrixTotal}>
                      <TotalsText t={rowTotals(row)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot role="rowgroup">
              <tr role="row" className={styles.mxFoot}>
                <th scope="row" role="rowheader" className={styles.mxRow}>
                  {ru.today.matrixTotal}
                </th>
                {view.ages.map((age) => (
                  <td key={age} role="cell" className={styles.mxTotalTd} data-age={age}>
                    <TotalsText t={colTotals(view.rows, age)} />
                  </td>
                ))}
                <td role="cell" className={styles.mxTotalTd} data-age={ru.today.matrixTotal}>
                  <TotalsText t={grand} className={styles.grand} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <ul className={styles.legend}>
        <li>
          <i className={styles.dotCrit} aria-hidden="true" />
          {ru.today.legendCrit}
        </li>
        <li>
          <i className={styles.dotWarn} aria-hidden="true" />
          {ru.today.legendWarn}
        </li>
        <li>
          <i className={styles.dotOk} aria-hidden="true" />
          {ru.today.legendOk}
        </li>
        <li>
          <i className={styles.dotZero} aria-hidden="true" />
          {ru.today.legendZero}
        </li>
        <li className={styles.legendNote}>{ru.today.legendNote}</li>
      </ul>
    </>
  );
}
