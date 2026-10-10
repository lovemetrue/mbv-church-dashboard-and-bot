import { useId } from 'react';
import { FIXTURES_MODE, LOGOUT_URL } from '../shared/api/base';
import { useToday } from '../shared/api/queries';
import { ru } from '../shared/i18n/ru';
import { useAppNav } from '../shared/nav';
import { THEME_CHOICES, isThemeChoice } from '../shared/theme/theme';
import { useTheme } from '../shared/theme/ThemeProvider';
import { Button } from '../shared/ui';
import styles from './App.module.css';

const dateLabel = (): string =>
  new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export function Header() {
  const nav = useAppNav();
  const today = useToday();
  const { theme, setTheme } = useTheme();
  const themeId = useId();

  return (
    <header className={styles.top}>
      <div className={styles.brand}>
        {ru.appName} · {ru.appSection}
        <small>
          {dateLabel()}
          {FIXTURES_MODE ? ` · ${ru.demoData}` : ''}
        </small>
      </div>

      <div className={styles.search}>
        <label className="visually-hidden" htmlFor="global-search">
          {ru.header.searchLabel}
        </label>
        <input
          id="global-search"
          type="search"
          placeholder={ru.header.searchPlaceholder}
          value={nav.search}
          onChange={(e) => nav.setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className={styles.actions}>
      {today.data && (
        <span className={styles.planpill} role="status">
          {ru.header.assignedPrefix}{' '}
          <b className="num">
            {today.data.assigned} {ru.header.assignedOf} {today.data.total}
          </b>
        </span>
      )}

      <div className={styles.create}>
        <Button variant="primary" soon>
          {ru.header.create}
        </Button>
      </div>

      <div className={styles.themeBox}>
        <label htmlFor={themeId} className={styles.themeLabel}>
          {ru.header.theme}
        </label>
        <select
          id={themeId}
          className={styles.themeSelect}
          value={theme}
          onChange={(e) => {
            if (isThemeChoice(e.target.value)) setTheme(e.target.value);
          }}
        >
          {THEME_CHOICES.map((t) => (
            <option key={t} value={t}>
              {ru.themes[t]}
            </option>
          ))}
        </select>
      </div>
      </div>

      {/* Выход — обычная форма POST: сервер сбросит куку и вернёт на вход. */}
      <form method="post" action={LOGOUT_URL} className={styles.logout}>
        <Button type="submit" variant="ghost">
          {ru.header.logout}
        </Button>
      </form>
    </header>
  );
}

