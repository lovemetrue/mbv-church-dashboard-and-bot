import { ru } from '../i18n/ru';
import styles from './ConfidenceDots.module.css';

/**
 * Квадратики данных: какие из четырёх параметров подбора известны (район, возраст, день и
 * время, улица). Рядом с квадратиком нет текста, поэтому весь смысл — в aria-label и title.
 */
export function ConfidenceDots({ fill }: { fill: readonly boolean[] }) {
  const names = ru.common.dataDots;
  const text = names.map((n, i) => `${n}: ${fill[i] ? ru.common.dotYes : ru.common.dotNo}`).join(' · ');
  return (
    <span className={styles.dots} role="img" aria-label={text} title={text}>
      {names.map((n, i) => (
        <i key={n} className={fill[i] ? styles.on : undefined} />
      ))}
    </span>
  );
}
