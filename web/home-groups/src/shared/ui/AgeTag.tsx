import styles from './AgeTag.module.css';

/** Возраст «табличкой» рядом с именем. */
export function AgeTag({ children }: { children: string }) {
  return <span className={styles.age}>{children}</span>;
}
