import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildGroups } from '../../../fixtures/build';
import { getsOf, json, posts } from '../../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { todayIso } from './model';

afterEach(() => vi.unstubAllGlobals());

/** Группа ДГ-0012 (id 1): направленный Артём Лебедев, вручную Дарья Ефимова (есть и в ДГ-0008) и Нина Воронцова. */
async function groupCard(rec = 1) {
  renderAt(<App />, `/?tab=reference&rec=${rec}`);
  return screen.findByRole('dialog', { name: /Карточка группы/ });
}
const rowOf = (card: HTMLElement, fio: string) => within(card).getByText(fio, { selector: 'button' }).closest('li') as HTMLElement;

describe('карточка группы: состав', () => {
  test('заголовок считает всех, а люди разложены на «Направлены через сервис» и «Состоят в группе»', async () => {
    stubFetchWithFixtures();
    const card = await groupCard();
    expect(within(card).getByRole('heading', { name: 'Состав (3)' })).toBeInTheDocument();
    const placed = within(card).getByRole('list', { name: 'Направлены через сервис' });
    const manual = within(card).getByRole('list', { name: 'Состоят в группе' });
    expect(within(placed).getAllByRole('listitem')).toHaveLength(1);
    expect(within(manual).getAllByRole('listitem')).toHaveLength(2);
    expect(within(card).getByText('Состав правится заявкой.')).toBeInTheDocument();
  });

  test('у направленного видны телефон и «направлен 6 октября», а кнопок правки и удаления нет', async () => {
    stubFetchWithFixtures();
    const card = await groupCard();
    const row = rowOf(card, 'Артём Лебедев');
    expect(row).toHaveTextContent('+7 981 003 56 00');
    expect(row).toHaveTextContent('направлен 6 октября');
    expect(within(row).getByRole('button', { name: 'Открыть заявку: Артём Лебедев' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Править/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Убрать из состава/ })).not.toBeInTheDocument();
  });

  test('«Открыть заявку» ведёт на вкладку «Заявки» с этой заявкой', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(within(card).getByRole('button', { name: 'Открыть заявку: Артём Лебедев' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('10');
  });

  test('у внесённого вручную видны «в группе с 1 сентября 2026» и заметка, а без даты строки про дату нет', async () => {
    stubFetchWithFixtures();
    const card = await groupCard();
    const row = rowOf(card, 'Дарья Ефимова');
    expect(row).toHaveTextContent('в группе с 1 сентября 2026');
    expect(row).toHaveTextContent('Ходит с лета');
    expect(within(row).getByRole('button', { name: 'Править в составе: Дарья Ефимова' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Убрать из состава: Дарья Ефимова' })).toBeInTheDocument();
  });

  test('без даты вступления строки «в группе с» нет', async () => {
    stubFetchWithFixtures();
    const card = await groupCard(4);
    expect(rowOf(card, 'Георгий Шмелёв')).not.toHaveTextContent('в группе с');
  });

  test('у человека, который есть и в другой группе, стоит метка с кодами и подсказкой «Проверьте, не дубль ли»', async () => {
    stubFetchWithFixtures();
    const card = await groupCard();
    const row = rowOf(card, 'Дарья Ефимова');
    expect(within(row).getByText('Есть и в: ДГ-0008')).toBeInTheDocument();
    expect(within(row).getByTitle('Проверьте, не дубль ли')).toHaveTextContent('Есть и в: ДГ-0008');
    expect(rowOf(card, 'Нина Воронцова')).not.toHaveTextContent('Есть и в');
  });

  test('имя человека открывает его карточку в «Справочнике → Люди»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(within(card).getByRole('button', { name: 'Дарья Ефимова' }));
    expect(currentSearch().get('ent')).toBe('people');
    expect(currentSearch().get('rec')).toBe('u1');
    expect(await screen.findByRole('dialog', { name: 'Карточка человека: Дарья Ефимова' })).toBeInTheDocument();
  });

  test('пустой состав: «Состав пока не внесён» и кнопка «Добавить человека»', async () => {
    stubFetchWithFixtures();
    const card = await groupCard(3);
    expect(within(card).getByRole('heading', { name: 'Состав (0)' })).toBeInTheDocument();
    expect(within(card).getByText('Состав пока не внесён')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Добавить человека' })).toBeInTheDocument();
  });

  test('у непустого состава кнопка «Добавить человека» тоже есть', async () => {
    stubFetchWithFixtures();
    const card = await groupCard();
    expect(within(card).getByRole('button', { name: 'Добавить человека' })).toBeInTheDocument();
    expect(within(card).queryByText('Состав пока не внесён')).not.toBeInTheDocument();
  });
});

describe('карточка группы: убрать из состава', () => {
  const removeButton = (card: HTMLElement) => within(rowOf(card, 'Нина Воронцова')).getByRole('button', { name: 'Убрать из состава: Нина Воронцова' });

  test('нажатие просит подтверждение с пояснением и до него ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(removeButton(card));
    const dialog = await screen.findByRole('dialog', { name: 'Убрать из состава: Нина Воронцова?' });
    expect(within(dialog).getByText('Человек исчезнет из состава этой группы. Его карточка в справочнике остаётся.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: /^Убрать из состава/ })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждение шлёт пустое тело на members/:id/delete и перечитывает группы и людей', async () => {
    const fetchMock = stubFetchWithFixtures({ 'members/2/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await groupCard();
    await waitFor(() => expect(getsOf(fetchMock, 'people')).toBeGreaterThan(0));
    const before = { groups: getsOf(fetchMock, 'groups'), people: getsOf(fetchMock, 'people') };
    await user.click(removeButton(card));
    await user.click(within(await screen.findByRole('dialog', { name: /^Убрать из состава/ })).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'members/2/delete', body: {} }]));
    await waitFor(() => {
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
    });
  });

  test('после удаления карточка группы остаётся открытой и показывает новый состав', async () => {
    let removed = false;
    const base = buildGroups();
    stubFetchWithFixtures({
      'members/2/delete': () => {
        removed = true;
        return json({ ok: true });
      },
      groups: () => json(removed ? { ...base, items: base.items.map((g) => ({ ...g, members: g.members.filter((m) => m.personKey !== 'p1') })) } : base),
    });
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(removeButton(card));
    await user.click(within(await screen.findByRole('dialog', { name: /^Убрать из состава/ })).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Убрать из состава/ })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /Карточка группы/ })).toBeInTheDocument();
    expect(await within(card).findByRole('heading', { name: 'Состав (2)' })).toBeInTheDocument();
    expect(within(card).queryByText('Нина Воронцова')).not.toBeInTheDocument();
  });

  test('отказ сервера показывается в окне, человек остаётся в составе', async () => {
    stubFetchWithFixtures({ 'members/2/delete': () => json({ error: 'forbidden', message: 'служебный текст' }, 403) });
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(removeButton(card));
    const dialog = await screen.findByRole('dialog', { name: /^Убрать из состава/ });
    await user.click(within(dialog).getByRole('button', { name: 'Убрать' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет прав на это действие с этого входа.');
    expect(within(card).getByText('Нина Воронцова')).toBeInTheDocument();
  });
});

describe('карточка группы: правка записи в составе', () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>, fio = 'Дарья Ефимова') {
    const card = await groupCard();
    await user.click(within(rowOf(card, fio)).getByRole('button', { name: `Править в составе: ${fio}` }));
    return screen.findByRole('dialog', { name: `Правка в составе: ${fio}` });
  }

  test('форма заполнена датой и заметкой, дата не позже сегодняшнего дня, сохранить нечего, пока не изменили', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    const date = within(dialog).getByLabelText('В группе с') as HTMLInputElement;
    expect(date).toHaveValue('2026-09-01');
    expect(date).toHaveAttribute('max', todayIso());
    expect(within(dialog).getByRole('textbox', { name: 'Заметка' })).toHaveValue('Ходит с лета');
    expect(within(dialog).getByText('Имя и телефон правятся в карточке человека.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('уходит только изменённое поле: заметка без даты', async () => {
    const fetchMock = stubFetchWithFixtures({ 'members/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    const note = within(dialog).getByRole('textbox', { name: 'Заметка' });
    await user.clear(note);
    await user.type(note, 'Ведёт детскую');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'members/1/update', body: { fields: { note: 'Ведёт детскую' } } }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка в составе/ })).not.toBeInTheDocument());
  });

  test('очищенная заметка уходит пустой строкой: так сервер её очищает', async () => {
    const fetchMock = stubFetchWithFixtures({ 'members/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.clear(within(dialog).getByRole('textbox', { name: 'Заметка' }));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'members/1/update', body: { fields: { note: '' } } }]));
  });

  test('после сохранения перечитываются группы и люди', async () => {
    const fetchMock = stubFetchWithFixtures({ 'members/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await waitFor(() => expect(getsOf(fetchMock, 'people')).toBeGreaterThan(0));
    const before = { groups: getsOf(fetchMock, 'groups'), people: getsOf(fetchMock, 'people') };
    fireEvent.change(within(dialog).getByLabelText('В группе с'), { target: { value: '2026-09-05' } });
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
    });
  });

  test('двойное нажатие «Сохранить» шлёт один запрос', async () => {
    const fetchMock = stubFetchWithFixtures({
      'members/1/update': () => new Promise<Response>((ok) => setTimeout(() => ok(json({ ok: true })), 30)),
    });
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Заметка' }), '!');
    const save = within(dialog).getByRole('button', { name: 'Сохранить' });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка в составе/ })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(1);
  });
});
