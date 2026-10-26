import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { groupsWith, json } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

async function groupCard(rec: number, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  stubFetchWithFixtures(overrides);
  renderAt(<App />, `/?tab=reference&rec=${rec}`);
  return screen.findByRole('dialog', { name: /Карточка группы/ });
}

const row = (card: HTMLElement, label: string) => within(card).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('«Справочник → Группы»: ведущий и соведущий, связанные с «Людьми»', () => {
  test('у группы с leaderKey рядом с ведущим пометка «есть в «Людях»» и переход к карточке', async () => {
    // Группа 2 связана с ведущим в фикстурах (leaderKey «u2»).
    const card = await groupCard(2);
    expect(within(card).getByText('есть в «Людях»')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Открыть ведущего в «Людях»' })).toBeInTheDocument();
  });

  test('у группы без связи пометки и перехода нет, а ведущий всё равно виден', async () => {
    const card = await groupCard(1);
    await within(card).findByText('Подтверждена');
    expect(row(card, 'Ведущий')).toHaveTextContent('Ольга К.');
    expect(within(card).queryByText('есть в «Людях»')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Открыть ведущего/ })).not.toBeInTheDocument();
  });

  test('двое ведущих — строка «Ведущие», ФИО одно под другим; связанный соведущий открывается в «Людях»', async () => {
    const user = userEvent.setup();
    const card = await groupCard(1, { groups: () => json(groupsWith(1, { coLeader: 'Нина Воронцова', coLeaderKey: 'p1' })) });
    const value = row(card, 'Ведущие');
    const lines = [...value.firstElementChild!.children].map((l) => l.firstElementChild!.textContent);
    expect(lines).toEqual(['Ольга К.', 'Нина Воронцова']);
    expect(within(card).queryByText('Со-ведущий', { selector: 'dt' })).not.toBeInTheDocument();
    await user.click(within(value).getByRole('button', { name: 'Открыть соведущего в «Людях»' }));
    await waitFor(() => expect(currentSearch().get('rec')).toBe('p1'));
    expect(currentSearch().get('ent')).toBe('people');
  });

  test('«Открыть ведущего» ведёт в «Люди» на карточку по ключу', async () => {
    const user = userEvent.setup();
    const card = await groupCard(1, { groups: () => json(groupsWith(1, { leaderKey: 'u4' })) });
    await user.click(await within(card).findByRole('button', { name: 'Открыть ведущего в «Людях»' }));
    await waitFor(() => expect(currentSearch().get('ent')).toBe('people'));
    expect(currentSearch().get('rec')).toBe('u4');
    expect(currentSearch().get('tab')).toBe('reference');
  });

  test('ключ регистрации в тексте не показывается: человеку он ничего не говорит', async () => {
    const card = await groupCard(2);
    await within(card).findByText('есть в «Людях»');
    expect(card).not.toHaveTextContent('u2');
  });

  test('ответ ведущего боту виден строкой «Ответ ведущего»: время и адрес, которые координатор сверит и перенесёт', async () => {
    const card = await groupCard(1, {
      groups: () => json(groupsWith(1, { leaderAnswer: { schedule: 'среда, 19:00', address: null } })),
    });
    const label = await within(card).findByText('Ответ ведущего боту');
    const row = label.closest('div')!;
    expect(row).toHaveTextContent('Когда: среда, 19:00');
    expect(row).not.toHaveTextContent('Где:');
  });

  test('без ответа ведущего строки нет', async () => {
    const card = await groupCard(1);
    await within(card).findByText('Подтверждена');
    expect(within(card).queryByText('Ответ ведущего боту')).not.toBeInTheDocument();
  });
});
