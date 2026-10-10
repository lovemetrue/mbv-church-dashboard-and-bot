import { Fragment, useId, useMemo, useState } from 'react';
import type { AuditEntry } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, EmptyState } from '../../shared/ui';
import {
  describeValue,
  distinct,
  emptyAuditFilter,
  entityLabel,
  filterAudit,
  formatWhen,
  hasChange,
  isAuditFilterEmpty,
  type AuditFilter,
  type DescribedValue,
} from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useSettingsAudit } from './queries';
import styles from './Settings.module.css';

const t = ru.settings;

/** Одна сторона «было → стало»: пары «поле: значение» или простой текст. */
function Side({ title, value }: { title: string; value: DescribedValue }) {
  return (
    <section className={styles.side} aria-label={title}>
      <h3 className={styles.sideTitle}>{title}</h3>
      {value.kind === 'none' && <p className={styles.muted}>{t.audit.noData}</p>}
      {value.kind === 'text' && <p className={styles.sideText}>{value.text}</p>}
      {value.kind === 'pairs' && (
        <ul className={styles.pairs}>
          {value.pairs.map((p) => (
            <li key={p.key}>
              <span className={styles.pairKey}>{p.key}:</span> {p.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditRow({ e }: { e: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const target = entityLabel(e);
  return (
    <Fragment>
      <tr className={styles.auditRow} role="row">
        <td role="cell" data-label={t.audit.colWhen}>
          <time dateTime={e.at} className={styles.when}>
            {formatWhen(e.at)}
          </time>
        </td>
        <td role="cell" data-label={t.audit.colWho}>
          {e.actor}
        </td>
        <td role="cell" data-label={t.audit.colWhat}>
          {e.actionLabel}
        </td>
        <td role="cell" data-label={t.audit.colTarget}>
          {target}
        </td>
        <td role="cell" data-label={t.audit.colChange}>
          {hasChange(e) ? (
            <Button
              size="sm"
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              aria-label={t.audit.changedAria(e.actionLabel, target)}
              onClick={() => setOpen((v) => !v)}
            >
              {t.audit.changed} {open ? '▴' : '▾'}
            </Button>
          ) : (
            <span className={styles.muted}>{t.noValue}</span>
          )}
        </td>
        <td role="cell" data-label={t.audit.colNote}>
          {e.note ?? <span className={styles.muted}>{t.noValue}</span>}
        </td>
      </tr>
      {open && (
        <tr className={styles.detailRow} role="row">
          <td role="cell" colSpan={6} id={detailId}>
            <div className={styles.sides}>
              <Side title={t.audit.was} value={describeValue(e.before)} />
              <Side title={t.audit.became} value={describeValue(e.after)} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function AuditTable({ items }: { items: AuditEntry[] }) {
  const [filter, setFilter] = useState<AuditFilter>(emptyAuditFilter);
  const actionId = useId();
  const actorId = useId();
  const noId = useId();
  const actions = useMemo(() => {
    const byAction = new Map<string, string>();
    for (const i of items) if (!byAction.has(i.action)) byAction.set(i.action, i.actionLabel);
    return [...byAction.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [items]);
  const actors = useMemo(() => distinct(items.map((i) => i.actor)), [items]);
  const shown = useMemo(() => filterAudit(items, filter), [items, filter]);
  const patch = (p: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...p }));

  if (!items.length) return <EmptyState hint={t.audit.emptyHint}>{t.audit.empty}</EmptyState>;
  return (
    <>
      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor={actionId}>{t.audit.actionLabel}</label>
          <select id={actionId} className={styles.control} value={filter.action} onChange={(e) => patch({ action: e.target.value })}>
            <option value="">{t.audit.allActions}</option>
            {actions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={actorId}>{t.audit.actorLabel}</label>
          <select id={actorId} className={styles.control} value={filter.actor} onChange={(e) => patch({ actor: e.target.value })}>
            <option value="">{t.audit.allActors}</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={noId}>{t.audit.requestLabel}</label>
          <input
            id={noId}
            type="search"
            inputMode="numeric"
            className={styles.control}
            placeholder={t.audit.requestPlaceholder}
            value={filter.entityNo}
            autoComplete="off"
            onChange={(e) => patch({ entityNo: e.target.value })}
          />
        </div>
        {!isAuditFilterEmpty(filter) && (
          <div className={styles.field}>
            <Button onClick={() => setFilter(emptyAuditFilter)}>{t.audit.reset}</Button>
          </div>
        )}
      </div>
      <p className={styles.muted} role="status">
        {t.audit.shown(shown.length, items.length)}
      </p>
      {shown.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.audit} role="table" aria-label={t.audit.tableLabel}>
            <thead>
              <tr role="row">
                {[t.audit.colWhen, t.audit.colWho, t.audit.colWhat, t.audit.colTarget, t.audit.colChange, t.audit.colNote].map((c) => (
                  <th key={c} role="columnheader" scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <AuditRow key={e.id} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>{t.audit.nothingFound}</EmptyState>
      )}
    </>
  );
}

export function AuditSection() {
  const query = useSettingsAudit();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={t.sections.audit}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <AuditTable items={data.items} />}</QueryBoundary>
    </section>
  );
}
