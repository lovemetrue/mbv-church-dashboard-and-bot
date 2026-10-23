import type { TeamRolesView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const view: TeamRolesView = {
  items: [
    { id: 1, name: 'Координатор малых групп', kind: 'coordinator', members: 9 },
    { id: 3, name: 'Распределитель', kind: 'distributor', members: 0 },
  ],
};

function open(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'settings/team-roles': () => json(view), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=teamRoles', makeClient());
  return fetchMock;
}

async function roles() {
  const region = await screen.findByRole('region', { name: 'Роли команды' });
  const list = await within(region).findByRole('list', { name: 'Роли команды' });
  return { region, rows: within(list).getAllByRole('listitem') };
}

describe('«Настройки → Роли команды»', () => {
  test('роли с названием, смыслом и числом людей; удалить роль с людьми нельзя, и сказано почему', async () => {
    open();
    const { rows } = await roles();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('textbox', { name: 'Название' })).toHaveValue('Координатор малых групп');
    expect(within(rows[0]!).getByRole('combobox', { name: 'Что значит' })).toHaveValue('coordinator');
    expect(within(rows[0]!).getByText('у 9 чел.')).toBeInTheDocument();
    const remove = within(rows[0]!).getByRole('button', { name: 'Удалить роль «Координатор малых групп»' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', expect.stringMatching(/сначала смените им роль/));
    expect(within(rows[1]!).getByRole('button', { name: 'Удалить роль «Распределитель»' })).toBeEnabled();
    // Подписи в списке короткие (на телефоне длинные обрезались бы), а что значит каждая — сказано над списком.
    expect(within(within(rows[0]!).getByRole('combobox', { name: 'Что значит' })).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Без особых настроек', 'Распределитель', 'Координатор групп', 'Старший координатор']);
    expect(screen.getByText(/сервис сам раздаёт ему новые заявки/)).toBeInTheDocument();
  });

  test('«Сохранить» включается после правки и шлёт название и смысл; потом перечитываются роли и списки форм', async () => {
    const fetchMock = open({ 'settings/team-roles/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { rows } = await roles();
    const save = within(rows[1]!).getByRole('button', { name: 'Сохранить роль «Распределитель»' });
    expect(save).toBeDisabled();
    const name = within(rows[1]!).getByRole('textbox', { name: 'Название' });
    await user.clear(name);
    await user.type(name, '  Обзвон ');
    await user.selectOptions(within(rows[1]!).getByRole('combobox', { name: 'Что значит' }), 'Без особых настроек');
    await user.click(save);
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/team-roles/update', body: { id: 3, name: 'Обзвон', kind: null } }]));
    expect(await screen.findByText('Сохранено.')).toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'settings/team-roles')).toBeGreaterThan(1));
  });

  test('новая роль добавляется со смыслом; поле очищается', async () => {
    const fetchMock = open({ 'settings/team-roles/create': () => json({ ok: true, id: 7 }) });
    const user = userEvent.setup();
    const { region } = await roles();
    const form = within(region).getByRole('form', { name: 'Новая роль' });
    const add = within(form).getByRole('button', { name: 'Добавить роль' });
    expect(add).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Молодёжный координатор');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Что значит' }), 'coordinator');
    await user.click(add);
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/team-roles/create', body: { name: 'Молодёжный координатор', kind: 'coordinator' } }]));
    await waitFor(() => expect(within(form).getByRole('textbox', { name: 'Название' })).toHaveValue(''));
  });

  test('отказ сервера показывается его словами', async () => {
    open({ 'settings/team-roles/create': () => json({ error: 'conflict', message: 'Роль «Распределитель» уже есть.' }, 409) });
    const user = userEvent.setup();
    const { region } = await roles();
    const form = within(region).getByRole('form', { name: 'Новая роль' });
    await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'распределитель');
    await user.click(within(form).getByRole('button', { name: 'Добавить роль' }));
    expect(await within(region).findByText('Роль «Распределитель» уже есть.')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Название' })).toHaveValue('распределитель');
  });

  test('удаление свободной роли', async () => {
    const fetchMock = open({ 'settings/team-roles/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { rows } = await roles();
    await user.click(within(rows[1]!).getByRole('button', { name: 'Удалить роль «Распределитель»' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/team-roles/delete', body: { id: 3 } }]));
  });

  test('обычный вход раздела не видит', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    renderAt(<App />, '/?tab=settings&sec=teamRoles', makeClient());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Роли команды' })).not.toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Настройки' })).not.toBeInTheDocument();
  });
});
