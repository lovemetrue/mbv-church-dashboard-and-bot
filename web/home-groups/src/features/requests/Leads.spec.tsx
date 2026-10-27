import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildOthers } from '../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const switcher = () => screen.findByRole('group', { name: 'Режим списка заявок' });
const leadsOpen = buildOthers().filter((o) => o.type === 'lead_group' && o.offer !== 'home' && o.state === 'open').length;

describe('«Заявки»: подвкладка «Хотят открыть группу»', () => {
  test('«хотят открыть группу» и «дают дом» — разные вкладки, хотя у бота это одна заявка', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await user.click(within(await switcher()).getByRole('button', { name: /^Хотят открыть группу/ }));
    expect(currentSearch().get('view')).toBe('leads');
    const list = await screen.findByRole('list', { name: 'Список обращений' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(leadsOpen);
    expect(list).toHaveTextContent('Юлия Громова');
    expect(list).not.toHaveTextContent('Татьяна Фёдорова');
    await user.click(within(await switcher()).getByRole('button', { name: /^Дают дом/ }));
    const homes = await screen.findByRole('list', { name: 'Список обращений' });
    expect(homes).toHaveTextContent('Татьяна Фёдорова');
    expect(homes).toHaveTextContent('Даёт дом для группы');
    expect(homes).not.toHaveTextContent('Юлия Громова');
  });

  test('в карточке дома — кто рядом готов вести, в карточке «открыть группу» — дома рядом; переход открывает обращение пары', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&view=homes&req=213');
    let card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    const leaders = within(card).getByRole('region', { name: 'Кто рядом готов вести' });
    expect(leaders).toHaveTextContent('Подходят: 1');
    expect(leaders).toHaveTextContent('Юлия Громова');
    await user.click(within(leaders).getByRole('button', { name: 'Открыть обращение: Юлия Громова' }));
    expect(currentSearch().get('req')).toBe('202');
    // Пара из другой вкладки: список переходит туда, где лежит её обращение.
    await vi.waitFor(() => expect(currentSearch().get('view')).toBe('leads'));
    card = await screen.findByRole('dialog', { name: 'Карточка обращения: Юлия Громова' });
    expect(within(card).getByRole('region', { name: 'Дома рядом' })).toHaveTextContent('Татьяна Фёдорова');
  });

  test('в карточке — кого можно направить в будущую группу: сколько, кто, насколько подходит и кому уже предложена другая', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=leads&req=202');
    const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    const block = within(card).getByRole('region', { name: 'Кого можно направить' });
    expect(block).toHaveTextContent('Можно направить 2 человека');
    expect(block).toHaveTextContent('Ирина Жукова');
    expect(block).toHaveTextContent('уже предложена ДГ-0031');
    expect(block).toHaveTextContent('Галина Мартынова');
    expect(block).toHaveTextContent('86');
    // Переход к заявке человека — в «Хотят в группу».
    await userEvent.setup().click(within(block).getByRole('button', { name: 'Открыть заявку: Ирина Жукова' }));
    expect(currentSearch().get('req')).toBe('3');
    expect(currentSearch().get('view')).toBeNull();
  });
});
