import type { ReactNode } from 'react';
import { ru } from '../../shared/i18n/ru';
import styles from './Requests.module.css';

const t = ru.requests.summary;

export interface CardSummaryData {
  /** Улица и дом человека (не «место»: район и метро, как он написал). */
  address: string | null;
  /** Район, определённый по адресу; у обращений без разбора района его нет. */
  district?: string | null;
  responsible: string | null;
  /** Удобное время одной строкой. */
  schedule: string | null;
  /** «Дополнительно» из таблицы церкви. */
  extra: string | null;
}

/** Удобное время для шапки: слова человека, а если их нет — то, как система поняла дни и время. */
export function scheduleText(
  text: string | null,
  days: string[],
  slot: string | null,
): string | null {
  if (text?.trim()) return text.trim();
  return [days.join(", "), slot].filter(Boolean).join(", ") || null;
}

/**
 * Сводка под статусом в шапке карточки: адрес и район по нему, ответственный, удобное время, «Дополнительно».
 * Только для чтения: править — в карточке («Параметры» с карандашами). Длинное переносится, а не раздувает шапку.
 */
export function CardSummary({ address, district, responsible, schedule, extra }: CardSummaryData) {
  const row = (label: string, value: ReactNode, muted = false) => (
    <div className={styles.summaryRow}>
      <dt>{label}</dt>
      <dd className={muted ? styles.summaryMuted : undefined}>{value}</dd>
    </div>
  );
  return (
    <div role="group" aria-label={t.label}>
      <dl className={styles.summary}>
        {row(t.address, [address, district].filter(Boolean).join(' · ') || t.noAddress, !address)}
        {row(ru.requests.responsible, responsible || t.noResponsible, !responsible)}
        {schedule && row(t.schedule, schedule)}
        {extra && row(t.extra, extra)}
      </dl>
    </div>
  );
}
