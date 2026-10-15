import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

describe('вкладка «Группы»', () => {
  test('стоит рядом с «Заявками» и показывает таблицу групп без карты (карта — на «Сегодня»)', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    await user.click(screen.getByRole('tab', { name: 'Группы' }));
    expect(currentSearch().get('tab')).toBe('groups');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(3);
    expect(screen.queryByRole('region', { name: 'Карта групп' })).not.toBeInTheDocument();
  });

  test('карточка группы открывается из вкладки по ссылке rec', async () => {
    stubFetchWithFixtures();
    const g = buildGroups().items[0]!;
    renderAt(<App />, `/?tab=groups&rec=${g.id}`);
    expect(await screen.findByRole('dialog', { name: /Карточка группы/ })).toBeInTheDocument();
  });

  test('значки: у новой группы росток, у группы без людей увядший листочек', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=groups');
    await screen.findByRole('table');
    const items = buildGroups().items;
    expect(items.some((g) => g.isNew)).toBe(true);
    expect(items.some((g) => g.empty)).toBe(true);
    expect((await screen.findAllByRole('img', { name: 'Новая группа' })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('img', { name: 'В группе пока никого нет' })).length).toBeGreaterThan(0);
  });
});
