import type { Me, TeamView } from '@contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildTeam } from '../../fixtures/team';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const withOthers = (otherOpen: number): TeamView => {
  const base = buildTeam();
  return { ...base, totals: { ...base.totals, otherOpen } };
};
const meAs = (role: Me['role']) => () => json({ role });

describe('«Команда»: плитка «Других обращений открыто»', () => {
  test('показывает число из сводки рядом с остальными плитками', async () => {
    stubFetchWithFixtures({ team: () => json(withOthers(17)), me: meAs('admin') });
    renderAt(<App />, '/?tab=team');
    const tiles = await screen.findByRole('region', { name: 'Итоги по заявкам' });
    expect(within(tiles).getByText('Других обращений открыто').parentElement).toHaveTextContent('17');
    expect(within(tiles).getAllByRole('term')).toHaveLength(6);
  });

  test('нажатие открывает «Заявки» во вкладке обращений (там у каждой вкладки своё число)', async () => {
    stubFetchWithFixtures({ team: () => json(withOthers(3)), me: meAs('admin') });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=team');
    const tiles = await screen.findByRole('region', { name: 'Итоги по заявкам' });
    await user.click(within(tiles).getByRole('button', { name: /Других обращений открыто: 3/ }));
    const params = currentSearch();
    expect(params.get('tab')).toBe('requests');
    expect(params.get('view')).toBe('questions');
    expect(params.has('bucket')).toBe(false);
    expect(await screen.findByRole('list', { name: 'Список обращений' })).toBeInTheDocument();
  });

  test('остальные плитки не стали кнопками', async () => {
    stubFetchWithFixtures({ team: () => json(withOthers(0)), me: meAs('admin') });
    renderAt(<App />, '/?tab=team');
    const tiles = await screen.findByRole('region', { name: 'Итоги по заявкам' });
    expect(within(tiles).getAllByRole('button')).toHaveLength(1);
  });
});
