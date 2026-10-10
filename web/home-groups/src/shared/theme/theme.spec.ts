import { afterEach, describe, expect, test } from 'vitest';
import { applyTheme, loadTheme, saveTheme } from './theme';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('тема по умолчанию', () => {
  test('пока человек ничего не выбирал, тема светлая, даже если система тёмная', () => {
    expect(loadTheme()).toBe('light');
    applyTheme(loadTheme());
    // Явный атрибут нужен: без него сработал бы prefers-color-scheme системы.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('выбранное человеком «Авто» запоминается и не подменяется светлой', () => {
    saveTheme('auto');
    expect(loadTheme()).toBe('auto');
  });

  test('выбранная тема восстанавливается', () => {
    saveTheme('gray');
    expect(loadTheme()).toBe('gray');
  });

  test('сломанное значение в хранилище даёт светлую тему', () => {
    window.localStorage.setItem('hg.theme', 'розовая');
    expect(loadTheme()).toBe('light');
  });
});
