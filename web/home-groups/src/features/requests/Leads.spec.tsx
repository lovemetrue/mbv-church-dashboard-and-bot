import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildOthers } from '../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const switcher = () => screen.findByRole('group', { name: 'Режим списка заявок' });
const leadsOpen = buildOthers().filter((o) => o.type === 'lead_group' && o.state === 'open').length;
const othersOpen = buildOthers().filter((o) => o.type !== 'lead_group' && o.state === 'open').length;

describe('«Заявки»: подвкладка «Хотят открыть группу»', () => {
  test('три режима; «хочу открыть группу» вынесены из «Других обращений» и считаются отдельно', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    const sw = await switcher();
    expect(within(sw).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Хотят в группу', `Хотят открыть группу (${leadsOpen})`, `Другие обращения (${othersOpen})`,
    ]);
    await user.click(within(sw).getByRole('button', { name: /^Хотят открыть группу/ }));
    expect(currentSearch().get('view')).toBe('leads');
    const list = await screen.findByRole('list', { name: 'Список обращений' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(leadsOpen);
    expect(list).toHaveTextContent('Юлия Громова');
    // В «Других обращениях» их больше нет.
    await user.click(within(await switcher()).getByRole('button', { name: /^Другие обращения/ }));
    expect(await screen.findByRole('list', { name: 'Список обращений' })).not.toHaveTextContent('Юлия Громова');
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
