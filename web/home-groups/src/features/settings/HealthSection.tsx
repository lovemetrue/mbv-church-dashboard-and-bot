import { useId } from 'react';
import type { HealthMetric, HealthStatus } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Meter, Pill } from '../../shared/ui';
import { formatWhen } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useSettingsHealth } from './queries';
import styles from './Settings.module.css';

const t = ru.settings;

/** Статус и словом, и цветом: по цвету одному его не отличит человек с нарушением цветоощущения. */
function StatusPill({ status }: { status: HealthStatus }) {
  return <Pill tone={status}>{t.status[status]}</Pill>;
}

function MetricCard({ m }: { m: HealthMetric }) {
  return (
    <li className={`${styles.metric} ${styles[`tone_${m.status}`]}`}>
      <div className={styles.metricTop}>
        <span className={styles.metricLabel}>{m.label}</span>
        <StatusPill status={m.status} />
      </div>
      <div className={`${styles.metricValue} num`}>{m.value}</div>
      {m.percent !== null && <Meter value={m.percent} label={m.label} tone={m.status} />}
      <p className={styles.metricHint}>{m.hint}</p>
    </li>
  );
}

export function HealthSection() {
  const query = useSettingsHealth();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={t.sections.health}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>
        {(data) => (
          <>
            <section className={`${styles.overall} ${styles[`tone_${data.overall}`]}`} aria-label={t.health.overallLabel}>
              <span className={styles.overallLabel}>{t.health.overallLabel}:</span>
              <span className={styles.overallWord}>{t.status[data.overall]}</span>
            </section>
            <p className={styles.muted}>
              {t.updatedAt(formatWhen(data.generatedAt))}. {t.health.auto}
            </p>
            <ul className={styles.metrics} aria-label={t.health.metricsLabel}>
              {data.metrics.map((m) => (
                <MetricCard key={m.key} m={m} />
              ))}
            </ul>
          </>
        )}
      </QueryBoundary>
    </section>
  );
}
