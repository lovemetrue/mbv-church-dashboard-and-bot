import type { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'ready' | 'callback' | 'human' | 'done' | 'plain' | 'ok' | 'warn' | 'crit';

/** Плашка-статус. Смысл всегда дублируется текстом, цвет — только подсветка. */
export function Pill({ tone = 'plain', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}
