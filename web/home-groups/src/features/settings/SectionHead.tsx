import type { ReactNode } from 'react';
import styles from './Settings.module.css';

/** Заголовок раздела и действия справа (например, «Обновить»). */
export function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className={styles.head}>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {children && <div className={styles.headActions}>{children}</div>}
    </div>
  );
}
