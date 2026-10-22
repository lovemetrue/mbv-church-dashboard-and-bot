import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { KitPerson, KitsView } from '@contracts';
import { formatDateTime } from '../../entities/format';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { Button, ErrorState, LoadingState } from '../../shared/ui';
import { Camera, liveCameraAvailable } from './Camera';
import { decodePhoto } from './decode';
import styles from './Kits.module.css';
import { useFindKit, useKitAction, useKits } from './useKits';

const t = ru.kits;
const errorText = (error: unknown): string => serverText(error, { network: t.network, fallback: t.fallback });

/** Что сейчас на экране под сканером: найденный участник с итогом последнего действия или ошибка. */
type Result =
  | { kind: 'person'; person: KitPerson; done: 'issued' | 'undone' | null }
  | { kind: 'error'; message: string };

/**
 * «Наборы»: координатор сканирует QR из карточки регистрации (с экрана телефона участника или с распечатки)
 * и отмечает выдачу. Отметка та же, что ставит бот, когда служитель сканирует QR камерой Telegram.
 *
 * Сразу после сканирования набор не отмечается: сначала карточка с именем и кнопка «Выдать набор». Лишняя
 * секунда, зато чужой код, случайно попавший в кадр, не запишется молча, а повторная выдача видна сразу.
 */
export function KitsScreen() {
  const kits = useKits();
  const find = useFindKit();
  const issue = useKitAction('issue');
  const undo = useKitAction('undo');
  const [result, setResult] = useState<Result | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<'idle' | 'reading'>('idle');
  const [manual, setManual] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const live = liveCameraAvailable();

  const lookup = (code: string) => {
    if (find.isPending) return;
    find.mutate(code, {
      onSuccess: (out) => {
        setResult({ kind: 'person', person: out.person, done: null });
        // Короткая вибрация: координатор смотрит на участника, а не в экран, и так понимает, что код прочитан.
        navigator.vibrate?.(60);
      },
      onError: (error) => setResult({ kind: 'error', message: errorText(error) }),
    });
  };

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Сбрасываем выбор: иначе второй снимок с тем же именем файла не вызвал бы onChange.
    e.target.value = '';
    if (!file) return;
    setPhotoState('reading');
    try {
      const text = await decodePhoto(file);
      if (text) lookup(text);
      else setResult({ kind: 'error', message: t.photoNotFound });
    } catch {
      setResult({ kind: 'error', message: t.photoNotFound });
    } finally {
      setPhotoState('idle');
    }
  };

  const onManual = (e: FormEvent) => {
    e.preventDefault();
    if (manual.trim()) lookup(manual.trim());
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
    setManual('');
    find.reset();
  };

  return (
    <div className={styles.page}>
      <Summary query={kits} />

      <section className={styles.panel} aria-labelledby="kits-scan">
        <h2 id="kits-scan" className={styles.title}>{t.scanTitle}</h2>
        <p className={styles.hint}>{t.scanHint}</p>
        {!live && <p className={styles.notice}>{t.insecure}</p>}
        {camera && (
          <Camera
            paused={result !== null || find.isPending}
            onCode={lookup}
            onError={(message) => { setCamera(false); setCameraError(message); }}
          />
        )}
        {cameraError && <p className={styles.notice} role="alert">{cameraError}</p>}
        <div className={styles.scanButtons}>
          {live && (
            <Button variant={camera ? 'default' : 'primary'} size="big" onClick={() => { setCameraError(null); setCamera((on) => !on); }}>
              {camera ? t.stopCamera : t.startCamera}
            </Button>
          )}
          <Button variant={live ? 'default' : 'primary'} size="big" disabled={photoState === 'reading'} onClick={() => photoRef.current?.click()}>
            {photoState === 'reading' ? t.photoReading : t.photo}
          </Button>
          {/* capture: телефон сразу открывает камеру, а не галерею. Работает и по http. */}
          <input ref={photoRef} className={styles.fileInput} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(e) => void onPhoto(e)} />
        </div>
        <form className={styles.manual} onSubmit={onManual}>
          <label className={styles.manualLabel} htmlFor="kit-manual">{t.manualLabel}</label>
          <div className={styles.manualRow}>
            <input
              id="kit-manual"
              className={styles.manualInput}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t.manualPlaceholder}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <Button type="submit" disabled={find.isPending || !manual.trim()}>{find.isPending ? t.finding : t.find}</Button>
          </div>
        </form>
      </section>

      <div aria-live="polite">
        {result?.kind === 'error' && (
          <section className={`${styles.panel} ${styles.errorCard}`} role="alert">
            <p className={styles.errorText}>{result.message}</p>
            {camera && <p className={styles.hint}>{t.brightness}</p>}
            <Button onClick={next}>{t.next}</Button>
          </section>
        )}
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

      <Recent query={kits} onOpen={(p) => lookup(String(p.registrationNo))} />
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
        {person.phone && <span className="num">{person.phone}</span>}
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
        <ul className={styles.recent}>
          {query.data.recent.map((p) => (
            <li key={p.userId}>
              {/* По нажатию — та же карточка, что после сканирования: оттуда же и отменяют ошибочную выдачу. */}
              <button type="button" className={styles.recentRow} aria-label={t.open(p.fio)} onClick={() => onOpen(p)}>
                <span className={styles.recentFio}>{p.fio}</span>
                <span className={`${styles.recentMeta} num`}>№{p.registrationNo} · {formatDateTime(p.issuedAt)}{p.issuedBy ? ` · ${p.issuedBy}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
