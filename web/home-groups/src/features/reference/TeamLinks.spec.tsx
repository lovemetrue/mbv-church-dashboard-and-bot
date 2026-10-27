import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

describe('участник команды — человек из «Людей»', () => {
  test('в карточке координатора — телефон из «Людей» и переход в карточку человека', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=coordinators&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка координатора: Трофимова С\./ });
    expect(card).toHaveTextContent('+7 999 555 01 01');
    await user.click(within(card).getByRole('button', { name: 'Открыть в «Людях»: Трофимова С.' }));
    expect(currentSearch().get('ent')).toBe('people');
    expect(currentSearch().get('rec')).toBe('p101');
  });

  test('в карточке человека из команды — его роли и переход в «Координаторы»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people&rec=p101');
    const card = await screen.findByRole('dialog', { name: /Карточка человека: Трофимова С\./ });
    expect(card).toHaveTextContent('Команда');
    await user.click(within(card).getByRole('button', { name: 'Открыть в «Координаторах»: Трофимова С.' }));
    expect(currentSearch().get('ent')).toBe('coordinators');
    expect(currentSearch().get('rec')).toBe('1');
  });

  test('у человека не из команды строки «Команда» нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Дарья Ефимова/ });
    expect(within(card).queryByRole('button', { name: /Открыть в «Координаторах»/ })).not.toBeInTheDocument();
  });
});
