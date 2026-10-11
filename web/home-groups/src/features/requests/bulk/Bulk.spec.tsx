import type { RequestItem } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildRequests } from '../../../fixtures/build';
import { queryKeys } from '../../../shared/api/queries';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { buildTeam } from '../../../fixtures/team';
import { getsOf, json, posts } from '../requestsTestKit';
import { pickFirst } from './selection';

afterEach(() => vi.unstubAllGlobals());

const all = buildRequests().items.filter((r) => r.bucket !== 'cancelled');
const fio = (i: number) => all[i]!.fio;
const box = (name: string) => screen.getByRole('checkbox', { name: `Выбрать заявку ${name}` });
const rowsOf = () => within(screen.getByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');
const barEl = () => screen.queryByRole('region', { name: 'Массовые действия' });

const bulkOk = (done: number, skipped = 0) => () => json({ ok: true, done, skipped });

async function openList(url = '/?tab=requests', overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, client = makeClient()) {
  const fetchMock = stubFetchWithFixtures({ 'requests/bulk': bulkOk(2), ...overrides });
  renderAt(<App />, url, client);
  await screen.findByRole('list', { name: 'Список заявок' });
  return { fetchMock, client };
}

/** Заявки-близнецы: нужно больше сотни видимых, а в демо их двадцать. */
function manyRequests(n: number): RequestItem[] {
  const base = all.find((r) => r.bucket === 'ready')!;
  return Array.from({ length: n }, (_, i) => ({ ...base, id: 1000 + i, fio: `Человек ${i + 1}`, responsible: null }));
}

describe('выбор первых N (чистая функция)', () => {
  test('берёт первые N по порядку списка и сообщает, обрезан ли выбор', () => {
    expect(pickFirst([5, 6, 7], 2)).toEqual({ ids: [5, 6], capped: true });
    expect(pickFirst([5, 6], 2)).toEqual({ ids: [5, 6], capped: false });
    expect(pickFirst([], 2)).toEqual({ ids: [], capped: false });
  });
});

describe('«Заявки»: флажки выбора', () => {
  test('у каждой строки есть флажок с именем «Выбрать заявку <ФИО>»', async () => {
    await openList();
    expect(screen.getAllByRole('checkbox', { name: /^Выбрать заявку / })).toHaveLength(rowsOf().length);
    expect(box(fio(0))).not.toBeChecked();
  });

  test('флажок не открывает карточку, а клик по строке по-прежнему открывает', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    expect(box(fio(0))).toBeChecked();
    expect(currentSearch().has('req')).toBe(false);
    await user.click(rowsOf()[1]!);
    expect(currentSearch().get('req')).toBe(String(all[1]!.id));
  });

  test('выбор показывает панель «Выбрано N» и не попадает в адресную строку', async () => {
    const user = userEvent.setup();
    await openList();
    expect(barEl()).toBeNull();
    await user.click(box(fio(0)));
    await user.click(box(fio(1)));
    const bar = screen.getByRole('region', { name: 'Массовые действия' });
    expect(within(bar).getByText('Выбрано 2')).toBeInTheDocument();
    expect(currentSearch().toString()).toBe('tab=requests');
    await user.click(box(fio(1)));
    expect(within(screen.getByRole('region', { name: 'Массовые действия' })).getByText('Выбрано 1')).toBeInTheDocument();
  });

  test('«Снять выбор» убирает все флажки и панель', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    await user.click(screen.getByRole('button', { name: 'Снять выбор' }));
    expect(box(fio(0))).not.toBeChecked();
    expect(barEl()).toBeNull();
  });
});

describe('«Заявки»: «Выбрать все видимые»', () => {
  test('выбирает только видимые при текущем отборе, повторное нажатие снимает', async () => {
    const user = userEvent.setup();
    await openList('/?tab=requests&bucket=human');
    const visible = rowsOf().length;
    expect(visible).toBeLessThan(all.length);
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все видимые' }));
    expect(screen.getAllByRole('checkbox', { name: /^Выбрать заявку / }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(within(screen.getByRole('region', { name: 'Массовые действия' })).getByText(`Выбрано ${visible}`)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все видимые' }));
    expect(barEl()).toBeNull();
  });

  test('видимых больше ста: выбираются первые сто и об этом написано', async () => {
    const user = userEvent.setup();
    const items = manyRequests(130);
    const { fetchMock } = await openList('/?tab=requests', {
      requests: () => json({ ...buildRequests(), items }),
      'requests/bulk': bulkOk(100),
    });
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все видимые' }));
    const bar = screen.getByRole('region', { name: 'Массовые действия' });
    expect(within(bar).getByText('Выбрано 100')).toBeInTheDocument();
    expect(screen.getByText('Видимых заявок 130: выбраны первые 100.')).toBeInTheDocument();
    expect(box('Человек 100')).toBeChecked();
    expect(box('Человек 101')).not.toBeChecked();
    // Сервер принимает не больше сотни: полученные номера — именно первые сто по порядку списка.
    await user.click(within(bar).getByRole('button', { name: 'Отметить «нужен звонок»' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect((posts(fetchMock)[0]!.body.ids as number[])).toEqual(items.slice(0, 100).map((r) => r.id));
  });

  test('на пороге в сто остальные флажки не нажимаются, а причина написана', async () => {
    const user = userEvent.setup();
    await openList('/?tab=requests', { requests: () => json({ ...buildRequests(), items: manyRequests(130) }) });
    await user.click(screen.getByRole('checkbox', { name: 'Выбрать все видимые' }));
    expect(box('Человек 101')).toBeDisabled();
    expect(box('Человек 100')).toBeEnabled();
    // Заменяем одну заявку другой вручную: выбор снова ровно сто, но уже не «первые сто».
    await user.click(box('Человек 1'));
    expect(box('Человек 101')).toBeEnabled();
    await user.click(box('Человек 101'));
    expect(box('Человек 102')).toBeDisabled();
    expect(screen.getByText('Выбрано 100: за один раз больше обработать нельзя.')).toBeInTheDocument();
    expect(screen.queryByText(/выбраны первые/)).toBeNull();
  });
});

describe('«Заявки»: передать', () => {
  async function chooseAndAsk(user: ReturnType<typeof userEvent.setup>, who: string) {
    await user.click(box(fio(0)));
    await user.click(box(fio(1)));
    const bar = screen.getByRole('region', { name: 'Массовые действия' });
    await screen.findByRole('option', { name: 'Петров Г.' });
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Кому передать' }), who);
    await user.click(within(bar).getByRole('button', { name: 'Передать' }));
  }

  test('перед отправкой спрашивает подтверждение, запрос уходит только после него', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openList();
    await chooseAndAsk(user, 'Петров Г.');
    const dialog = await screen.findByRole('dialog', { name: 'Передать 2 заявки: Петров Г.?' });
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Передать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({
      path: 'requests/bulk',
      body: { ids: [all[0]!.id, all[1]!.id], action: 'assign', responsible: 'Петров Г.' },
    });
  });

  test('«Отмена» ничего не отправляет и оставляет выбор', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openList();
    await chooseAndAsk(user, 'Петров Г.');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts(fetchMock)).toHaveLength(0);
    expect(box(fio(0))).toBeChecked();
  });

  test('«Никто» тоже можно: имя в запросе null, в вопросе — что ответственного снимают', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openList();
    await chooseAndAsk(user, 'Никто (снять ответственного)');
    const dialog = await screen.findByRole('dialog', { name: 'Снять ответственного у 2 заявок?' });
    await user.click(within(dialog).getByRole('button', { name: 'Передать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ ids: [all[0]!.id, all[1]!.id], action: 'assign', responsible: null });
  });

  test('пока координатор не выбран, «Передать» недоступна', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    const bar = screen.getByRole('region', { name: 'Массовые действия' });
    expect(within(bar).getByRole('button', { name: 'Передать' })).toBeDisabled();
  });
});

describe('«Заявки»: отметка «нужен звонок»', () => {
  test('«Отметить «нужен звонок»» и «Снять отметку» шлют value true и false после подтверждения', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openList();
    await user.click(box(fio(0)));
    const bar = screen.getByRole('region', { name: 'Массовые действия' });

    await user.click(within(bar).getByRole('button', { name: 'Отметить «нужен звонок»' }));
    let dialog = await screen.findByRole('dialog', { name: 'Отметить «нужен звонок» у 1 заявки?' });
    await user.click(within(dialog).getByRole('button', { name: 'Отметить' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ ids: [all[0]!.id], action: 'need-call', value: true });

    await user.click(box(fio(0)));
    await user.click(within(screen.getByRole('region', { name: 'Массовые действия' })).getByRole('button', { name: 'Снять отметку' }));
    dialog = await screen.findByRole('dialog', { name: 'Снять отметку «нужен звонок» у 1 заявки?' });
    await user.click(within(dialog).getByRole('button', { name: 'Снять отметку' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
    expect(posts(fetchMock)[1]!.body).toEqual({ ids: [all[0]!.id], action: 'need-call', value: false });
  });
});

describe('«Заявки»: итог действия', () => {
  async function runNeedCall(user: ReturnType<typeof userEvent.setup>) {
    await user.click(box(fio(0)));
    await user.click(box(fio(1)));
    await user.click(screen.getByRole('button', { name: 'Отметить «нужен звонок»' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отметить' }));
  }

  test('после успеха: «Готово: обработано N, пропущено M», выбор сброшен, списки перечитаны', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    client.setQueryData(queryKeys.team, buildTeam());
    const { fetchMock } = await openList('/?tab=requests', { 'requests/bulk': bulkOk(1, 1) }, client);
    const before = { requests: getsOf(fetchMock, 'requests'), today: getsOf(fetchMock, 'today') };
    await runNeedCall(user);
    expect(await screen.findByText('Готово: обработано 1, пропущено 1 (закрыты или не найдены)')).toBeInTheDocument();
    expect(barEl()).toBeNull();
    expect(box(fio(0))).not.toBeChecked();
    expect(box(fio(1))).not.toBeChecked();
    expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
    expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
    expect(client.getQueryState(queryKeys.team)?.isInvalidated).toBe(true);
  });

  test('ошибка показывается текстом сервера, выбор остаётся для повтора', async () => {
    const user = userEvent.setup();
    await openList('/?tab=requests', {
      'requests/bulk': () => json({ error: 'bad_request', message: 'За раз можно обработать не больше 100 заявок.' }, 400),
    });
    await runNeedCall(user);
    expect(await screen.findByText('За раз можно обработать не больше 100 заявок.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(box(fio(0))).toBeChecked();
    expect(within(screen.getByRole('region', { name: 'Массовые действия' })).getByText('Выбрано 2')).toBeInTheDocument();
  });

  test('двойное нажатие на подтверждение отправляет один запрос', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock } = await openList('/?tab=requests', { 'requests/bulk': async () => (await gate, json({ ok: true, done: 2, skipped: 0 })) });
    await user.click(box(fio(0)));
    await user.click(screen.getByRole('button', { name: 'Отметить «нужен звонок»' }));
    const ok = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отметить' });
    await user.dblClick(ok);
    expect(posts(fetchMock)).toHaveLength(1);
    await act(async () => release());
    await screen.findByText(/^Готово: обработано 2/);
  });
});

describe('«Заявки»: когда выбор сбрасывается', () => {
  test('смена отбора сбрасывает выбор, и возврат к прежнему отбору его не возвращает', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    await user.click(screen.getByRole('button', { name: /^Нужна помощь/ }));
    expect(barEl()).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Все/ }));
    expect(box(fio(0))).not.toBeChecked();
    expect(barEl()).toBeNull();
  });

  test('поиск и «В работе у» тоже сбрасывают выбор', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    await user.selectOptions(
      within(screen.getByRole('group', { name: 'Отбор списка заявок' })).getByRole('combobox', { name: 'В работе у' }),
      'Никто не взял',
    );
    expect(barEl()).toBeNull();
    await user.click(box(all.find((r) => !r.responsible)!.fio));
    expect(barEl()).not.toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по заявкам' }), 'а');
    expect(barEl()).toBeNull();
  });

  test('уход на другую вкладку и возврат сбрасывают выбор', async () => {
    const user = userEvent.setup();
    await openList();
    await user.click(box(fio(0)));
    await user.click(screen.getByRole('tab', { name: 'Сегодня' }));
    await user.click(screen.getByRole('tab', { name: /^Заявки/ }));
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(box(fio(0))).not.toBeChecked();
    expect(barEl()).toBeNull();
  });

  test('заявка, ушедшая из списка при обновлении, из выбора выпадает', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    await openList('/?tab=requests', {}, client);
    await user.click(box(fio(0)));
    await user.click(box(fio(1)));
    const base = buildRequests();
    act(() => {
      client.setQueryData(queryKeys.requests, { ...base, items: base.items.filter((r) => r.id !== all[1]!.id) });
    });
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Массовые действия' })).getByText('Выбрано 1')).toBeInTheDocument(),
    );
  });
});
