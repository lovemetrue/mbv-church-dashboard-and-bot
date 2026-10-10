import type { Reason } from '@contracts';
import styles from './Reasons.module.css';

/** Плашки причин плана: «тот же район», «время не совпало»… Окраска по тону причины. */
export function Reasons({ items }: { items: readonly Reason[] }) {
  if (!items.length) return null;
  return (
    <ul className={styles.list}>
      {items.map((r, i) => (
        <li key={`${r.text}-${i}`} className={`${styles.reason} ${styles[r.tone]}`}>
          {r.text}
        </li>
      ))}
    </ul>
  );
}
