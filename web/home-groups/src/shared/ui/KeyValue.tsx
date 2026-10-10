import type { ReactNode } from 'react';
import styles from './KeyValue.module.css';

export interface KvRow {
  label: string;
  value: ReactNode;
}

/** Список «название — значение» карточек. Пустые значения отдаёт вызывающий код как «не указано». */
export function KeyValue({ rows }: { rows: readonly KvRow[] }) {
  return (
    <dl className={styles.kv}>
      {rows.map((r) => (
        <div key={r.label} className={styles.row}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
