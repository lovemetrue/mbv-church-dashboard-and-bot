/** Помощники тестов: подмена ответов и чтение того, что интерфейс отправил на «сервер». */
import type { stubFetchWithFixtures } from './render';

export type FetchMock = ReturnType<typeof stubFetchWithFixtures>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));

/** POST-запросы: путь без базы и разобранное тело. */
export function posts(fetchMock: FetchMock) {
  return callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, body: JSON.parse(String(c.init!.body)) as Record<string, unknown> }));
}

/** Сколько раз читали адрес. */
export const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

/** Пути всех GET-запросов по порядку. */
export const getPaths = (fetchMock: FetchMock) =>
  callsOf(fetchMock)
    .filter((c) => !c.init?.method)
    .map((c) => c.path);
