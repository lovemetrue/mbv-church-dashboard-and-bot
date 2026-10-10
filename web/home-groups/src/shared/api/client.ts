import { API_BASE, FIXTURES_MODE, LOGIN_URL } from './base';

/** Ошибка запроса. status = 0 — до сервера не достучались (сеть, обрыв). */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RedirectFn = (url: string) => void;

// Переход на вход вынесен в подменяемую функцию: в тестах нельзя трогать window.location.
let redirectToLogin: RedirectFn = (url) => window.location.assign(url);

export function setLoginRedirect(fn: RedirectFn | null): void {
  redirectToLogin = fn ?? ((url) => window.location.assign(url));
}

/**
 * GET к JSON API. Путь — относительно /api/v1/ без ведущей косой черты («today»).
 *
 * 401 — сессия кончилась: уводим на страницу входа и всё равно бросаем ошибку, чтобы
 * запрос не считался успешным, пока браузер переходит.
 */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (FIXTURES_MODE) {
    // Динамический импорт под константой: в боевой сборке ветка вырезается, и фикстуры
    // в бандл не попадают.
    const { fixtureResponse } = await import('../../fixtures');
    return fixtureResponse(path) as T;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Нет связи с сервером');
  }

  if (response.status === 401) {
    redirectToLogin(LOGIN_URL);
    throw new ApiError(401, 'Нужно войти');
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 403 ? 'Нет доступа' : `Ошибка ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'Сервер вернул не JSON');
  }
}
