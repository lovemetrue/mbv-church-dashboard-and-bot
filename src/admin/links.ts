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
