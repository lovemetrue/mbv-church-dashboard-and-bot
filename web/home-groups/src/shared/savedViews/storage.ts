import { parseStoredViews, type StoredView } from './model';

export const STORAGE_KEY = 'hg.views.v1';

/**
 * Что не удалось записать в браузер. В приватном окне или при закрытых данных сайта
 * localStorage бросает исключение на любом обращении; тогда виды живут здесь, до закрытия
 * страницы, и переживают уход на другую вкладку приложения (компонент при этом размонтируется).
 */
let unsaved: StoredView[] | null = null;

export function readViews(): StoredView[] {
  if (unsaved) return unsaved;
  try {
    return parseStoredViews(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** true — виды записаны в браузер; false — остались только в памяти страницы. */
export function writeViews(views: readonly StoredView[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
    unsaved = null;
    return true;
  } catch {
    unsaved = [...views];
    return false;
  }
}

/** Только для тестов: память страницы между тестами не должна течь. */
export function resetSavedViewsMemory(): void {
  unsaved = null;
}
