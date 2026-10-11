import type { RequestItem, RequestsView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from './requestsTestKit';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fresh = (id: number): RequestItem => ({ ...buildRequests().items.find((r) => r.id === 3)!, id, fio: `Новая ${id}` });

/** Очередь, в которую «бот» успел принять новые заявки. */
const withArrivals = (...ids: number[]): RequestsView => {
  const view = buildRequests();
  return { ...view, items: [...view.items, ...ids.map(fresh)] };
};

/** Открывает «Заявки»; `serve.view` подменяет ответ сервера на следующих опросах. */
async function openRequests(query = '') {
  const serve = { view: buildRequests() };
  const client = makeClient();
  stubFetchWithFixtures({ requests: () => json(serve.view) });
  renderAt(<App />, `/?tab=requests${query}`, client);
  await screen.findByRole('list', { name: 'Список заявок' });
  const poll = async () => {
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['requests'] });
    });
  };
  return { serve, poll };
}
const userWithClock = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('«Заявки»: новые заявки, пришедшие во время работы', () => {
  test('при первой загрузке строки «Пришло новых заявок» нет: всё, что есть, не новое', async () => {
    await openRequests();
    expect(screen.queryByText(/Пришло новых заявок/)).not.toBeInTheDocument();
  });

  test('когда после обновления появились новые открытые заявки, над списком тихо пишется их число', async () => {
    const { serve, poll } = await openRequests();
    serve.view = withArrivals(501, 502);
    await poll();
    const line = await screen.findByText('Пришло новых заявок: 2');
    expect(line.closest('[role="status"]')).not.toBeNull();
    expect(within(screen.getByRole('list', { name: 'Список заявок' })).getByText('Новая 501')).toBeInTheDocument();
  });

  test('новые заявки одной и другой проверки складываются, пока строку не скрыли', async () => {
    const { serve, poll } = await openRequests();
    serve.view = withArrivals(501);
    await poll();
    await screen.findByText('Пришло новых заявок: 1');
    serve.view = withArrivals(501, 502, 503);
    await poll();
    expect(await screen.findByText('Пришло новых заявок: 3')).toBeInTheDocument();
  });

  test('«Скрыть» убирает строку', async () => {
    const { serve, poll } = await openRequests();
    serve.view = withArrivals(501);
    await poll();
    await screen.findByText('Пришло новых заявок: 1');
    await userWithClock().click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByText(/Пришло новых заявок/)).not.toBeInTheDocument();
  });

  test('сама исчезает через 30 секунд, а за 29 ещё на месте', async () => {
    const { serve, poll } = await openRequests();
    serve.view = withArrivals(501);
    await poll();
    await screen.findByText('Пришло новых заявок: 1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(screen.getByText('Пришло новых заявок: 1')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await waitFor(() => expect(screen.queryByText(/Пришло новых заявок/)).not.toBeInTheDocument());
  });

  test('если заявок стало меньше (одну утвердили), строки нет', async () => {
    const { serve, poll } = await openRequests();
    const view = buildRequests();
    serve.view = { ...view, items: view.items.filter((r) => r.id !== 1) };
    await poll();
    await waitFor(() => expect(screen.queryByText('Мария Соколова')).not.toBeInTheDocument());
    expect(screen.queryByText(/Пришло новых заявок/)).not.toBeInTheDocument();
  });

  test('утверждение одной заявки вместе с приходом другой не прячет новую: считаем по номерам, а не по разнице', async () => {
    const { serve, poll } = await openRequests();
    const view = withArrivals(501);
    serve.view = { ...view, items: view.items.filter((r) => r.id !== 1) };
    await poll();
    expect(await screen.findByText('Пришло новых заявок: 1')).toBeInTheDocument();
  });

  test('не мешает открытой карточке: она остаётся открытой и выбор не меняется', async () => {
    const { serve, poll } = await openRequests('&req=3');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки: Ирина Жукова/ });
    serve.view = withArrivals(501);
    await poll();
    await screen.findByText('Пришло новых заявок: 1');
    expect(screen.getByRole('dialog', { name: /Карточка заявки: Ирина Жукова/ })).toBe(card);
    expect(currentSearch().get('req')).toBe('3');
  });
});
