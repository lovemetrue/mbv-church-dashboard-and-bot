import type { TeamRoleKind } from '@contracts';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups, buildRequests } from '../../fixtures/build';
import { buildOthers } from '../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Личный вход: интерфейс знает, кто вошёл и какая у него роль в справочнике команды. */
/** Личный вход: смысл роли приходит с сервера из справочника ролей, по названию интерфейс его не угадывает. */
const KIND: Record<string, TeamRoleKind> = { Распределитель: 'distributor', Координатор: 'coordinator', 'Старший координатор': 'senior' };
const personal = (name: string, teamRole: string | null, teamKinds: TeamRoleKind[] = teamRole && KIND[teamRole] ? [KIND[teamRole]!] : []) => () =>
  json({ role: 'admin', person: { login: 'x_login', name, teamRole, teamKinds } });

// Открытая карточка тоже содержит поле «В работе у», поэтому ищем в панели отбора списка.
const respSelect = async () =>
  within(await screen.findByRole('group', { name: /Отбор списка/ })).getByRole('combobox', { name: 'В работе у' });
const requestRows = async () => within(await screen.findByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');
const otherRows = async () => within(await screen.findByRole('list', { name: 'Список обращений' })).getAllByRole('listitem');
const groupRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));
const chips = () => within(screen.getByRole('list', { name: 'Текущий отбор' })).getAllByRole('listitem').map((li) => li.textContent?.replace('×', ''));

describe('распределитель: сразу свои и ничьи заявки', () => {
  const ME = 'Анна Л.';

  test('в «Хотят в группу» по умолчанию свои и те, что никто не взял; в адресе ничего лишнего', async () => {
    stubFetchWithFixtures({ me: personal(ME, 'Распределитель') });
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue('~'));
    const expected = buildRequests().items.filter((r) => !r.responsible || r.responsible === ME).length;
    expect(expected).toBeLessThan(buildRequests().items.length);
    await waitFor(async () => expect(await requestRows()).toHaveLength(expected));
    expect(currentSearch().has('resp')).toBe(false);
  });

  test('«Все» показывает все заявки и не сбрасывается обратно', async () => {
    stubFetchWithFixtures({ me: personal(ME, 'Распределитель') });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue('~'));
    await user.selectOptions(select, 'Все');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
    expect(currentSearch().get('resp')).toBe('*');
  });

  test('группы распределителю — все, как раньше', async () => {
    stubFetchWithFixtures({ me: personal(ME, 'Распределитель') });
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    expect(chips()).not.toContain(`Координатор = ${ME}`);
  });
});

describe('координатор: сразу свои группы и свои обращения «хочу открыть группу»', () => {
  const ME = 'Морозов Д.';

  test('во «Группах» по умолчанию только его группы, включая «Не направлять»; чип снимается', async () => {
    stubFetchWithFixtures({ me: personal(ME, 'Координатор') });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    const mine = buildGroups().items.filter((g) => g.coordinator === ME && g.status !== 'Закрыта' && g.status !== 'Аннулирована');
    expect(mine.some((g) => g.doNotRefer)).toBe(true);
    await waitFor(() => expect(groupRows()).toHaveLength(mine.length));
    expect(chips()).toContain(`Координатор = ${ME}`);
    expect(currentSearch().has('f')).toBe(false);
    await user.click(screen.getByRole('button', { name: `Убрать отбор: Координатор = ${ME}` }));
    expect(groupRows().length).toBeGreaterThan(mine.length);
  });

  test('в «Хотят открыть группу» по умолчанию только свои; «Хотят в группу» — все', async () => {
    const leads = buildOthers().filter((o) => o.type === 'lead_group' && o.state === 'open');
    const name = leads[0]!.responsible!;
    stubFetchWithFixtures({ me: personal(name, 'Координатор') });
    renderAt(<App />, '/?tab=requests&view=leads');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue(name));
    await waitFor(async () => expect(await otherRows()).toHaveLength(leads.filter((o) => o.responsible === name).length));
  });

  test('«Хотят в группу» координатору — без отбора', async () => {
    stubFetchWithFixtures({ me: personal(ME, 'Координатор') });
    renderAt(<App />, '/?tab=requests');
    expect(await respSelect()).toHaveValue('');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
  });
});

describe('несколько ролей у одного человека', () => {
  test('распределитель и координатор сразу: в «Хотят в группу» — свои и ничьи, в «Хотят открыть группу» — свои', async () => {
    const leads = buildOthers().filter((o) => o.type === 'lead_group' && o.state === 'open');
    const name = leads[0]!.responsible!;
    stubFetchWithFixtures({ me: personal(name, 'Координатор, Распределитель', ['coordinator', 'distributor']) });
    renderAt(<App />, '/?tab=requests');
    await waitFor(async () => expect(await respSelect()).toHaveValue('~'));
    cleanup();
    stubFetchWithFixtures({ me: personal(name, 'Координатор, Распределитель', ['coordinator', 'distributor']) });
    renderAt(<App />, '/?tab=requests&view=leads');
    await waitFor(async () => expect(await respSelect()).toHaveValue(name));
  });

  test.each([
    ['катализатор', ['catalyst', 'distributor', 'coordinator']],
    ['старший распределитель', ['senior_distributor', 'distributor']],
  ] as const)('%s с ещё одной ролью видит все заявки, без отборов', async (_who, kinds) => {
    stubFetchWithFixtures({ me: personal('Лебедева А.', 'Роли', [...kinds]) });
    renderAt(<App />, '/?tab=requests');
    expect(await respSelect()).toHaveValue('');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
  });

  test('старший координатор с ещё одной ролью видит всё, без отборов', async () => {
    stubFetchWithFixtures({ me: personal('Лебедева А.', 'Распределитель, Старший координатор', ['distributor', 'senior']) });
    renderAt(<App />, '/?tab=requests');
    expect(await respSelect()).toHaveValue('');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
  });
});

describe('смысл роли — из справочника ролей, а не из её названия', () => {
  test('роль «Обзвон», отмеченная распределителем, получает отбор распределителя', async () => {
    stubFetchWithFixtures({ me: personal('Анна Л.', 'Обзвон', ['distributor']) });
    renderAt(<App />, '/?tab=requests');
    const select = await respSelect();
    await waitFor(() => expect(select).toHaveValue('~'));
  });

  test('«Распределитель» без смысла в справочнике отборов не ставит', async () => {
    stubFetchWithFixtures({ me: personal('Анна Л.', 'Распределитель', []) });
    renderAt(<App />, '/?tab=requests');
    expect(await respSelect()).toHaveValue('');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
  });
});

describe('старший координатор и общий вход: без отборов', () => {
  test.each([
    ['старший координатор', personal('Лебедева А.', 'Старший координатор')],
    ['общий вход', () => json({ role: 'admin' })],
  ])('%s видит все заявки и все группы', async (_who, me) => {
    stubFetchWithFixtures({ me });
    renderAt(<App />, '/?tab=requests');
    expect(await respSelect()).toHaveValue('');
    await waitFor(async () => expect(await requestRows()).toHaveLength(buildRequests().items.length));
  });

  test('при общем входе пункта «Мои» и кнопки «Мои группы» нет', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    expect(within(screen.getByRole('dialog', { name: 'Фильтры' })).queryByRole('button', { name: 'Мои группы' })).not.toBeInTheDocument();
  });
});
