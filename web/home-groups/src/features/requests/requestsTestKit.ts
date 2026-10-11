/** Общие помощники тестов карточки заявки: подмена ответов, чтение отправленных POST, открытие карточки. */
import type { OtherItem, RequestItem, RequestsView } from '@contracts';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { buildGroups, buildRequests } from '../../fixtures/build';
import { buildOthers } from '../../fixtures/others';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { App } from '../../app/App';
import { createElement } from 'react';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const ok = () => json({ ok: true });
export const fail = (status: number, error: string) => () => json({ error, message: 'служебный текст сервера' }, status);

export const fixtureItem = (id: number): RequestItem => buildRequests().items.find((r) => r.id === id)!;

/** Копия очереди, в которой у заявки подменены поля: так тест «получает от сервера» другое состояние. */
export function viewWith(id: number, patch: Partial<RequestItem>): RequestsView {
  const view = buildRequests();
  return { ...view, items: view.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

/** Очередь с другим списком «Других обращений»: так тест «получает от сервера» нужные обращения. */
export const viewWithOthers = (others: OtherItem[]): RequestsView => ({ ...buildRequests(), others });

/** Обращение из фикстур по номеру. */
export const fixtureOther = (id: number): OtherItem => buildOthers().find((o) => o.id === id)!;

/** Реестр групп, в котором у группы подменены поля. */
export function groupsWith(id: number, patch: Record<string, unknown>) {
  const view = buildGroups();
  return { ...view, items: view.items.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

export type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));

/** Вызовы POST: путь без базы, параметры запроса и разобранное тело. */
export function posts(fetchMock: FetchMock) {
  return callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, init: c.init!, body: JSON.parse(String(c.init!.body)) as Record<string, unknown> }));
}
export const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

export async function openCard(id: number, query = '') {
  // Тест мог уже подменить fetch своими ответами; иначе берём фикстуры.
  if (!vi.isMockFunction(globalThis.fetch)) stubFetchWithFixtures();
  renderAt(createElement(App), `/?tab=requests&req=${id}${query}`);
  return screen.findByRole('dialog', { name: /Карточка заявки/ });
}
