import type { GroupsView, MatchingStatus, RequestsView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups, buildRequests } from '../../fixtures/build';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const runOk = () => json({ ok: true, created: 3, replaced: 1, unchanged: 7 });

const LAST_RUN: NonNullable<MatchingStatus['lastRun']> = {
  at: '2026-10-09T09:30:00+03:00',
  created: 4,
  replaced: 2,
  actor: 'auto',
};

/** Очередь заявок с заданным состоянием подбора: так тест «получает от сервера» нужную сводку. */
const requestsWith = (matching: Partial<MatchingStatus>): RequestsView => {
  const view = buildRequests();
  return { ...view, matching: { ...view.matching, ...matching } };
};

let client = makeClient();
beforeEach(() => {
  client = makeClient();
});

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));
const posts = (fetchMock: FetchMock) =>
  callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, body: JSON.parse(String(c.init!.body)) as unknown }));
const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

async function openRequests(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, role: 'admin' | 'super' = 'admin') {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, '/?tab=requests', client);
  const block = await screen.findByRole('region', { name: 'Подбор для новых заявок' });
  return { fetchMock, block };
}

/** Переключатель включается, когда пришёл ответ `/me`: до него права неизвестны. */
async function enabledSwitch(block: HTMLElement) {
  const sw = within(block).getByRole('switch', { name: 'Подбирать новые заявки автоматически' });
  await waitFor(() => expect(sw).toBeEnabled());
  return sw;
}

describe('«Заявки»: подбор для новых заявок', () => {
  test('блок показывает, сколько заявок ждут подбора, и когда подбор запускали в последний раз', async () => {
    const { block } = await openRequests({ requests: () => json(requestsWith({ waiting: 5, lastRun: LAST_RUN })) });
    expect(within(block).getByText('Ждут подбора: 5')).toBeInTheDocument();
    expect(within(block).getByText(/^Последний запуск: .*\d{2}:\d{2}, предложено 4, заменено 2$/)).toBeInTheDocument();
    expect(within(block).queryByText('Подбор ещё не запускали')).not.toBeInTheDocument();
  });

  test('если подбор ещё не запускали, блок так и говорит', async () => {
    const { block } = await openRequests({ requests: () => json(requestsWith({ waiting: 2, lastRun: null })) });
    expect(within(block).getByText('Подбор ещё не запускали')).toBeInTheDocument();
    expect(within(block).queryByText(/Последний запуск/)).not.toBeInTheDocument();
  });

  test('блок напоминает, что предложение — только предложение', async () => {
    const { block } = await openRequests();
    expect(within(block).getByText(/Предложенная группа не меняется, пока подходит/)).toBeInTheDocument();
    expect(within(block).getByText(/человек распределён после «Утвердить»/)).toBeInTheDocument();
  });

  test('«Подобрать для новых заявок» шлёт POST, пишет итог и перечитывает заявки, «Сегодня» и группы', async () => {
    const { fetchMock, block } = await openRequests({ 'matching/run': runOk });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: 'Подобрать для новых заявок' }));

    expect(await within(block).findByText('Готово: предложено 3, заменено 1, без изменений 7')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'matching/run', body: {} }]);
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    // «Группы» на этой вкладке не открыты и сразу не перечитываются, но их надо пометить устаревшими:
    // иначе справочник показал бы старые «Места» до следующего автообновления.
    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([['requests'], ['today'], ['groups']]));
  });

  test('двойное нажатие «Подобрать» отправляет один запрос, пока первый не завершён', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, block } = await openRequests({
      'matching/run': async () => {
        await gate;
        return runOk();
      },
    });
    const user = userEvent.setup();
    const btn = within(block).getByRole('button', { name: 'Подобрать для новых заявок' });
    await user.dblClick(btn);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(btn).toBeDisabled();
    release();
    await within(block).findByText(/^Готово: /);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('два нажатия «Подобрать» до перерисовки тоже дают один запрос: кнопка ещё не успела отключиться', async () => {
    const { fetchMock, block } = await openRequests({ 'matching/run': runOk });
    const btn = within(block).getByRole('button', { name: 'Подобрать для новых заявок' });
    act(() => {
      btn.click();
      btn.click();
    });
    await within(block).findByText(/^Готово: /);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('после завершения запрос можно повторить', async () => {
    const { fetchMock, block } = await openRequests({ 'matching/run': runOk });
    const user = userEvent.setup();
    const btn = within(block).getByRole('button', { name: 'Подобрать для новых заявок' });
    await user.click(btn);
    await within(block).findByText(/^Готово: /);
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
  });

  test('ошибка запуска показывается понятным текстом, без текста сервера', async () => {
    const { block } = await openRequests({
      'matching/run': () => json({ error: 'bad_request', message: 'служебный текст сервера' }, 400),
    });
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: 'Подобрать для новых заявок' }));
    const alert = await within(block).findByRole('alert');
    expect(alert).toHaveTextContent('Не получилось запустить подбор');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    expect(within(block).getByRole('button', { name: 'Подобрать для новых заявок' })).toBeEnabled();
  });

  test('переключатель отражает состояние matching.auto', async () => {
    const { block } = await openRequests({ requests: () => json(requestsWith({ auto: true })) }, 'super');
    expect(within(block).getByRole('switch', { name: 'Подбирать новые заявки автоматически' })).toBeChecked();
  });

  test('для обычного входа переключатель виден, но отключён, с подписью про полный вход', async () => {
    const { fetchMock, block } = await openRequests({}, 'admin');
    const sw = within(block).getByRole('switch', { name: 'Подбирать новые заявки автоматически' });
    expect(sw).toBeDisabled();
    expect(within(block).getByText('Включает только полный вход')).toBeInTheDocument();
    await userEvent.setup().click(sw);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('пока роль неизвестна, переключатель отключён: права не угадываем', async () => {
    const never = new Promise<Response>(() => {});
    const { block } = await openRequests({ me: () => never });
    expect(within(block).getByRole('switch', { name: 'Подбирать новые заявки автоматически' })).toBeDisabled();
  });

  test('для полного входа переключатель шлёт {enabled:true} и после ответа перечитывает заявки', async () => {
    let enabled = false;
    const { fetchMock, block } = await openRequests(
      {
        'matching/auto': () => {
          enabled = true;
          return json({ ok: true });
        },
        requests: () => json(requestsWith({ auto: enabled })),
      },
      'super',
    );
    const sw = await enabledSwitch(block);
    expect(within(block).queryByText('Включает только полный вход')).not.toBeInTheDocument();
    await userEvent.setup().click(sw);

    expect(posts(fetchMock)).toEqual([{ path: 'matching/auto', body: { enabled: true } }]);
    await waitFor(() => expect(sw).toBeChecked());
  });

  test('выключение шлёт {enabled:false}', async () => {
    const { fetchMock, block } = await openRequests(
      { 'matching/auto': () => json({ ok: true }), requests: () => json(requestsWith({ auto: true })) },
      'super',
    );
    await userEvent.setup().click(await enabledSwitch(block));
    expect(posts(fetchMock)).toEqual([{ path: 'matching/auto', body: { enabled: false } }]);
  });

  test('ответ 403 на переключатель показывает текст про полный вход, а состояние не меняется', async () => {
    const { block } = await openRequests(
      { 'matching/auto': () => json({ error: 'forbidden', message: 'служебный текст сервера' }, 403) },
      'super',
    );
    const sw = await enabledSwitch(block);
    await userEvent.setup().click(sw);
    const alert = await within(block).findByRole('alert');
    expect(alert).toHaveTextContent('Включает только полный вход');
    expect(sw).not.toBeChecked();
    expect(sw).toBeEnabled();
  });
});

describe('«Справочник»: пометка «утверждено после обратной связи»', () => {
  const groupsWith = (placedNew: number): GroupsView => {
    const view = buildGroups();
    return { ...view, items: view.items.map((g) => (g.id === 1 ? { ...g, placedNew } : g)) };
  };

  test('если после обратной связи утверждали людей, в карточке группы есть пометка с числом', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(2)) });
    renderAt(<App />, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(within(card).getByText('+2 утверждено после обратной связи')).toBeInTheDocument();
    expect(within(card).getByText(/число уже учтено.*ведущий обновит его сам/i)).toBeInTheDocument();
  });

  test('если таких людей нет, пометки в карточке нет', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(0)) });
    renderAt(<App />, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(within(card).queryByText(/утверждено после обратной связи/)).not.toBeInTheDocument();
  });

  test('в таблице у такой группы рядом с местами стоит «+N», число мест не меняется', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(3)) });
    renderAt(<App />, '/?tab=reference');
    const mark = await screen.findByTitle(/\+3 утверждено после обратной связи/);
    const cell = mark.closest('td')!;
    expect(cell).toHaveTextContent(/^\d+\/\d+\+3/);
    expect(screen.getAllByTitle(/утверждено после обратной связи/)).toHaveLength(1);
  });
});
