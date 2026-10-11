/**
 * Ссылка на заявку в новом интерфейсе «Домашние группы» для сообщений служителю. Адрес берётся из
 * `HG_PUBLIC_URL` (тот же, что нужен письмам со ссылкой на пароль). Не задан или неверен — null:
 * тогда сообщение ведёт в старый дашборд, как и раньше.
 */
export function requestLinkBuilder(base: string | undefined | null): ((requestId: number) => string) | undefined {
  const raw = base?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const root = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return (requestId) => `${root}/?tab=requests&req=${requestId}`;
}

/**
 * Куда вести служителя из бота «в дашборд». Новый интерфейс, если задан `HG_PUBLIC_URL` (с завершающей косой
 * чертой, как обычный адрес сайта), иначе прежний адрес старого дашборда. Так отключение старого дашборда не
 * оставляет в боте ссылок в пустоту: достаточно один раз задать адрес нового.
 */
export function dashboardLink(publicUrl: string | undefined | null, legacyUrl: string): string {
  const raw = publicUrl?.trim();
  if (!raw) return legacyUrl;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return legacyUrl;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/`;
  } catch {
    return legacyUrl;
  }
}
