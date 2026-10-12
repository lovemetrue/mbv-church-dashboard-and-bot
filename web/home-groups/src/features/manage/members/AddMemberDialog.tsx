import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { GroupItem, MemberAddOk } from '@contracts';
import { formatPhone, groupLabel, phoneDigits } from '../../../entities/format';
import { usePeople } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button, ErrorState, LoadingState, Modal, Pill, StrangeBadge } from '../../../shared/ui';
import buttonStyles from '../../../shared/ui/Button.module.css';
import manage from '../Manage.module.css';
import { buildAddBody, isFutureDate, searchPeople, todayIso, type AddForm } from './model';
import styles from './Members.module.css';
import { useMemberAction } from './refresh';

const t = ru.members.addDialog;

type Mode = 'directory' | 'new';
const NO_NEW = { fio: '', phone: '', age: '', place: '' };

/**
 * Окно «Добавить человека»: выбрать из справочника людей или внести нового «по плюсу» (его карточка
 * сразу появится в «Люди»). После добавления окно можно оставить открытым и добавить ещё.
 */
export function AddMemberDialog({ g, onClose }: { g: GroupItem; onClose: () => void }) {
  const uid = useId();
  const nav = useAppNav();
  const people = usePeople();
  const { run, busy } = useMemberAction();
  const busyRef = useRef(false);
  busyRef.current = busy;
  const today = todayIso();

  const [mode, setMode] = useState<Mode>('directory');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [fresh, setFresh] = useState(NO_NEW);
  const [joinedOn, setJoinedOn] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ personKey: string | null; created: boolean } | null>(null);

  // Направленные через сервис и внесённые вручную одинаково «уже в составе»: сервер всё равно ответил бы 409.
  const taken = useMemo(() => new Set(g.members.map((m) => m.personKey)), [g.members]);
  const found = useMemo(() => searchPeople(people.data?.items ?? [], query), [people.data, query]);
  const chosen = picked ? people.data?.items.find((p) => p.key === picked) : undefined;

  const form: AddForm = mode === 'directory' ? { mode, personKey: picked, joinedOn, note } : { mode, ...fresh, joinedOn, note };
  const body = buildAddBody(form);
  // Пустую дату сервер примет, дату из завтрашнего дня — нет; говорим об этом сразу, а не после запроса.
  const future = isFutureDate(joinedOn, today);
  const canSubmit = body !== null && !future && !busy;

  const change = (fn: () => void) => {
    fn();
    setError(null);
  };

  function startNew() {
    const q = query.trim();
    // Набранное в поиске переносим в форму: имя — в ФИО, цифры — в телефон; второй раз печатать не нужно.
    setFresh((f) => ({
      ...f,
      fio: f.fio || (/\p{L}/u.test(q) ? q : ''),
      phone: f.phone || (!/\p{L}/u.test(q) && phoneDigits(q).length >= 3 ? q : ''),
    }));
    setMode('new');
    setError(null);
  }

  function again() {
    setDone(null);
    setQuery('');
    setPicked(null);
    setFresh(NO_NEW);
    setJoinedOn('');
    setNote('');
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || body === null) return;
    setError(null);
    const result = await run(`groups/${g.id}/members/create`, body);
    // null — повторное нажатие, пока первый запрос не закончился: ответит первый.
    if (result === null) return;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone({ personKey: (result.data as Partial<MemberAddOk> | null)?.personKey ?? null, created: mode === 'new' });
  }

  const dateField = (
    <div className={manage.field}>
      <label htmlFor={`${uid}-date`}>{t.joinedOn}</label>
      <input
        id={`${uid}-date`}
        className={`${manage.control} ${future ? manage.invalid : ''}`}
        type="date"
        max={today}
        value={joinedOn}
        disabled={busy}
        aria-invalid={future ? true : undefined}
        aria-describedby={future ? `${uid}-date-err` : undefined}
        onChange={(e) => change(() => setJoinedOn(e.target.value))}
      />
      {future && (
        <p id={`${uid}-date-err`} className={manage.fieldError}>
          {t.futureDate}
        </p>
      )}
    </div>
  );
  const noteField = (
    <div className={manage.fieldWide}>
      <label htmlFor={`${uid}-note`}>{t.note}</label>
      <textarea
        id={`${uid}-note`}
        className={manage.control}
        rows={2}
        maxLength={300}
        value={note}
        disabled={busy}
        onChange={(e) => change(() => setNote(e.target.value))}
      />
    </div>
  );

  const freshField = (name: keyof typeof NO_NEW, label: string, extra: { required?: boolean; inputMode?: 'tel' | 'numeric' } = {}) => (
    <div className={manage.field}>
      <label htmlFor={`${uid}-${name}`} className={extra.required ? manage.required : undefined}>
        {label}
      </label>
      <input
        id={`${uid}-${name}`}
        className={manage.control}
        type="text"
        autoComplete="off"
        inputMode={extra.inputMode}
        aria-required={extra.required ? true : undefined}
        value={fresh[name]}
        disabled={busy}
        onChange={(e) => change(() => setFresh((f) => ({ ...f, [name]: e.target.value })))}
      />
    </div>
  );

  return (
    <Modal title={t.title(groupLabel(g))} onClose={() => !busyRef.current && onClose()}>
      {done ? (
        <>
          <p className={styles.done} role="status">
            {done.created ? t.addedNew : t.added}
          </p>
          <div className={styles.doneActions}>
            {done.created && done.personKey && (
              <Button
                onClick={() => {
                  nav.openPerson(done.personKey as string);
                  onClose();
                }}
              >
                {t.openCard}
              </Button>
            )}
            <Button onClick={again}>{t.more}</Button>
            <Button variant="primary" onClick={onClose}>
              {t.done}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <div role="tablist" aria-label={t.modes} className={styles.tabs}>
            <button
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={mode === 'directory'}
              onClick={() => change(() => setMode('directory'))}
            >
              {t.fromDirectory}
            </button>
            <button type="button" role="tab" className={styles.tab} aria-selected={mode === 'new'} onClick={startNew}>
              {t.newPerson}
            </button>
          </div>

          {mode === 'directory' ? (
            <div>
              <label htmlFor={`${uid}-q`} className="visually-hidden">
                {t.search}
              </label>
              <div className={styles.searchRow}>
                <input
                  id={`${uid}-q`}
                  className={manage.control}
                  type="search"
                  autoComplete="off"
                  placeholder={t.searchPlaceholder}
                  value={query}
                  disabled={busy}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="button"
                  className={`${buttonStyles.btn} ${buttonStyles.md} ${styles.plus}`}
                  aria-label={t.newFromSearch}
                  title={t.newFromSearch}
                  disabled={busy}
                  onClick={startNew}
                >
                  +
                </button>
              </div>
              {people.isPending ? (
                <LoadingState lines={3} />
              ) : people.isError ? (
                <ErrorState error={people.error} onRetry={() => void people.refetch()} />
              ) : found.items.length === 0 ? (
                <p className={styles.status}>{t.noMatches}</p>
              ) : (
                <>
                  <ul className={styles.options} aria-label={t.list}>
                    {found.items.map((p) => {
                      const already = taken.has(p.key);
                      const meta = [p.phone ? formatPhone(p.phone) : '', p.district, p.ageLabel, p.from, p.groups.length ? `Группы: ${p.groups.join(', ')}` : '']
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <li key={p.key}>
                          <button
                            type="button"
                            className={styles.option}
                            aria-pressed={picked === p.key}
                            disabled={already || busy}
                            onClick={() => change(() => setPicked(p.key))}
                          >
                            <span className={styles.optionName}>
                              {p.fio}
                              {/* Вся строка — кнопка: значок без фокуса, подсказка у него обычный title. Нужен именно здесь, чтобы не добавить «странного» в обычную группу не глядя. */}
                              <StrangeBadge mark={p.strange} interactive={false} />
                              {already && <Pill>{t.already}</Pill>}
                            </span>
                            <span className={styles.optionMeta}>{meta}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className={styles.status}>{t.found(found.items.length, found.total)}</p>
                </>
              )}
              <p className={chosen ? styles.chosen : styles.status}>{chosen ? t.chosen(chosen.fio) : t.noneChosen}</p>
              <div className={styles.fields}>
                {dateField}
                {noteField}
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.fields}>
                {freshField('fio', t.fio, { required: true })}
                {freshField('phone', t.phone, { inputMode: 'tel' })}
                {freshField('age', t.age)}
                {freshField('place', t.place)}
                {dateField}
                {noteField}
              </div>
              <p className={manage.note}>{t.newNote}</p>
            </div>
          )}

          {error && (
            <p className={manage.formError} role="alert">
              {error}
            </p>
          )}
          <div className={manage.foot}>
            <Button onClick={onClose} disabled={busy}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {busy ? t.submitting : t.submit}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
