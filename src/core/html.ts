/**
 * Помощники для HTML-разметки сообщений.
 *
 * Telegram (parse_mode=HTML) и MAX (format=html) понимают ограниченный набор тегов.
 * Всё, что пришло от людей — имена, вопросы, названия районов — обязано проходить
 * через esc(): иначе одна угловая скобка в тексте участника ломает отправку сообщения.
 */
export function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Жирный текст. Значение экранируется. */
export const b = (value: string | number | null | undefined): string => `<b>${esc(value)}</b>`;

/** Курсив. Значение экранируется. */
export const i = (value: string | number | null | undefined): string => `<i>${esc(value)}</i>`;

/** Моноширинный фрагмент: удобно для команд, которые служитель копирует. */
export const code = (value: string | number | null | undefined): string => `<code>${esc(value)}</code>`;

/** Ссылка с подписью. Адрес собирает код, а не участник, но экранируем и его — не помешает. */
export const link = (url: string, text: string): string => `<a href="${esc(url)}">${esc(text)}</a>`;
