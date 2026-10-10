import type { Row, RowGroup, SortState } from '../../shared/filters';
import { healthTone } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { EmptyState, TableScroll } from '../../shared/ui';
import { displayCell } from './config';
import styles from './Reference.module.css';

interface ReferenceTableProps {
  label: string;
  columns: readonly string[];
  groups: readonly RowGroup<Row>[];
  grouped: boolean;
  total: number;
  sort: SortState | null;
  selectedKey: string | null;
  titleOf: (key: string) => string;
  onSort: (column: string) => void;
  onSelect: (key: string) => void;
}

function Cell({ column, value }: { column: string; value: Row[string] }) {
  const text = displayCell(column, value ?? null);
  if (text === '') return <span className={styles.empty}>{ru.reference.emptyDash}</span>;
  if (column === 'Здоровье') {
    return <b className={`${styles.health} ${styles[`health_${healthTone(Number(value))}`]} num`}>{text}</b>;
  }
  if (column === 'Статус') {
    return (
      <>
        <span className={text === 'Функционирует' ? styles.dotOk : styles.dotWarn} aria-hidden="true">
          ●
        </span>{' '}
        {text}
      </>
    );
  }
  return <span className={styles.cellText} title={text.length > 24 ? text : undefined}>{text}</span>;
}

const NUMERIC_ALIGN = new Set(['№', 'Мест свободно', 'Вместимость', 'Проверена, дн.', 'Здоровье', 'Групп', 'Участников', 'Подтверждено за 30 дн.', 'Заявка']);

export function ReferenceTable(props: ReferenceTableProps) {
  const { label, columns, groups, grouped, total, sort, selectedKey, titleOf, onSort, onSelect } = props;
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  if (total > 0 && shown === 0) {
    return (
      <div className={styles.emptyBox}>
        <EmptyState>{ru.reference.empty}</EmptyState>
      </div>
    );
  }
  return (
    <TableScroll label={label}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.field === c;
              return (
                <th
                  key={c}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={NUMERIC_ALIGN.has(c) ? styles.thNum : undefined}
                >
                  <button type="button" className={styles.sortBtn} onClick={() => onSort(c)} aria-label={ru.reference.sortBy(c)}>
                    {c}
                    <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.key || '__empty'} g={g} grouped={grouped} {...{ columns, selectedKey, titleOf, onSelect }} />
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function GroupRows({
  g,
  grouped,
  columns,
  selectedKey,
  titleOf,
  onSelect,
}: {
  g: RowGroup<Row>;
  grouped: boolean;
  columns: readonly string[];
  selectedKey: string | null;
  titleOf: (key: string) => string;
  onSelect: (key: string) => void;
}) {
  return (
    <>
      {grouped && (
        <tr className={styles.groupHead}>
          <th scope="rowgroup" colSpan={columns.length}>
            {g.key === '' ? ru.reference.notSpecified : g.key} · {g.rows.length}
          </th>
        </tr>
      )}
      {g.rows.map((row) => {
        const key = String(row['_key']);
        return (
          <tr
            key={key}
            className={`${styles.dataRow} ${selectedKey === key ? styles.selectedRow : ''}`}
            onClick={() => onSelect(key)}
          >
            {columns.map((c, i) => (
              <td key={c} className={NUMERIC_ALIGN.has(c) ? styles.tdNum : undefined}>
                {i === 0 ? (
                  <button
                    type="button"
                    className={styles.openBtn}
                    aria-label={`Открыть карточку: ${titleOf(key)}`}
                    aria-current={selectedKey === key ? 'true' : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(key);
                    }}
                  >
                    <Cell column={c} value={row[c] ?? null} />
                  </button>
                ) : (
                  <Cell column={c} value={row[c] ?? null} />
                )}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}
