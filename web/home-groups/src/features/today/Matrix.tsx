import type { MatrixCell, TodayView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { TableScroll } from '../../shared/ui';
import styles from './Today.module.css';

const LEVEL_CLASS = {
  crit: styles.cellCrit,
  warn: styles.cellWarn,
  ok: styles.cellOk,
  zero: styles.cellZero,
} as const;

/** «+3», «−2», «0»: знак всегда виден, минус настоящий, а не дефис. */
function netText(net: number): string {
  if (net > 0) return `+${net}`;
  if (net < 0) return `−${Math.abs(net)}`;
  return '0';
}

/** Матрица «район × возраст»: места минус спрос. Цвет клетки по level, а смысл — в тексте. */
export function Matrix({ data }: { data: TodayView }) {
  return (
    <>
      <TableScroll bare label={ru.today.matrixLabel}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th scope="col" className={styles.mxCorner}>
                {ru.today.matrixDistrict}
              </th>
              {data.ageColumns.map((age) => (
                <th key={age} scope="col" className={styles.mxHead}>
                  {age}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((row) => (
              <tr key={row.district}>
                <th scope="row" className={styles.mxRow}>
                  {row.district}
                </th>
                {data.ageColumns.map((age) => {
                  const cell: MatrixCell | undefined = row.cells.find((c) => c.age === age);
                  if (!cell) return <td key={age} />;
                  const text = ru.today.matrixCell(cell.demand, cell.supply);
                  return (
                    <td key={age} className={styles.mxTd}>
                      <div
                        className={`${styles.cell} ${LEVEL_CLASS[cell.level]}`}
                        title={`${row.district}, ${age}: ${text}`}
                      >
                        <b className="num">{netText(cell.net)}</b>
                        <span>{text}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
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
        <li>{ru.today.legendNote}</li>
      </ul>
    </>
  );
}
