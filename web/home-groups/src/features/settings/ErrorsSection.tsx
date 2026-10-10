import { useId, useMemo, useState } from 'react';
import { ru } from '../../shared/i18n/ru';
import { EmptyState, Pill } from '../../shared/ui';
import { distinct, filterErrors, formatWhen } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useSettingsErrors } from './queries';
import styles from './Settings.module.css';
import type { ErrorEntry } from '@contracts';

const t = ru.settings;

function ErrorsList({ items }: { items: ErrorEntry[] }) {
  const [service, setService] = useState('');
  const [query, setQuery] = useState('');
  const serviceId = useId();
  const searchId = useId();
  const services = useMemo(() => distinct(items.map((i) => i.service)), [items]);
  const shown = useMemo(() => filterErrors(items, { service, query }), [items, service, query]);

  if (!items.length) return <EmptyState hint={t.errors.emptyHint}>{t.errors.empty}</EmptyState>;
  return (
    <>
      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor={serviceId}>{t.errors.serviceLabel}</label>
          <select id={serviceId} className={styles.control} value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">{t.errors.allServices}</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label htmlFor={searchId}>{t.errors.searchLabel}</label>
          <input
            id={searchId}
            type="search"
            className={styles.control}
            placeholder={t.errors.searchPlaceholder}
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <p className={styles.muted} role="status">
        {t.errors.shown(shown.length, items.length)}
      </p>
      {shown.length ? (
        <ul className={styles.errorList} aria-label={t.errors.listLabel}>
          {shown.map((e) => (
            <li key={e.id} className={styles.errorItem}>
              <div className={styles.errorTop}>
                <time dateTime={e.at} className={styles.when}>
                  {formatWhen(e.at)}
                </time>
                <Pill>{e.service}</Pill>
              </div>
              <p className={styles.errorMessage}>{e.message}</p>
              {e.context && <p className={styles.context}>{e.context}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>{t.errors.nothingFound}</EmptyState>
      )}
    </>
  );
}

export function ErrorsSection() {
  const query = useSettingsErrors();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={t.sections.errors}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <ErrorsList items={data.items} />}</QueryBoundary>
    </section>
  );
}
