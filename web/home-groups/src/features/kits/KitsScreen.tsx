import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { KitMatch, KitPerson, KitsView } from '@contracts';
import { formatDateTime, formatPhone } from '../../entities/format';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { Button, ErrorState, LoadingState } from '../../shared/ui';
import styles from './Kits.module.css';
import { useFindKit, useKitAction, useKits, useSearchKits } from './useKits';

const t = ru.kits;
const errorText = (error: unknown): string => serverText(error, { network: t.network, fallback: t.fallback });

/** Номер регистрации (с «№» или без) открывает карточку сразу, остальное — поиск по ФИО. */
const isNumber = (query: string): boolean => /^№?\s*\d+$/.test(query);

/** Что сейчас на экране под поиском: список совпадений, найденный участник или ошибка. */
type Result =
  | { kind: 'list'; items: KitMatch[]; more: boolean }
  | { kind: 'person'; person: KitPerson; done: 'issued' | 'undone' | null }
  | { kind: 'error'; message: string };

/**
 * «Наборы»: координатор у стола выдачи находит участника по номеру регистрации (он в карточке под QR) или по
 * ФИО и отмечает выдачу. Отметка та же, что ставит бот (кнопка «📦 Выдать набор» и QR в Telegram).
 *
 * Сканера здесь пока нет: живой камере браузер нужен https, а интерфейс открывают по http. Код камеры и
 * распознавания остался в PR #60, первый коммит 9940021 (`git fetch origin pull/60/head`), см. README.
 *
 * Найденного не отмечаем сразу: сначала карточка с именем и кнопка «Выдать набор», так тёзка или опечатка
 * не запишется молча, а повторная выдача видна сразу.
 */
export function KitsScreen() {
  const kits = useKits();
  const find = useFindKit();
  const search = useSearchKits();
  const issue = useKitAction('issue');
  const undo = useKitAction('undo');
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  const busy = find.isPending || search.isPending;
  const resultRef = useRef<HTMLDivElement>(null);

  // На телефоне результат появляется ниже края экрана (над ним счётчики и поиск): без прокрутки координатор
  // не видит, что человек нашёлся, и ищет кнопку «Выдать набор». В jsdom метода нет, отсюда `?.`.
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [result]);

  const open = (registrationNo: number) => {
    find.mutate(String(registrationNo), {
      onSuccess: (out) => setResult({ kind: 'person', person: out.person, done: null }),
      onError: (error) => setResult({ kind: 'error', message: errorText(error) }),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    if (isNumber(q)) {
      open(Number(q.replace(/\D/g, '')));
      return;
    }
    search.mutate(q, {
      onSuccess: (out) => setResult({ kind: 'list', items: out.items, more: out.more }),
      onError: (error) => setResult({ kind: 'error', message: errorText(error) }),
    });
  };

  const act = (action: 'issue' | 'undo', person: KitPerson) => {
    const mutation = action === 'issue' ? issue : undo;
    mutation.mutate(person.userId, {
      onSuccess: (out) => setResult({ kind: 'person', person: out.person, done: out.changed ? (action === 'issue' ? 'issued' : 'undone') : null }),
      onError: (error) => setResult({ kind: 'error', message: errorText(error) }),
    });
  };

  const next = () => {
    setResult(null);
    setQuery('');
  };

  return (
    <div className={styles.page}>
      <Summary query={kits} />

      <section className={styles.panel} aria-labelledby="kits-find">
        <h2 id="kits-find" className={styles.title}>{t.findTitle}</h2>
        <p className={styles.hint}>{t.findHint}</p>
        <form className={styles.search} onSubmit={onSubmit} role="search">
          <label className={styles.searchLabel} htmlFor="kit-query">{t.queryLabel}</label>
          <div className={styles.searchRow}>
            <input
              id="kit-query"
              className={styles.searchInput}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t.queryPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="primary" size="big" disabled={busy || !query.trim()}>{busy ? t.finding : t.find}</Button>
          </div>
        </form>
      </section>

      <div ref={resultRef} className={styles.result} aria-live="polite">
        {result?.kind === 'error' && (
          <section className={`${styles.panel} ${styles.errorCard}`} role="alert">
            <p className={styles.errorText}>{result.message}</p>
          </section>
        )}
        {result?.kind === 'list' && <Matches items={result.items} more={result.more} onOpen={open} />}
        {result?.kind === 'person' && (
          <PersonCard
            result={result}
            busy={issue.isPending || undo.isPending}
            onIssue={() => act('issue', result.person)}
            onUndo={() => act('undo', result.person)}
            onNext={next}
          />
        )}
      </div>

      <Recent query={kits} onOpen={(p) => open(p.registrationNo)} />
    </div>
  );
}

function Summary({ query }: { query: ReturnType<typeof useKits> }) {
  if (!query.data) {
    if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    return <LoadingState lines={1} />;
  }
  const d: KitsView = query.data;
  return (
    <dl className={styles.tiles} aria-label={t.summaryLabel}>
      <div className={styles.tile}>
        <dt className={styles.tileLabel}>{t.today}</dt>
        <dd className={`${styles.tileNum} ${styles.ok} num`}>{d.issuedToday}</dd>
      </div>
      <div className={styles.tile}>
        <dt className={styles.tileLabel}>{t.total}</dt>
        <dd className={`${styles.tileNum} num`}>{d.issued}<span className={styles.tileOf}> / {d.registered}</span></dd>
      </div>
      <div className={styles.tile}>
        <dt className={styles.tileLabel}>{t.left}</dt>
        <dd className={`${styles.tileNum} num`}>{Math.max(0, d.registered - d.issued)}</dd>
      </div>
    </dl>
  );
}

/** Совпадения по ФИО. Телефон хвостом: по нему отличают тёзок, спросив у человека, а целиком на экран не выводим. */
function Matches({ items, more, onOpen }: { items: KitMatch[]; more: boolean; onOpen: (registrationNo: number) => void }) {
  if (items.length === 0) {
    return (
      <section className={styles.panel}>
        <p className={styles.hint}>{t.nobody}</p>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-label={t.resultsLabel}>
      {items.length > 1 && <p className={styles.hint}>{t.pick}</p>}
      <ul className={styles.list}>
        {items.map((m) => (
          <li key={m.userId}>
            <button type="button" className={styles.row} aria-label={t.open(m.fio)} onClick={() => onOpen(m.registrationNo)}>
              <span className={styles.rowFio}>{m.fio}</span>
              <span className={`${styles.rowMeta} num`}>
                №{m.registrationNo} · {m.phoneTail ? t.phoneTail(m.phoneTail) : t.noPhone}
                {m.issuedAt && <span className={styles.issuedMark}>{t.issuedMark}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more && <p className={styles.hint}>{t.more}</p>}
    </section>
  );
}

function PersonCard({ result, busy, onIssue, onUndo, onNext }: {
  result: Extract<Result, { kind: 'person' }>;
  busy: boolean;
  onIssue: () => void;
  onUndo: () => void;
  onNext: () => void;
}) {
  const { person, done } = result;
  const issued = person.issuedAt !== null;
  const tone = done === 'issued' ? styles.okCard : issued ? styles.warnCard : '';
  return (
    <section className={`${styles.panel} ${styles.card} ${tone}`} aria-label={t.cardLabel}>
      {done === 'issued' && <p className={styles.doneText}>✓ {t.issuedNow}</p>}
      {done === 'undone' && <p className={styles.doneText}>{t.undone}</p>}
      <p className={styles.fio}>{person.fio}</p>
      <p className={styles.meta}>
        <span className="num">{t.regNo(person.registrationNo)}</span>
        {person.phone && <span className="num">{formatPhone(person.phone)}</span>}
      </p>
      <p className={styles.status}>
        {issued ? t.issuedAt(formatDateTime(person.issuedAt), person.issuedBy) : t.notIssued}
      </p>
      {issued && done !== 'issued' && <p className={styles.warnText}>{t.alreadyIssued}</p>}
      <div className={styles.cardButtons}>
        {!issued && (
          <Button variant="ok" size="big" disabled={busy} onClick={onIssue}>
            {busy ? t.issuing : t.issue}
          </Button>
        )}
        <Button variant={issued ? 'primary' : 'default'} size="big" onClick={onNext}>{t.next}</Button>
        {issued && (
          <Button variant="ghost" disabled={busy} onClick={onUndo}>
            {busy ? t.undoing : t.undo}
          </Button>
        )}
      </div>
    </section>
  );
}

function Recent({ query, onOpen }: { query: ReturnType<typeof useKits>; onOpen: (p: KitPerson) => void }) {
  if (!query.data) return null;
  return (
    <section className={styles.panel} aria-labelledby="kits-recent">
      <h2 id="kits-recent" className={styles.title}>{t.recentTitle}</h2>
      {query.data.recent.length === 0 ? (
        <p className={styles.hint}>{t.recentEmpty}</p>
      ) : (
        <ul className={styles.list}>
          {query.data.recent.map((p) => (
            <li key={p.userId}>
              {/* По нажатию — та же карточка, что после поиска: оттуда же и отменяют ошибочную выдачу. */}
              <button type="button" className={styles.row} aria-label={t.open(p.fio)} onClick={() => onOpen(p)}>
                <span className={styles.rowFio}>{p.fio}</span>
                <span className={`${styles.rowMeta} num`}>№{p.registrationNo} · {formatDateTime(p.issuedAt)}{p.issuedBy ? ` · ${p.issuedBy}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
