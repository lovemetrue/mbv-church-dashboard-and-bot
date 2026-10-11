import { useId, useState, type FormEvent } from 'react';
import { ru } from '../i18n/ru';
import { useAppNav } from '../nav';
import { Button, Popover } from '../ui';
import { describeView } from './describe';
import { VIEWS_PER_SCOPE_MAX, VIEW_NAME_MAX, pickViewParams, viewPatch, type AddError, type ViewScope } from './model';
import styles from './SavedViews.module.css';
import { useSavedViews } from './useSavedViews';

const ERROR_TEXT: Record<AddError, string> = {
  empty: ru.savedViews.errorEmpty,
  long: ru.savedViews.errorLong(VIEW_NAME_MAX),
  limit: ru.savedViews.errorLimit(VIEWS_PER_SCOPE_MAX),
};

/**
 * Кнопка «Мои виды» с окошком: сохранить текущий набор отборов, применить сохранённый, удалить.
 * Хук живёт здесь, а не в окошке: окошко при закрытии размонтируется, а список — нет.
 */
export function SavedViewsMenu({ scope }: { scope: ViewScope }) {
  const { views, persisted, save, remove } = useSavedViews(scope);
  return (
    <Popover label={ru.savedViews.button} badge={views.length || undefined} title={ru.savedViews.title}>
      <SavedViewsPanel scope={scope} views={views} persisted={persisted} save={save} remove={remove} />
    </Popover>
  );
}

interface PanelProps extends ReturnType<typeof useSavedViews> {
  scope: ViewScope;
}

function SavedViewsPanel({ scope, views, persisted, save, remove }: PanelProps) {
  const nav = useAppNav();
  const uid = useId();
  const [name, setName] = useState('');
  const [withSearch, setWithSearch] = useState(false);
  const [message, setMessage] = useState('');

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const query = pickViewParams(scope, nav.params, { withSearch: scope === 'requests' && withSearch });
    const r = save(name, query);
    if (r.error) {
      setMessage(ERROR_TEXT[r.error]);
      return;
    }
    setMessage(ru.savedViews.saved(r.name));
    setName('');
  };

  return (
    <div className={styles.body}>
      {views.length === 0 ? (
        <p className={styles.empty}>{ru.savedViews.empty}</p>
      ) : (
        <ul className={styles.list} aria-label={ru.savedViews.listLabel}>
          {views.map((v) => (
            <li key={v.name} className={styles.item}>
              <button
                type="button"
                className={styles.apply}
                onClick={() => {
                  nav.update(viewPatch(scope, v.query), { replace: true });
                  setMessage(ru.savedViews.applied(v.name));
                }}
              >
                <span className={styles.name}>{v.name}</span>
                <span className={styles.summary}>{describeView(scope, v.query)}</span>
              </button>
              <button
                type="button"
                className={styles.remove}
                aria-label={ru.savedViews.remove(v.name)}
                title={ru.savedViews.remove(v.name)}
                onClick={() => {
                  remove(v.name);
                  setMessage(ru.savedViews.removed(v.name));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={onSave}>
        <label htmlFor={`${uid}-name`} className={styles.label}>
          {ru.savedViews.nameLabel}
        </label>
        <input
          id={`${uid}-name`}
          className={styles.input}
          type="text"
          value={name}
          maxLength={VIEW_NAME_MAX}
          placeholder={ru.savedViews.namePlaceholder}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        {scope === 'requests' && (
          <div>
            <label className={styles.check}>
              <input type="checkbox" checked={withSearch} onChange={(e) => setWithSearch(e.target.checked)} />
              {ru.savedViews.withSearch}
            </label>
            <p className={styles.hint}>{ru.savedViews.withSearchHint}</p>
          </div>
        )}
        <Button type="submit" variant="primary">
          {ru.savedViews.save}
        </Button>
      </form>

      {/* Область живая и есть всегда: скринридер читает только то, что в неё добавили. */}
      <p role="status" className={styles.status}>
        {message}
      </p>
      {!persisted && <p className={styles.warn}>{ru.savedViews.sessionOnly}</p>}
    </div>
  );
}
