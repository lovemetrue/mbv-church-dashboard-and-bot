import type { DataChange, Proposal } from '@contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { fixtureItem, json, openCard, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const NO_DETAILS = 'Данные изменились, подробности сохраняются только для новых предложений';
const REVERTED = 'Данные вернулись к прежним значениям — пересчёт не нужен';

const TWO: DataChange[] = [
  { field: 'Район', before: 'Выборгский', after: 'Приморский' },
  { field: 'Улица', before: null, after: 'ул. Шаврова' },
];

/** Предложение заявки с изменившимися данными и заданным «что именно». */
const withChanges = (id: number, changes: DataChange[] | null): Proposal => ({
  ...fixtureItem(id).proposal!,
  saved: true,
  dataChanged: true,
  changes,
});

describe('«Заявки»: что именно изменилось, карточка', () => {
  test('метка «Данные изменились» — кнопка-раскрытие, по умолчанию свёрнута', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, TWO) })) });
    const card = await openCard(1);
    const tag = await within(card).findByRole('button', { name: /Данные изменились/ });
    expect(tag).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByText('Выборгский')).not.toBeInTheDocument();
  });

  test('по клику показывает строки «поле: было → стало», пустое значение — «не указано»', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, TWO) })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    const tag = await within(card).findByRole('button', { name: /Данные изменились/ });
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-expanded', 'true');
    const list = within(card).getByRole('list', { name: 'Что изменилось' });
    const lines = within(list).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      'Район: было Выборгский → стало Приморский',
      'Улица: было не указано → стало ул. Шаврова',
    ]);
    // панель привязана к кнопке
    expect(tag.getAttribute('aria-controls')).toBe(list.closest('[id]')!.id);
  });

  test('повторный клик сворачивает', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, TWO) })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    const tag = await within(card).findByRole('button', { name: /Данные изменились/ });
    await user.click(tag);
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByRole('list', { name: 'Что изменилось' })).not.toBeInTheDocument();
  });

  test('значение с разметкой выводится текстом, а не разметкой', async () => {
    const evil: DataChange[] = [{ field: 'Улица', before: null, after: '<b id="inj">жирно</b>' }];
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, evil) })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(await within(card).findByRole('button', { name: /Данные изменились/ }));
    expect(within(card).getByText('<b id="inj">жирно</b>')).toBeInTheDocument();
    expect(card.querySelector('#inj')).toBeNull();
  });

  test('changes === null: «подробности сохраняются только для новых предложений»', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, null) })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(await within(card).findByRole('button', { name: /Данные изменились/ }));
    expect(within(card).getByText(NO_DETAILS)).toBeInTheDocument();
  });

  test('пустой список: «данные вернулись к прежним значениям», а «Подобрать заново» всё равно доступна', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: withChanges(1, []) })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(await within(card).findByRole('button', { name: /Данные изменились/ }));
    expect(within(card).getByText(REVERTED)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Подобрать заново' })).toBeEnabled();
  });

  test('сервер старой версии без поля changes не ломает карточку: читается как «подробностей нет»', async () => {
    const { changes: _skip, ...legacy } = withChanges(1, null);
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: legacy as Proposal })) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(await within(card).findByRole('button', { name: /Данные изменились/ }));
    expect(within(card).getByText(NO_DETAILS)).toBeInTheDocument();
  });

  test('у заявки без изменившихся данных кнопки раскрытия нет', async () => {
    const card = await openCard(1);
    await within(card).findByText(/Предложена автоматически|Предварительный расчёт/);
    expect(within(card).queryByRole('button', { name: /Данные изменились/ })).not.toBeInTheDocument();
  });
});

describe('«Заявки»: что именно изменилось, список', () => {
  async function openList(id: number, proposal: Proposal) {
    stubFetchWithFixtures({ requests: () => json(viewWith(id, { proposal })) });
    renderAt(<App />, '/?tab=requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    const row = within(list).getByRole('button', { name: fixtureItem(id).fio }).closest('li')!;
    return { list, row };
  }

  test('метка в строке раскрывается и показывает те же строки, не открывая карточку', async () => {
    const { row } = await openList(1, withChanges(1, TWO));
    const user = userEvent.setup();
    const tag = within(row).getByRole('button', { name: /Данные изменились/ });
    expect(tag).toHaveAttribute('aria-expanded', 'false');
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByText('Выборгский')).toBeInTheDocument();
    expect(currentSearch().get('req')).toBeNull();
  });

  test('клик по раскрытому тексту тоже не открывает карточку', async () => {
    const { row } = await openList(1, withChanges(1, null));
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /Данные изменились/ }));
    await user.click(within(row).getByText(NO_DETAILS));
    expect(currentSearch().get('req')).toBeNull();
  });
});

describe('«Заявки»: что именно изменилось, панель подбора', () => {
  const changedIds = () => buildRequests().items.filter((r) => r.proposal?.dataChanged).map((r) => r.id);

  async function openPanel() {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    const block = await screen.findByRole('region', { name: 'Подбор для новых заявок' });
    const n = changedIds().length;
    const button = within(block).getByRole('button', { name: `Данные изменились у ${n} заявок` });
    return { block, button, user: userEvent.setup() };
  }

  test('надпись «Данные изменились у N заявок» — кнопка, открывающая окно со списком этих заявок', async () => {
    const { button, user } = await openPanel();
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Заявки с изменившимися данными' });
    const names = changedIds().map((id) => fixtureItem(id).fio);
    for (const fio of names) expect(within(dialog).getByRole('button', { name: new RegExp(fio) })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThanOrEqual(names.length);
  });

  test('в демо у одной заявки видны два изменённых поля «было → стало», у другой — «подробностей нет»', async () => {
    const { button, user } = await openPanel();
    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(NO_DETAILS)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/→/)).toHaveLength(2);
  });

  test('имя заявки открывает её карточку и закрывает окно', async () => {
    const { button, user } = await openPanel();
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Заявки с изменившимися данными' });
    const id = changedIds()[0]!;
    await user.click(within(dialog).getByRole('button', { name: new RegExp(fixtureItem(id).fio) }));
    expect(screen.queryByRole('dialog', { name: 'Заявки с изменившимися данными' })).not.toBeInTheDocument();
    expect(currentSearch().get('req')).toBe(String(id));
  });

  test('Esc закрывает окно, фокус возвращается на кнопку', async () => {
    const { button, user } = await openPanel();
    await user.click(button);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  test('пустой список изменений у заявки показан как «данные вернулись»', async () => {
    const id = changedIds()[0]!;
    stubFetchWithFixtures({ requests: () => json(viewWith(id, { proposal: withChanges(id, []) })) });
    renderAt(<App />, '/?tab=requests');
    const block = await screen.findByRole('region', { name: 'Подбор для новых заявок' });
    const user = userEvent.setup();
    await user.click(within(block).getByRole('button', { name: /Данные изменились у/ }));
    expect(within(await screen.findByRole('dialog')).getByText(REVERTED)).toBeInTheDocument();
  });
});
