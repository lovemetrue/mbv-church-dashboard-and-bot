/** Запасной способ для окон без Clipboard API (http, старые браузеры, запрет разрешения). */
function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  // Вне экрана, но не display:none: скрытое поле браузер не даёт выделить.
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Копирует текст в буфер обмена. Не бросает ошибку: false значит «не вышло», и интерфейс
 * скажет об этом словами, а не сломается. Скопированный текст нигде не записывается.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* запрет или нет защищённого соединения — пробуем запасной способ */
  }
  return copyWithSelection(text);
}
