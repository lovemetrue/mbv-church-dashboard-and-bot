import { useId, useMemo, useState } from 'react';
import type { KitPerson } from '@contracts';
import { formatDateTime, formatPhone, phoneDigits } from '../../entities/format';
import { useCanChange } from '../../shared/access';
import { serverText } from '../../shared/api/serverText';
import { downloadCsv, toCsv } from '../../shared/csv';
import { ru } from '../../shared/i18n/ru';
import { Button, EmptyState, ErrorState, LoadingState, Modal, TableScroll } from '../../shared/ui';
import styles from './KitsIssued.module.css';
import { useKitAction, useKitsIssued } from './useKits';

const t = ru.kitsIssued;

const norm = (v: string): string => v.toLowerCase().replace(/ё/g, 'е');

/** Короче четырёх цифр кусок телефона не ищем: «7» есть в каждом «+7 …» и находил бы всех подряд. */
const PHONE_MIN_DIGITS = 4;

/**
 * Совпадает ли строка с запросом. Цифры — номер регистрации (с начала), а от четырёх цифр без «№» ещё и кусок
 * телефона; всё остальное — слова ФИО в любом порядке, «ё» как «е»: так же ищет сервер на стойке.
 */
export function matchesIssued(p: KitPerson, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (/^[№\s\d+()-]+$/.test(q)) {
    const digits = phoneDigits(q);
    if (digits === '' || String(p.registrationNo).startsWith(digits)) return true;
    return !q.includes('№') && digits.length >= PHONE_MIN_DIGITS && phoneDigits(p.phone).includes(digits);
  }
  const fio = norm(p.fio);
  return norm(q).split(/\s+/).filter(Boolean).every((w) => fio.includes(w));
}

const issuedByText = (by: string | null): string => by ?? '';

/**
 * Окно «Наборов выдано» из «Команды → Кампания»: все, кому выдан набор. Здесь только сверка и исправление ошибки:
 * новую выдачу отмечают на «Стойке регистрации» или в боте. Отмена — кнопка, которой нет у «Только чтение».
 */
export function KitsIssuedModal({ onClose }: { onClose: () => void }) {
  const query = useKitsIssued();
  const undo = useKitAction('undo');
  const canChange = useCanChange();
  const [text, setText] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const searchId = useId();
  const all = query.data?.items;
  const shown = useMemo(() => (all ?? []).filter((p) => matchesIssued(p, text)), [all, text]);

  const exportCsv = () => {
    const date = new Date().toLocaleDateString('sv-SE');
    downloadCsv(
      `${t.fileName}-${date}.csv`,
      toCsv(
        [t.colNo, t.colFio, t.colPhone, t.colWhen, t.colBy],
        shown.map((p) => [p.registrationNo, p.fio, formatPhone(p.phone), formatDateTime(p.issuedAt), issuedByText(p.issuedBy)]),
      ),
    );
  };

  const cancel = (p: KitPerson) => {
    setFailed(null);
    undo.mutate(p.userId, {
      onError: (error) => setFailed(serverText(error, { network: ru.kits.network, fallback: ru.kits.fallback })),
    });
  };

  return (
    <Modal title={t.title} onClose={onClose} wide>
      {all === undefined ? (
        query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <LoadingState lines={5} />
      ) : (
        <div className={styles.body}>
          <div className={styles.tools}>
            <div className={styles.search}>
              <label htmlFor={searchId}>{t.searchLabel}</label>
              <input
                id={searchId}
                type="search"
                className={styles.input}
                placeholder={t.searchPlaceholder}
                value={text}
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <Button disabled={shown.length === 0} onClick={exportCsv}>
              {t.exportCsv}
            </Button>
          </div>
          <p className={styles.count} role="status">
            {t.shown(shown.length, all.length)}
          </p>
          {failed && (
            <p className={styles.error} role="alert">
              {failed}
            </p>
          )}
          {shown.length === 0 ? (
            <EmptyState>{all.length === 0 ? t.empty : ru.states.nothingFound}</EmptyState>
          ) : (
            <TableScroll label={t.tableLabel}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {[t.colNo, t.colFio, t.colPhone, t.colWhen, t.colBy].map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                    {canChange && (
                      <th scope="col">
                        <span className={styles.srOnly}>{t.colActions}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.userId}>
                      <td className="num">{p.registrationNo}</td>
                      <td>{p.fio}</td>
                      <td className="num">{formatPhone(p.phone) || t.noPhone}</td>
                      <td>{formatDateTime(p.issuedAt)}</td>
                      <td>{p.issuedBy ?? ''}</td>
                      {canChange && (
                        <td>
                          <Button variant="ghost" disabled={undo.isPending} aria-label={t.undoLabel(p.fio)} onClick={() => cancel(p)}>
                            {ru.kits.undo}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}
    </Modal>
  );
}
