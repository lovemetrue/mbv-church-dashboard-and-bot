import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildPeople, buildRequests } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Перекрёстные ссылки: заявка → человек → его заявки и обращения → группы. */
describe('переходы между заявкой, обращением, человеком и группой', () => {
  test('из карточки заявки — «Карточка человека» в «Людях»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.click(within(card).getByRole('button', { name: 'Открыть в «Людях»: Мария Соколова' }));
    await waitFor(() => expect(currentSearch().get('rec')).toBe('r1'));
    expect(currentSearch().get('ent')).toBe('people');
  });

  test('из карточки человека — все его заявки и обращения, каждое открывается в своём списке', async () => {
    const people = buildPeople();
    stubFetchWithFixtures({
      people: () =>
        json({
          ...people,
          items: people.items.map((p) =>
            p.key === 'u1'
              ? { ...p, requests: [{ id: 204, kind: 'lead' as const, label: 'Хочет открыть группу', state: 'done' as const }, { id: 1, kind: 'join' as const, label: 'Заявка в группу', state: 'open' as const }] }
              : p,
          ),
        }),
    });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    expect(within(card).getByRole('heading', { name: 'Заявки и обращения' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Открыть: Хочет открыть группу №204' }));
    // «Хочу открыть группу» — в своём списке; обращение может быть закрытым, поэтому отбор «Все».
    await waitFor(() => expect(currentSearch().get('req')).toBe('204'));
    expect(currentSearch().get('view')).toBe('leads');
    expect(currentSearch().get('ostate')).toBe('all');
    expect(await screen.findByRole('dialog', { name: /Виктор Лебедев/ })).toBeInTheDocument();
  });

  test('заявка в группу из карточки человека открывается в «Хотят в группу»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people&rec=r1');
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    await user.click(within(card).getByRole('button', { name: 'Открыть: Заявка в группу №1' }));
    await waitFor(() => expect(currentSearch().get('req')).toBe('1'));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('view')).toBeNull();
  });

  test('у закрытого обращения виден итог: что сделано, кем и группа ссылкой', async () => {
    const view = buildRequests();
    stubFetchWithFixtures({
      requests: () =>
        json({
          ...view,
          others: view.others.map((o) =>
            o.id === 204 ? { ...o, outcome: { text: 'Разобрано: внесён в состав группы', by: 'p_ivanova', at: '2026-10-20', groups: [{ id: 1, code: 'ДГ-0012' }] } } : o,
          ),
        }),
    });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&view=leads&ostate=all&req=204');
    const card = await screen.findByRole('dialog', { name: /Виктор Лебедев/ });
    const section = within(card).getByRole('heading', { name: 'Итог' }).parentElement!;
    expect(section).toHaveTextContent('Разобрано: внесён в состав группы');
    expect(section).toHaveTextContent('закрыл(а): p_ivanova');
    // И в строке списка: «обработано» больше не выглядит пустым.
    const row = within(screen.getByRole('list', { name: /Список/ })).getAllByRole('listitem').find((li) => li.textContent?.includes('Виктор Лебедев'))!;
    expect(row).toHaveTextContent('Разобрано: внесён в состав группы · ДГ-0012 · p_ivanova');
    await user.click(within(section).getByRole('button', { name: 'Открыть группу ДГ-0012' }));
    await waitFor(() => expect(currentSearch().get('tab')).toBe('reference'));
    expect(currentSearch().get('rec')).toBe('1');
  });
});
