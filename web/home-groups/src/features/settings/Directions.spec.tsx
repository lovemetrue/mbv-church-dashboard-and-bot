import type { GroupDirectionsView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const view: GroupDirectionsView = {
  items: [
    { id: 1, name: 'Основное служение', groups: 70 },
    { id: 4, name: 'Филиал «Серебристый»', groups: 0 },
  ],
};

function open(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'settings/directions': () => json(view), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=directions', makeClient());
  return fetchMock;
}

async function directions() {
  const region = await screen.findByRole('region', { name: 'Направления' });
  const list = await within(region).findByRole('list', { name: 'Направления групп' });
  return { region, rows: within(list).getAllByRole('listitem') };
}

describe('«Настройки → Направления»', () => {
  test('направления с числом групп; удалить направление с группами нельзя, и сказано почему', async () => {
    open();
    const { rows } = await directions();
    expect(within(rows[0]!).getByRole('textbox', { name: 'Название' })).toHaveValue('Основное служение');
    expect(within(rows[0]!).getByText('групп: 70')).toBeInTheDocument();
    const remove = within(rows[0]!).getByRole('button', { name: 'Удалить направление «Основное служение»' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', expect.stringMatching(/сначала смените им направление/));
    expect(within(rows[1]!).getByRole('button', { name: 'Удалить направление «Филиал «Серебристый»»' })).toBeEnabled();
  });

  test('новый филиал добавляется, поле очищается, а списки форм и группы перечитываются', async () => {
    const fetchMock = open({ 'settings/directions/create': () => json({ ok: true, id: 5 }) });
    const user = userEvent.setup();
    const { region } = await directions();
    const form = within(region).getByRole('form', { name: 'Новое направление' });
    await user.type(within(form).getByRole('textbox', { name: 'Название' }), ' Филиал «Север» ');
    await user.click(within(form).getByRole('button', { name: 'Добавить направление' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/directions/create', body: { name: 'Филиал «Север»' } }]));
    await waitFor(() => expect(within(form).getByRole('textbox', { name: 'Название' })).toHaveValue(''));
    await waitFor(() => expect(getsOf(fetchMock, 'settings/directions')).toBeGreaterThan(1));
  });

  test('переименование шлёт номер и новое название; отказ сервера — его словами', async () => {
    const fetchMock = open({
      'settings/directions/update': () => json({ error: 'conflict', message: 'Направление «Основное служение» уже есть.' }, 409),
    });
    const user = userEvent.setup();
    const { region, rows } = await directions();
    const name = within(rows[1]!).getByRole('textbox', { name: 'Название' });
    await user.clear(name);
    await user.type(name, 'Основное служение');
    await user.click(within(rows[1]!).getByRole('button', { name: 'Сохранить направление «Филиал «Серебристый»»' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/directions/update', body: { id: 4, name: 'Основное служение' } }]));
    expect(await within(region).findByText('Направление «Основное служение» уже есть.')).toBeInTheDocument();
  });

  test('обычный вход раздела не видит', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    renderAt(<App />, '/?tab=settings&sec=directions', makeClient());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Направления' })).not.toBeInTheDocument());
  });
});
