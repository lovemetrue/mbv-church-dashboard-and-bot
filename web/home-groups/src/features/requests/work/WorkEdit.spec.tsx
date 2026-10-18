import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../../test/render';
import { fixtureItem, getsOf, json, ok, openCard, posts, viewWith } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const PHONE = '+7 921 555-00-11';

async function openEdit(id = 5, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetchMock = stubFetchWithFixtures({
    requests: () => json(viewWith(id, { phone: PHONE })),
    [`requests/${id}/edit`]: ok,
    ...overrides,
  });
  const card = await openCard(id);
  const user = userEvent.setup();
  // Карандаш — в шапке, справа от фамилии: искать кнопку в глубине карточки не нужно.
  await user.click(await within(within(card).getByRole('banner')).findByRole('button', { name: /^Править данные: / }));
  const dialog = await screen.findByRole('dialog', { name: /^Правка данных: / });
  return { fetchMock, card, user, dialog };
}

describe('Карточка заявки: карандаш «Править данные» в шапке', () => {
  test('у закрытой заявки карандаша нет', async () => {
    stubFetchWithFixtures();
    const card = await openCard(10);
    await within(card).findByRole('heading', { name: 'Работа с заявкой' });
    expect(within(card).queryByRole('button', { name: /^Править данные/ })).not.toBeInTheDocument();
  });

  test('форма предзаполнена из заявки и содержит все поля человека, включая хобби, профессию и семейное положение', async () => {
    const r = fixtureItem(5);
    const { dialog } = await openEdit(5);
    expect(within(dialog).getByRole('textbox', { name: /^ФИО/ })).toHaveValue(r.fio);
    expect(within(dialog).getByRole('textbox', { name: 'Телефон' })).toHaveValue('+7 921 555 00 11');
    expect(within(dialog).getByRole('textbox', { name: 'Возраст' })).toHaveValue('46 и старше');
    expect(within(dialog).getByRole('textbox', { name: 'Район, метро, ориентир' })).toHaveValue('Ладожская');
    for (const name of ['Улица и дом', 'Удобные день и время', 'Хобби', 'Профессия', 'Семейное положение']) {
      expect(within(dialog).getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий' })).toHaveValue('Просила звонить после 18:00.');
    expect(within(dialog).getByText(/сохранятся и в регистрации, и во всех заявках/)).toBeInTheDocument();
  });

  test('сначала поля человека в том же порядке, что в карточке человека (там проверка по тому же списку), потом поля из таблицы церкви', async () => {
    const labels = (root: HTMLElement) => within(root).getAllByRole('textbox').map((e) => e.getAttribute('aria-label') ?? (e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : null));
    const { dialog } = await openEdit(5);
    const fromRequest = labels(dialog);
    expect(fromRequest.map((l) => l?.replace(/\s*\*$/, ''))).toEqual([
      'ФИО', 'Телефон', 'Возраст', 'Район, метро, ориентир', 'Улица и дом', 'Удобные день и время', 'Хобби', 'Профессия', 'Семейное положение', 'Комментарий',
      'Источник', 'Служение', 'Рекомендованная группа', 'Ходит в группу', 'Контроль посещения', 'Дополнительно',
    ]);
    // Дата — не текстовое поле, поэтому в списке выше её нет.
    expect(within(dialog).getByLabelText('Дата рекомендации')).toHaveAttribute('type', 'date');
  });

  test('поля из таблицы церкви предзаполнены и уходят только изменённые; заметка — без «Дополнительно»', async () => {
    const table = {
      note: 'звонить вечером', source: 'Сайт церкви', ministry: 'Колизей 13:00', extra: 'из таблицы', recommended: null,
      recommendedAt: null, finalGroup: null, attendance: null,
    };
    const { fetchMock, user, dialog } = await openEdit(5, {
      requests: () => json(viewWith(5, { phone: PHONE, note: 'звонить вечером | из таблицы', table })),
    });
    // Показ склеивает заметку и «Дополнительно», а в форме они порознь: иначе сохранение заметки задвоило бы «Дополнительно».
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий' })).toHaveValue('звонить вечером');
    expect(within(dialog).getByRole('textbox', { name: 'Дополнительно' })).toHaveValue('из таблицы');
    expect(within(dialog).getByRole('textbox', { name: 'Служение' })).toHaveValue('Колизей 13:00');
    await user.type(within(dialog).getByRole('textbox', { name: 'Рекомендованная группа' }), 'Иван Петров');
    await user.type(within(dialog).getByLabelText('Дата рекомендации'), '2026-09-01');
    await user.type(within(dialog).getByRole('textbox', { name: 'Контроль посещения' }), 'ходит');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ fields: { recommended: 'Иван Петров', recommendedAt: '2026-09-01', attendance: 'ходит' } });
  });

  test('пока ничего не изменено, «Сохранить» отключена', async () => {
    const { user, dialog } = await openEdit(5);
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Район, метро, ориентир' }), 'а');
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Район, метро, ориентир' }), '{Backspace}');
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('уходят только изменённые поля, включая новые, в обёртке fields', async () => {
    const { fetchMock, user, dialog } = await openEdit(5);
    await user.type(within(dialog).getByRole('textbox', { name: 'Улица и дом' }), 'Коллонтай 5');
    await user.type(within(dialog).getByRole('textbox', { name: 'Удобные день и время' }), 'среда');
    await user.type(within(dialog).getByRole('textbox', { name: 'Хобби' }), 'вязание');
    await user.type(within(dialog).getByRole('textbox', { name: 'Профессия' }), 'врач');
    await user.type(within(dialog).getByRole('textbox', { name: 'Семейное положение' }), 'замужем');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/5/edit' });
    expect(posts(fetchMock)[0]!.body).toEqual({ fields: { address: 'Коллонтай 5', schedule: 'среда', hobby: 'вязание', profession: 'врач', family: 'замужем' } });
  });

  test('после успеха окно закрывается, а заявки, «Сегодня», группы и люди перечитываются', async () => {
    const { fetchMock, user, dialog } = await openEdit(5);
    await user.type(within(dialog).getByRole('textbox', { name: 'Район, метро, ориентир' }), ' пр.');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка данных: / })).not.toBeInTheDocument());
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
  });

  test('bad_request показывается текстом сервера, окно остаётся открытым с введённым', async () => {
    const { user, dialog } = await openEdit(5, {
      'requests/5/edit': () => json({ error: 'bad_request', message: 'Телефон не похож на номер.' }, 400),
    });
    const phone = within(dialog).getByRole('textbox', { name: 'Телефон' });
    await user.clear(phone);
    await user.type(phone, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Телефон не похож на номер.');
    expect(within(dialog).getByRole('textbox', { name: 'Телефон' })).toHaveValue('12');
  });

  test('ФИО нельзя очистить: «Сохранить» отключена', async () => {
    const { user, dialog } = await openEdit(5);
    await user.clear(within(dialog).getByRole('textbox', { name: /^ФИО/ }));
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('«Отмена» закрывает окно, ничего не отправляя', async () => {
    const { fetchMock, user, dialog } = await openEdit(5);
    await user.type(within(dialog).getByRole('textbox', { name: 'Хобби' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: /^Правка данных: / })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});
