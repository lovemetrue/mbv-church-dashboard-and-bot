import { useId, useMemo, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { PersonItem, RelativeAddBody, RelativeDeleteBody, RelativeKind } from '@contracts';
import { ApiError } from '../../shared/api/client';
import { queryKeys, usePeople } from '../../shared/api/queries';
import { useCanChange } from '../../shared/access';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, DrawerSection } from '../../shared/ui';
import { searchPeople } from '../manage/members/model';
import { useManageAction } from '../manage/useManage';
import manage from '../manage/Manage.module.css';
import list from '../manage/members/Members.module.css';

const t = ru.relatives;
const KINDS: readonly RelativeKind[] = ['spouse', 'parent', 'child', 'sibling', 'other'];
const PICK_LIMIT = 8;

/** Родственники видны только в «Людях»: после правки перечитываются они. */
const refreshPeople = (client: QueryClient): Promise<unknown> => client.invalidateQueries({ queryKey: queryKeys.people });
const explain = (e: unknown): string | null => (e instanceof ApiError && (e.status === 409 || e.code === 'conflict') ? t.errorConflict : null);

/**
 * «Родственники» в карточке человека (миграция 071): кто кем ему приходится, со ссылкой на карточку. «+ добавить» —
 * найти человека в «Людях» и выбрать степень родства; «Убрать связь» — снять. Связь видна с обеих сторон: у второго
 * человека степень обратная (родитель ↔ ребёнок). Ниже — подсказки «возможно, родственники» (та же фамилия и тот же
 * телефон или адрес): сама система никого не связывает, «Связать» открывает ту же форму с выбранным человеком.
 * Вход «Только чтение» видит список без кнопок.
 */
export function RelativesSection({ p }: { p: PersonItem }) {
  const nav = useAppNav();
  const canChange = useCanChange();
  const { run, busy } = useManageAction(refreshPeople, explain);
  const [adding, setAdding] = useState<{ key: string; fio: string } | 'search' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const relatives = p.relatives ?? [];
  const hints = p.relativeHints ?? [];

  const remove = async (id: number) => {
    setError(null);
    const res = await run('people/relatives/delete', { id } satisfies RelativeDeleteBody);
    if (res && !res.ok) setError(res.message);
  };

  return (
    <DrawerSection title={t.title}>
      {relatives.length === 0 ? (
        <p className={list.empty}>{t.none}</p>
      ) : (
        <ul className={list.list} aria-label={t.title}>
          {relatives.map((r) => (
            <li key={r.id} className={list.row}>
              <span className={list.who}>
                <span className={list.name}>{r.fio}</span>
                <span className={list.meta}>{t.kind[r.kind]}</span>
              </span>
              <span className={list.rowActions}>
                <Button size="sm" aria-label={t.openAria(r.fio)} onClick={() => nav.openPerson(r.key)}>
                  {t.open}
                </Button>
                {canChange && (
                  <Button size="sm" variant="ghost" disabled={busy} aria-label={t.removeAria(r.fio)} onClick={() => void remove(r.id)}>
                    {t.remove}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canChange && !adding && (
        <div className={list.addRow}>
          <Button onClick={() => { setError(null); setAdding('search'); }}>{t.add}</Button>
        </div>
      )}
      {canChange && adding && (
        <AddRelative
          p={p}
          initial={adding === 'search' ? null : adding}
          busy={busy}
          onCancel={() => setAdding(null)}
          onSave={async (body) => {
            setError(null);
            const res = await run('people/relatives', body);
            if (res?.ok) setAdding(null);
            else if (res) setError(res.message);
          }}
        />
      )}
      {error && (
        <p className={manage.formError} role="alert">
          {error}
        </p>
      )}
      {canChange && hints.length > 0 && (
        <div aria-label={t.hintsTitle} role="group">
          <h4 className={list.sub}>{t.hintsTitle}</h4>
          <p className={list.hint}>{t.hintsNote}</p>
          <ul className={list.list}>
            {hints.map((h) => (
              <li key={h.key} className={list.row}>
                <span className={list.who}>
                  <span className={list.name}>{h.fio}</span>
                  <span className={list.meta}>
                    {[h.samePhone ? t.hintSamePhone(h.samePhone) : null, h.sameAddress ? t.hintSameAddress(h.sameAddress) : null].filter(Boolean).join(', ')}
                  </span>
                </span>
                <span className={list.rowActions}>
                  <Button size="sm" aria-label={t.openAria(h.fio)} onClick={() => nav.openPerson(h.key)}>
                    {t.open}
                  </Button>
                  <Button size="sm" aria-label={t.linkAria(h.fio)} onClick={() => { setError(null); setAdding({ key: h.key, fio: h.fio }); }}>
                    {t.link}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DrawerSection>
  );
}

/** Форма «+ добавить»: человек из «Людей» поиском по ФИО или телефону и степень родства. */
function AddRelative({
  p, initial, busy, onCancel, onSave,
}: {
  p: PersonItem;
  initial: { key: string; fio: string } | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: RelativeAddBody) => Promise<void>;
}) {
  const id = useId();
  const people = usePeople();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(initial);
  const [kind, setKind] = useState<RelativeKind | ''>('');
  const taken = useMemo(() => new Set([p.key, ...(p.relatives ?? []).map((r) => r.key)]), [p]);
  const candidates = useMemo(() => (people.data?.items ?? []).filter((x) => !taken.has(x.key)), [people.data, taken]);
  const found = query.trim() === '' ? null : searchPeople(candidates, query, PICK_LIMIT);

  return (
    <form
      className={list.fields}
      onSubmit={(e) => {
        e.preventDefault();
        if (picked && kind) void onSave({ key: p.key, otherKey: picked.key, kind });
      }}
    >
      {picked ? (
        <div className={list.chosen}>
          <span>{t.picked(picked.fio)}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicked(null)}>
            {t.change}
          </Button>
        </div>
      ) : (
        <div>
          <label htmlFor={`${id}-q`}>{t.searchLabel}</label>
          <input
            id={`${id}-q`}
            className={manage.control}
            type="search"
            autoComplete="off"
            placeholder={t.search}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
          />
          {found && (
            found.items.length === 0 ? (
              <p className={list.empty}>{t.nothingFound}</p>
            ) : (
              <ul className={list.options}>
                {found.items.map((x) => (
                  <li key={x.key}>
                    <button type="button" className={list.option} disabled={busy} onClick={() => setPicked({ key: x.key, fio: x.fio })}>
                      <span className={list.optionName}>{x.fio}</span>
                      {x.district && <span className={list.optionMeta}>{x.district}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
      <div>
        <label htmlFor={`${id}-kind`}>{t.kindLabel}</label>
        <select id={`${id}-kind`} className={manage.control} value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as RelativeKind | '')}>
          <option value="">{ru.manage.notChosen}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kind[k]}
            </option>
          ))}
        </select>
      </div>
      <div className={list.doneActions}>
        <Button type="submit" variant="primary" disabled={busy || !picked || !kind}>
          {t.save}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
