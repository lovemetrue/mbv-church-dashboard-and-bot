import type { ReactNode } from 'react';
import styles from './TableScroll.module.css';

/**
 * Контейнер для широкой таблицы: прокручивается он, а не страница. tabIndex=0 нужен, чтобы
 * с клавиатуры можно было прокрутить таблицу стрелками, когда внутри нет ничего фокусируемого.
 */
export function TableScroll({ label, bare = false, children }: { label: string; bare?: boolean; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={bare ? styles.bare : styles.scroll} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
