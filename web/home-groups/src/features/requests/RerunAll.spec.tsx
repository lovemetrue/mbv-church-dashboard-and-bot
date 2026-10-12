import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json, posts, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const RERUN = 'Пересчитать все предложения';
const rerunOk = () => json({ ok: true, created: 2, replaced: 3, unchanged: 5 });

async function openRequests(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, client = makeClient()) {
  const fetchMock = stubFetchWithFixtures(overrides);
  renderAt(<App />, '/?tab=requests', client);
  const block = await screen.findByRole('region', { name: 'Подбор для новых заявок' });
  return { fetchMock, block, client };
}

describe('«Заявки»: пересчитать все предложения', () => {
  test('кнопка видна в блоке подбора и подписана как второстепенная: главная там «Предложить группы новым заявкам»', async () => {
    const { block } = await openRequests();
    const rerun = within(block).getByRole('button', { name: RERUN });
    expect(rerun.className).not.toMatch(/primary/);
    expect(within(block).getByRole('button', { name: 'Предложить группы новым заявкам' }).className).toMatch(/primary/);
  });

  test('нажатие не шлёт запрос сразу, а спрашивает подтверждение с предупреждением', async () => {
    const { fetchMock, block } = await openRequests({ 'matching/rerun-all': rerunOk });
    await userEvent.setup().click(within(block).getByRole('button', { name: RERUN }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Пересчитать предложения всех открытых заявок заново? Утверждённые заявки не меняются, отклонённые вами группы не вернутся. Некоторые предложения могут измениться',
    );
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Отмена» закрывает окно и ничего не отправляет', async () => {
    const { fetchMock, block } = await openRequests({ 'matching/rerun-all': rerunOk });
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: RERUN }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждение шлёт rerun-all с пустым телом, пишет итог и перечитывает заявки, «Сегодня» и группы', async () => {
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { fetchMock, block } = await openRequests({ 'matching/rerun-all': rerunOk }, client);
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: RERUN }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, пересчитать' }));

    expect(await within(block).findByText('Готово: предложений создано 2, заменено 3, без изменений 5')).toBeInTheDocument();
    expect(posts(fetchMock).map((p) => ({ path: p.path, body: p.body }))).toEqual([{ path: 'matching/rerun-all', body: {} }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([['requests'], ['today'], ['groups']]));
  });

  test('двойное подтверждение шлёт один запрос, пока первый не завершён', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, block } = await openRequests({
      'matching/rerun-all': async () => {
        await gate;
        return rerunOk();
      },
    });
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: RERUN }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, пересчитать' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts(fetchMock)).toHaveLength(1);
    // пока считается, обе кнопки блока отключены: параллельный «Предложить группы новым заявкам» испортил бы итог
    expect(within(block).getByRole('button', { name: 'Пересчитываем…' })).toBeDisabled();
    expect(within(block).getByRole('button', { name: 'Предложить группы новым заявкам' })).toBeDisabled();
    release();
    await within(block).findByText(/^Готово: предложений создано/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка показывается понятным текстом, без слов сервера, и запрос можно повторить', async () => {
    const { block } = await openRequests({
      'matching/rerun-all': () => json({ error: 'bad_request', message: 'служебный текст сервера' }, 400),
    });
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: RERUN }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, пересчитать' }));
    const alert = await within(block).findByRole('alert');
    expect(alert).toHaveTextContent('Не получилось пересчитать предложения');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    expect(within(block).getByRole('button', { name: RERUN })).toBeEnabled();
  });
});

describe('«Заявки»: сводка про изменившиеся данные', () => {
  test('считает заявки с proposal.dataChanged и пишет «Данные изменились у N заявок»', async () => {
    const expected = buildRequests().items.filter((r) => r.proposal?.dataChanged).length;
    expect(expected).toBeGreaterThan(0);
    const { block } = await openRequests();
    expect(within(block).getByText(`Данные изменились у ${expected} заявок`)).toBeInTheDocument();
  });

  test('для одной заявки склоняет: «у 1 заявки»', async () => {
    const view = buildRequests();
    const only = view.items.find((r) => r.proposal?.dataChanged)!;
    const items = view.items.map((r) => (r.proposal && r.id !== only.id ? { ...r, proposal: { ...r.proposal, dataChanged: false } } : r));
    const { block } = await openRequests({ requests: () => json({ ...view, items }) });
    expect(within(block).getByText('Данные изменились у 1 заявки')).toBeInTheDocument();
  });

  test('если изменившихся данных нет, строки в сводке нет', async () => {
    const view = buildRequests();
    const items = view.items.map((r) => (r.proposal ? { ...r, proposal: { ...r.proposal, dataChanged: false } } : r));
    const { block } = await openRequests({ requests: () => json({ ...view, items }) });
    expect(within(block).queryByText(/Данные изменились/)).not.toBeInTheDocument();
  });

  test('утверждённые заявки в число не входят: у них предложения уже нет смысла пересчитывать', async () => {
    const view = buildRequests();
    const done = view.items.find((r) => r.bucket === 'done')!;
    const items = view.items.map((r) => (r.id === done.id ? { ...r, proposal: { ...fixtureProposal(), dataChanged: true } } : r));
    const base = view.items.filter((r) => r.proposal?.dataChanged).length;
    const { block } = await openRequests({ requests: () => json({ ...view, items }) });
    expect(within(block).getByText(`Данные изменились у ${base} заявок`)).toBeInTheDocument();
  });
});

function fixtureProposal() {
  return viewWith(1, {}).items.find((r) => r.id === 1)!.proposal!;
}
