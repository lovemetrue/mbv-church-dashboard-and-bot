import styles from './Meter.module.css';

interface MeterProps {
  /** 0–100. */
  value: number;
  label: string;
  tone?: 'accent' | 'ok' | 'warn' | 'crit';
  /** Ширина фиксированная (для таблиц) или во всю строку. */
  width?: number;
}

/** Шкала. Роль meter читается скринридером как «значение из 100», подпись обязательна. */
export function Meter({ value, label, tone = 'accent', width }: MeterProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={styles.meter}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      style={width ? { width } : undefined}
    >
      <i className={`${styles.fill} ${styles[tone]}`} style={{ width: `${v}%` }} />
    </div>
  );
}
