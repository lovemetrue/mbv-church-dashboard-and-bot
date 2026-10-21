import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups, buildRequests } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Личный вход: интерфейс знает, кто вошёл, и сразу показывает его заявки. */
const personal = (name: string) => () => json({ role: 'admin', person: { login: 'x_login', name } });
const ME = 'Анна Л.';

// Открытая карточка тоже содержит поле «В работе у», поэтому ищем в панели отбора списка.
const respSelect = async () =>
  within(await screen.findByRole('group', { name: 'Отбор списка заявок' })).getByRole('combobox', { name: 'В работе у' });
const rowsShown = async () => within(await screen.findByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');

describe('«Заявки» при личном входе: сразу свои и без ответственного', () => {
  test('по умолчанию видны заявки вошедшего и те, что никто не взял; в адресе ничего лишнего', async () => {
    stubFetchWithFixtures({ me: personal(ME) });
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue('~'));
    expect(within(select).getByRole('option', { selected: true })).toHaveTextContent('Мои и без ответственного');
    const expected = buildRequests().items.filter((r) => !r.responsible || r.responsible === ME).length;
    expect(expected).toBeLessThan(buildRequests().items.length);
    await waitFor(async () => expect(await rowsShown()).toHaveLength(expected));
    expect(currentSearch().has('resp')).toBe(false);
  });

  test('«Все» показывает все заявки и не сбрасывается обратно', async () => {
    stubFetchWithFixtures({ me: personal(ME) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue('~'));
    await user.selectOptions(select, 'Все');
    await waitFor(async () => expect(await rowsShown()).toHaveLength(buildRequests().items.length));
    expect(currentSearch().get('resp')).toBe('*');
  });

  test('при общем входе всё как раньше: по умолчанию «Все», пункта «Мои» нет', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    expect(select).toHaveValue('');
    expect(within(select).queryByRole('option', { name: 'Мои и без ответственного' })).not.toBeInTheDocument();
    await waitFor(async () => expect(await rowsShown()).toHaveLength(buildRequests().items.length));
  });
});

describe('«Группы» при личном входе: отбор «Мои группы» в одно нажатие', () => {
  test('в «Фильтрах» есть «Мои группы»: остаются группы, где вошедший — координатор', async () => {
    stubFetchWithFixtures({ me: personal('Морозов Д.') });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Мои группы' }));
    const mine = buildGroups().items.filter((g) => g.coordinator === 'Морозов Д.' && g.status !== 'Закрыта' && g.status !== 'Аннулирована');
    const rows = within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(rows).toHaveLength(mine.length);
    expect(currentSearch().getAll('f')).toContain('Координатор:eq:Морозов Д.');
  });

  test('при общем входе «Моих групп» нет', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    expect(within(screen.getByRole('dialog', { name: 'Фильтры' })).queryByRole('button', { name: 'Мои группы' })).not.toBeInTheDocument();
  });
});
