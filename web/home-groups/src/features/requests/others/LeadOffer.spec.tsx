import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';

afterEach(() => vi.unstubAllGlobals());

const rows = async () => within(await screen.findByRole('list', { name: 'Список обращений' })).getAllByRole('listitem');

describe('«Хотят открыть группу»: откроют группу или дают дом', () => {
  test('переключатель делит список по ответу человека, выбор живёт в адресе', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&view=leads');
    const offer = await screen.findByRole('group', { name: 'Что предлагает человек' });
    expect(within(offer).getByRole('button', { name: /^Все/ })).toHaveAttribute('aria-pressed', 'true');
    const all = (await rows()).length;

    await user.click(within(offer).getByRole('button', { name: /^Дают дом/ }));
    expect(currentSearch().get('offer')).toBe('home');
    const home = await rows();
    expect(home.length).toBeLessThan(all);
    expect(home.every((r) => r.textContent?.includes('Даёт дом для группы'))).toBe(true);

    await user.click(within(offer).getByRole('button', { name: /^Откроют группу/ }));
    expect((await rows()).every((r) => r.textContent?.includes('Хочет открыть группу'))).toBe(true);
  });

  test('в «Других обращениях» такого переключателя нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=others');
    await screen.findByRole('list', { name: 'Список обращений' });
    expect(screen.queryByRole('group', { name: 'Что предлагает человек' })).not.toBeInTheDocument();
  });
});
