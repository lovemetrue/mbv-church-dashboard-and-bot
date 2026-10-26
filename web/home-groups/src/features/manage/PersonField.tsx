import { useMemo, useState } from 'react';
import type { PersonItem } from '@contracts';
import { formatPhone } from '../../entities/format';
import { usePeople } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button, LoadingState, Pill, StrangeBadge } from '../../shared/ui';
import styles from './Manage.module.css';
import list from './members/Members.module.css';
import { searchPeople } from './members/model';

const t = ru.manage.personPicker;

/** В выпадающем списке формы правки длинный перечень не нужен: поиск сужает, а окно и так высокое. */
const PICK_LIMIT = 8;

/**
 * Связать можно регистрацию («u») и карточку, внесённую вручную («p»). Человек из заявки без регистрации («r») — это
 * заявка, а не запись о человеке: сервер такую ссылку не примет, поэтому в списке его нет.
 */
const linkable = (p: PersonItem): boolean => /^[up]\d+$/.test(p.key);

/**
 * Поле «человек из «Людей»» в форме правки группы: ведущий или соведущий. Выбранный показан именем и телефоном, его
 * можно сменить или отвязать; поиск — по ФИО или телефону, как в «Добавить человека» в составе.
 */
export function PersonField({
  id,
  label,
  value,
  taken,
  disabled,
  describedBy,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  /** Ключ человека на другой позиции: его здесь не выбрать. */
  taken: string;
  disabled: boolean;
  describedBy?: string;
  onPick: (person: PersonItem | null) => void;
}) {
  const people = usePeople();
  const [searching, setSearching] = useState(value === '');
  const [query, setQuery] = useState('');
  const items = useMemo(() => (people.data?.items ?? []).filter(linkable), [people.data]);
  const found = useMemo(() => (query.trim() === '' ? null : searchPeople(items, query, PICK_LIMIT)), [items, query]);
  const chosen = value ? items.find((p) => p.key === value) : undefined;

  const pick = (p: PersonItem | null) => {
    onPick(p);
    setQuery('');
    setSearching(p === null);
  };

  if (!searching && value) {
    return (
      <div className={styles.personChosen} aria-describedby={describedBy}>
        {people.isPending ? (
          <LoadingState lines={1} />
        ) : chosen ? (
          <span>
            <b>{chosen.fio}</b> <StrangeBadge mark={chosen.strange} interactive={false} />
            <span className={list.optionMeta}>{chosen.phone ? <span className="num">{formatPhone(chosen.phone)}</span> : t.noPhone}</span>
          </span>
        ) : (
          <span className={list.optionMeta}>{t.unknown}</span>
        )}
        <span className={styles.personTools}>
          <Button size="sm" disabled={disabled} aria-label={t.changeAria(label)} onClick={() => setSearching(true)}>
            {t.change}
          </Button>
          <Button size="sm" disabled={disabled} aria-label={t.unlinkAria(label)} onClick={() => pick(null)}>
            {t.unlink}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div>
      <input
        id={id}
        className={styles.control}
        type="search"
        autoComplete="off"
        placeholder={t.searchPlaceholder}
        aria-label={t.search(label)}
        aria-describedby={describedBy}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      {found === null ? (
        <p className={list.status}>{value ? '' : t.notChosen} {t.typeToSearch}</p>
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
                    disabled={busy || disabled}
                    onClick={() => pick(p)}
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
      {value && (
        <div className={styles.personTools}>
          <Button size="sm" disabled={disabled} onClick={() => setSearching(false)}>
            {t.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
