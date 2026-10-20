import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildGroups } from '../../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { groupsConfig, peopleConfig, takesNew } from '../../reference/config';

afterEach(() => vi.unstubAllGlobals());

const heads = () =>
  within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));
const GROUPS_SHOWN = buildGroups().items.filter((g) => g.status !== 'Закрыта' && takesNew(g)).length;

async function enableColumn(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: /^Вид таблицы/ }));
  await user.click(within(screen.getByRole('dialog', { name: 'Вид таблицы' })).getByRole('checkbox', { name }));
  await user.keyboard('{Escape}');
}

describe('таблицы справочника: состав', () => {
  test('столбцы «В составе» у групп и «Группы» у людей есть в описании, но по умолчанию выключены', () => {
    expect(groupsConfig.columns).toContain('В составе');
    expect(groupsConfig.defaultColumns).not.toContain('В составе');
    expect(peopleConfig.columns).toContain('Группы');
    expect(peopleConfig.defaultColumns).not.toContain('Группы');
  });

  test('в таблице групп «В составе» не видно, пока его не включили в «Виде таблицы»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    expect(heads()).not.toContain('В составе');
    await enableColumn(user, 'В составе');
    await waitFor(() => expect(heads()).toContain('В составе'));
    const col = heads().indexOf('В составе');
    const counts = dataRows().map((r) => within(r).getAllByRole('cell')[col]!.textContent);
    expect(counts.filter((c) => c === '3')).toHaveLength(1);
    expect(counts.filter((c) => c === '2')).toHaveLength(1);
    expect(counts.filter((c) => c === '1')).toHaveLength(1);
    expect(counts.filter((c) => c === '0').length).toBe(GROUPS_SHOWN - 3);
  });

  test('сортировка по «В составе» ставит самый большой состав первым', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&col=' + encodeURIComponent('Код') + '&col=' + encodeURIComponent('Ведущий') + '&col=' + encodeURIComponent('В составе'));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Сортировать по столбцу «В составе»' }));
    await user.click(screen.getByRole('button', { name: 'Сортировать по столбцу «В составе»' }));
    expect(within(dataRows()[0]!).getAllByRole('cell')[1]!).toHaveTextContent('Ольга К.');
    expect(currentSearch().get('sort')).toBe('В составе:desc');
  });

  test('фильтр по числу: «В составе ≥ 2» оставляет две группы', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:ne:Закрыта') + '&f=' + encodeURIComponent('В составе:ge:2'));
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(2);
  });

  test('поиск по таблице групп находит группу по ФИО человека из состава', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по таблице' }), 'Воронцова');
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0]).toHaveTextContent('Ольга К.');
  });

  test('человек в двух группах находит обе', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по таблице' }), 'ефимова');
    expect(dataRows()).toHaveLength(2);
  });

  test('имена из состава не попадают в столбцы и фильтры', async () => {
    expect(groupsConfig.fields.map((f) => f.key).filter((k) => /люди|ФИО/i.test(k))).toEqual([]);
  });

  test('в таблице людей «Группы» включается в «Виде таблицы» и показывает коды через запятую', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    expect(heads()).not.toContain('Группы');
    await enableColumn(user, 'Группы');
    await waitFor(() => expect(heads()).toContain('Группы'));
    const row = dataRows().find((r) => r.textContent?.includes('Дарья Ефимова'))!;
    expect(within(row).getAllByRole('cell')[heads().indexOf('Группы')]).toHaveTextContent('ДГ-0012, ДГ-0008');
  });
});
