import { useId, useState } from 'react';
import type { AddressRowView, AddressSourceView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, ErrorState, LoadingState, Modal, Pill } from '../../shared/ui';
import { useGeocoderActions, useGeocoderAddresses } from './queries';
import { llmErrorText } from './model';
import styles from './Settings.module.css';

const t = ru.settings.geocoder.table;

type Filter = 'all' | 'attention' | 'missing' | 'waiting' | 'found';
const FILTERS: Filter[] = ['attention', 'missing', 'waiting', 'found', 'all'];
const matches = (f: Filter, row: AddressRowView): boolean => f === 'all' || (f === 'attention' ? row.state !== 'found' : row.state === f);

/**
 * Таблица адресов геокодера: сопоставление «адрес → координаты» и откуда адрес взят. Из строки можно открыть любую карточку
 * (там поправить адрес) и заново определить координаты одного адреса. Ссылки ведут в «Справочник» или «Заявки», окно при
 * этом закрывается вместе с разделом настроек.
 */
export function AddressesModal({ onClose }: { onClose: () => void }) {
  const query = useGeocoderAddresses();
  const actions = useGeocoderActions();
  const nav = useAppNav();
  const filterId = useId();
  const [filter, setFilter] = useState<Filter>('attention');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (s: AddressSourceView) => {
    if (s.kind === 'group') nav.openGroup(Number(s.id));
    else if (s.kind === 'request') nav.openRequest(Number(s.id));
    else nav.openPerson(s.id);
  };

  async function retry(address: string) {
    if (busy) return;
    setBusy(address);
    setError(null);
    try {
      await actions.retry(address);
    } catch (e) {
      setError(llmErrorText(e, { network: t.retryError, forbidden: t.retryError, other: t.retryError }));
    } finally {
      setBusy(null);
    }
  }

  async function reject(address: string) {
    if (busy) return;
    setBusy(address);
    setError(null);
    try {
      await actions.reject(address);
    } catch (e) {
      setError(llmErrorText(e, { network: t.rejectError, forbidden: t.rejectError, other: t.rejectError }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={t.title} onClose={onClose} wide>
      <p className={styles.muted}>{t.intro}</p>
      {query.isPending && <LoadingState lines={4} />}
      {query.isError && !query.data && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <label htmlFor={filterId} className={styles.fieldLabel}>
            {t.filterLabel}
          </label>
          <select id={filterId} className={styles.control} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t.filters[f]} ({query.data.items.filter((r) => matches(f, r)).length})
              </option>
            ))}
          </select>
          {error && (
            <p className={styles.noticeError} role="alert">
              {error}
            </p>
          )}
          <AddressTable rows={query.data.items.filter((r) => matches(filter, r))} busy={busy} onOpen={open} onRetry={(a) => void retry(a)} onReject={(a) => void reject(a)} />
        </>
      )}
      <div className={styles.dialogFoot}>
        <Button onClick={onClose}>{t.close}</Button>
      </div>
    </Modal>
  );
}

interface AddressTableProps {
  rows: AddressRowView[];
  busy: string | null;
  onOpen: (s: AddressSourceView) => void;
  onRetry: (address: string) => void;
  onReject: (address: string) => void;
}

function AddressTable({ rows, busy, onOpen, onRetry, onReject }: AddressTableProps) {
  if (rows.length === 0) return <p className={styles.muted}>{t.empty}</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.audit} ${styles.addrTable}`}>
        <thead>
          <tr>
            <th scope="col">{t.colAddress}</th>
            <th scope="col">{t.colState}</th>
            <th scope="col">{t.colMatched}</th>
            <th scope="col">{t.colSources}</th>
            <th scope="col">{t.colAction}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td>{r.address}</td>
              <td>
                <Pill tone={r.state === 'found' ? 'ok' : r.state === 'missing' ? 'crit' : 'human'}>{t.states[r.state]}</Pill>
                {r.state === 'found' && r.accuracy && r.accuracy !== 'house' && (
                  <span className={styles.accuracyNote}>{t.accuracy[r.accuracy]}</span>
                )}
              </td>
              <td>
                {r.state === 'found' ? (
                  <>
                    {r.matched ?? <span className={styles.muted}>{t.matchedUnknown}</span>}
                    {r.lat !== null && r.lon !== null && (
                      <>
                        {' '}
                        <a
                          href={`https://yandex.ru/maps/?pt=${r.lon},${r.lat}&z=16&l=map`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t.onMapAria(r.address)}
                        >
                          {t.onMap}
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <ul className={styles.plainList}>
                  {r.sources.map((s) => (
                    <li key={`${s.kind}-${s.id}`}>
                      <button type="button" className={styles.linkBtn} aria-label={t.openAria(s.label)} onClick={() => onOpen(s)}>
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </td>
              <td>
                <Button size="sm" disabled={busy !== null} aria-label={t.retryAria(r.address)} onClick={() => onRetry(r.address)}>
                  {busy === r.address ? t.retrying : t.retry}
                </Button>
                {r.state === 'found' && (
                  <Button size="sm" disabled={busy !== null} aria-label={t.notAddressAria(r.address)} onClick={() => onReject(r.address)}>
                    {t.notAddress}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
