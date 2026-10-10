export type ThemeChoice = 'auto' | 'light' | 'dark' | 'gray';

export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark', 'gray'];
export const THEME_STORAGE_KEY = 'hg.theme';

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (THEME_CHOICES as readonly string[]).includes(v);
}

/** Хранилище может не работать (приватное окно, запрет): тогда живём без запоминания. */
export function loadTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* не страшно: тема просто не запомнится */
  }
}

/**
 * «Авто» — это отсутствие атрибута: тогда работает @media (prefers-color-scheme) из tokens.css
 * и тема следует за системой без единой строки JS на смену.
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
