import type { ActionError } from '@contracts';
import { API_BASE, FIXTURES_MODE, LOGIN_URL } from './base';

/**
 * Ошибка запроса. status = 0 — до сервера не достучались (сеть, обрыв).
 * code — код ошибки действия из контракта (`already_closed`…), если сервер его прислал.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ActionError['error'] | null;
  constructor(status: number, message: string, code: ActionError['error'] | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const ACTION_CODES: readonly string[] = ['bad_request', 'not_found', 'already_closed', 'group_unavailable', 'group_full', 'forbidden', 'conflict'];

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

/**
 * POST с телом JSON — действия координатора. Путь — как у `apiGet`.
 *
 * Тело ошибки (`ActionError`) разбираем, чтобы интерфейс мог ответить по коду, а не по
 * тексту сервера. 401 уводит на вход, как и в `apiGet`. Повторов нет намеренно: действие
 * не идемпотентно с точки зрения человека (двойной «Утвердить» — это два решения).
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  if (FIXTURES_MODE) {
    // В режиме фикстур сервера нет: действие «получается», но данные не меняются.
    const { fixtureActionResponse } = await import('../../fixtures');
    return fixtureActionResponse(path, body) as T;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }

  if (response.status === 401) {
    redirectToLogin(LOGIN_URL);
    throw new ApiError(401, 'Нужно войти');
  }
  if (!response.ok) {
    let code: ActionError['error'] | null = null;
    let message = response.status === 403 ? 'Нет доступа' : `Ошибка ${response.status}`;
    try {
      const data = (await response.json()) as Partial<ActionError>;
      if (typeof data.error === 'string' && ACTION_CODES.includes(data.error)) code = data.error;
      if (typeof data.message === 'string' && data.message) message = data.message;
    } catch {
      /* тело не JSON (например, страница прокси): остаёмся с общим текстом по статусу */
    }
    throw new ApiError(response.status, message, code);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'Сервер вернул не JSON');
  }
}
