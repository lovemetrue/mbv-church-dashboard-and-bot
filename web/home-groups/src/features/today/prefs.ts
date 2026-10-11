import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFS, PREFS_KEY, parsePrefs, type MatrixPrefs } from './model';

function read(): MatrixPrefs {
  try {
    return parsePrefs(window.sessionStorage.getItem(PREFS_KEY));
  } catch {
    // Хранилище бывает закрыто (приватное окно, запрет сайта): тогда живём с настройками по умолчанию.
    return DEFAULT_PREFS;
  }
}

/**
 * Режим показа, скрытие пустых и порядок районов. Хранятся в sessionStorage, а не в адресе:
 * переход в «Заявки» из панели сбрасывает адрес (tabParams), а вернувшись, человек ждёт ту же
 * таблицу, какой её оставил. Новая вкладка браузера начинает с настроек по умолчанию.
 */
export function useMatrixPrefs(): [MatrixPrefs, (patch: Partial<MatrixPrefs>) => void] {
  const [prefs, setPrefs] = useState<MatrixPrefs>(read);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* не запомнилось — не страшно */
    }
  }, [prefs]);
  const update = useCallback((patch: Partial<MatrixPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update];
}
