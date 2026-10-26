import { useMemo, useState } from 'react';
import type { PersonItem } from '@contracts';
import { formatPhone } from '../../entities/format';
import { usePeople } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button, LoadingState, Pill, StrangeBadge } from '../../shared/ui';
import styles from './Manage.module.css';
import list from './members/Members.module.css';
import { searchPeople } from './members/model';
import { useMemberAction } from './members/refresh';

const t = ru.manage.personPicker;

/** В выпадающем списке формы правки длинный перечень не нужен: поиск сужает, а окно и так высокое. */
const PICK_LIMIT = 8;

/**
 * Выбрать можно любого из «Людей»: регистрацию («u»), карточку («p») и человека из заявки без регистрации («r») —
 * ему сервер при сохранении заведёт карточку (ссылаться можно только на запись о человеке, а не на заявку).
 */
const linkable = (p: PersonItem): boolean => /^[upr]\d+$/.test(p.key);

/** Кого выбрали: ключ для сервера, ФИО и телефон — показать до того, как «Люди» перечитаются. */
export interface PickedPerson {
  key: string;
  fio: string;
  phone: string | null;
}

/**
 * Поле «человек из «Людей»» в форме правки группы: ведущий или соведущий. ФИО текстом здесь не вводится — его правят
 * в карточке человека. Выбранный показан именем и телефоном; его можно сменить, а соведущего — и отвязать. Нужного
 * человека нет — «+ Новый человек» заводит карточку (ФИО и телефон) и сразу ставит её на позицию.
 */
export function PersonField({
  id,
  label,
  value,
  taken,
  disabled,
  describedBy,
  allowUnlink = true,
  legacyName,
  onPick,
  onOpen,
}: {
  id: string;
  label: string;
  value: string;
  /** Ключ человека на другой позиции: его здесь не выбрать. */
  taken: string;
  disabled: boolean;
  describedBy?: string;
  /** Ведущего можно только сменить: без ведущего группы не бывает. */
  allowUnlink?: boolean;
  /** Имя, записанное в группе текстом (группа из таблицы церкви), пока человек не выбран. */
  legacyName?: string | null;
  onPick: (person: PickedPerson | null) => void;
  /** Открыть карточку выбранного человека в «Людях»: форма решает, что делать с несохранённым. */
  onOpen?: (key: string) => void;
}) {
  const people = usePeople();
  const { run, busy: creating } = useMemberAction();
  const [searching, setSearching] = useState(value === '');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState({ fio: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  // Выбранный, которого ещё нет в списке «Людей» (только что заведённый): показываем его, пока список перечитывается.
  const [picked, setPicked] = useState<PickedPerson | null>(null);
  const items = useMemo(() => (people.data?.items ?? []).filter(linkable), [people.data]);
  const found = useMemo(() => (query.trim() === '' ? null : searchPeople(items, query, PICK_LIMIT)), [items, query]);
  const inList = value ? items.find((p) => p.key === value) : undefined;
  const chosen: (PickedPerson & { strange?: PersonItem['strange'] }) | undefined =
    inList ?? (picked && picked.key === value ? picked : undefined);
  const off = disabled || creating;

  const pick = (p: PickedPerson | null) => {
    onPick(p);
    setPicked(p);
    setQuery('');
    setAdding(false);
    setError(null);
    setSearching(p === null);
  };

  async function createAndPick() {
    const fio = fresh.fio.trim();
    if (!fio) return;
    setError(null);
    const phone = fresh.phone.trim();
    const result = await run('persons/create', { fields: { fio, ...(phone ? { phone } : {}) } });
    if (result === null) return;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const key = (result.data as { personKey?: string } | null)?.personKey;
    if (!key) {
      setError(t.createFailed);
      return;
    }
    setFresh({ fio: '', phone: '' });
    pick({ key, fio, phone: phone || null });
  }

  // Поле внутри формы группы: Enter отправил бы всю форму без нового человека. Здесь он заводит карточку.
  const enterCreates = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void createAndPick();
  };

  if (!searching && value) {
    return (
      <div className={styles.personChosen} aria-describedby={describedBy}>
        {chosen ? (
          <span>
            <b>{chosen.fio}</b> {chosen.strange !== undefined && <StrangeBadge mark={chosen.strange} interactive={false} />}
            <span className={list.optionMeta}>{chosen.phone ? <span className="num">{formatPhone(chosen.phone)}</span> : t.noPhone}</span>
          </span>
        ) : people.isPending ? (
          <LoadingState lines={1} />
        ) : (
          <span className={list.optionMeta}>{t.unknown}</span>
        )}
        <span className={styles.personTools}>
          {onOpen && inList && (
            <Button size="sm" disabled={off} aria-label={t.openAria(label)} onClick={() => onOpen(inList.key)}>
              {t.open}
            </Button>
          )}
          <Button size="sm" disabled={off} aria-label={t.changeAria(label)} onClick={() => setSearching(true)}>
            {t.change}
          </Button>
          {allowUnlink && (
            <Button size="sm" disabled={off} aria-label={t.unlinkAria(label)} onClick={() => pick(null)}>
              {t.unlink}
            </Button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div>
      {!value && legacyName && <p className={styles.legacyName}>{t.legacy(legacyName)}</p>}
      <input
        id={id}
        className={styles.control}
        type="search"
        autoComplete="off"
        placeholder={t.searchPlaceholder}
        aria-label={t.search(label)}
        aria-describedby={describedBy}
        value={query}
        disabled={off}
        onChange={(e) => setQuery(e.target.value)}
      />
      {found === null ? (
        // Старое имя текстом уже сказано выше; повторять «не выбран» под ним незачем.
        <p className={list.status}>{value || legacyName ? '' : t.notChosen} {t.typeToSearch}</p>
      ) : people.isPending ? (
        <LoadingState lines={2} />
      ) : found.items.length === 0 ? (
        <p className={list.status}>{t.noMatches}</p>
      ) : (
        <>
          <ul className={list.options} aria-label={t.list(label)}>
            {found.items.map((p) => {
              const busy = p.key === taken;
              const meta = [p.phone ? formatPhone(p.phone) : '', p.district, p.from, p.groups.length ? `Группы: ${p.groups.join(', ')}` : '']
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    className={list.option}
                    aria-pressed={p.key === value}
                    disabled={busy || off}
                    onClick={() => pick({ key: p.key, fio: p.fio, phone: p.phone })}
                  >
                    <span className={list.optionName}>
                      {p.fio}
                      <StrangeBadge mark={p.strange} interactive={false} />
                      {busy && <Pill>{t.busyOther}</Pill>}
                    </span>
                    <span className={list.optionMeta}>{meta}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {found.total > found.items.length && <p className={list.status}>{t.more(found.items.length, found.total)}</p>}
        </>
      )}
      {adding ? (
        <div className={styles.newPerson} role="group" aria-label={t.newTitle(label)}>
          <label htmlFor={`${id}-fio`}>{t.newFio}</label>
          <input
            id={`${id}-fio`}
            className={styles.control}
            type="text"
            autoComplete="off"
            value={fresh.fio}
            disabled={off}
            onChange={(e) => setFresh((f) => ({ ...f, fio: e.target.value }))}
            onKeyDown={enterCreates}
          />
          <label htmlFor={`${id}-phone`}>{t.newPhone}</label>
          <input
            id={`${id}-phone`}
            className={styles.control}
            type="text"
            inputMode="tel"
            autoComplete="off"
            value={fresh.phone}
            disabled={off}
            onChange={(e) => setFresh((f) => ({ ...f, phone: e.target.value }))}
            onKeyDown={enterCreates}
          />
          {error && (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.personTools}>
            <Button size="sm" variant="primary" disabled={off || fresh.fio.trim() === ''} onClick={() => void createAndPick()}>
              {creating ? t.newCreating : t.newCreate}
            </Button>
            <Button size="sm" disabled={off} onClick={() => setAdding(false)}>
              {t.newCancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.personTools}>
          <Button
            size="sm"
            disabled={off}
            aria-label={t.newAria(label)}
            onClick={() => {
              // Набранное в поиске переносим: имя — в ФИО, цифры — в телефон; второй раз печатать не нужно.
              const q = query.trim();
              setFresh({ fio: /\p{L}/u.test(q) ? q : '', phone: /\p{L}/u.test(q) ? '' : q });
              setAdding(true);
            }}
          >
            {t.newButton}
          </Button>
          {value && (
            <Button size="sm" disabled={off} onClick={() => setSearching(false)}>
              {t.cancel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
