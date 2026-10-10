export type ThemeChoice = 'auto' | 'light' | 'dark' | 'gray';

export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark', 'gray'];
export const THEME_STORAGE_KEY = 'hg.theme';

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (THEME_CHOICES as readonly string[]).includes(v);
}

/**
 * Пока человек сам не выбрал тему, показываем светлую — и на компьютере, и на телефоне.
 * «Авто» (следовать за системой) остаётся выбором, но не умолчанием: у многих на телефоне
 * системная тема тёмная, а церковная команда ждёт светлый интерфейс.
 */
export const DEFAULT_THEME: ThemeChoice = 'light';

/** Хранилище может не работать (приватное окно, запрет): тогда живём без запоминания. */
export function loadTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
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
