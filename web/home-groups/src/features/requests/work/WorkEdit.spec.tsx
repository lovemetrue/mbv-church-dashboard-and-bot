import { waitFor, within } from '@testing-library/react';
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
  const section = await within(card).findByRole('region', { name: 'Правка данных' });
  return { fetchMock, card, section };
}

const openForm = async (section: HTMLElement) => {
  const user = userEvent.setup();
  await user.click(within(section).getByRole('button', { name: 'Править данные' }));
  return { user, form: within(section).getByRole('form', { name: 'Правка данных заявки' }) };
};

describe('Карточка заявки: «Править данные»', () => {
  test('у закрытой заявки кнопки нет', async () => {
    stubFetchWithFixtures();
    const card = await openCard(10);
    await within(card).findByRole('region', { name: 'Связаться' });
    expect(within(card).queryByRole('button', { name: 'Править данные' })).not.toBeInTheDocument();
  });

  test('форма предзаполнена из заявки и объясняет, что район и возраст влияют на подбор', async () => {
    const r = fixtureItem(5);
    const { section } = await openEdit(5);
    const { form } = await openForm(section);
    expect(within(form).getByRole('textbox', { name: 'ФИО' })).toHaveValue(r.fio);
    expect(within(form).getByRole('textbox', { name: 'Телефон' })).toHaveValue(PHONE);
    expect(within(form).getByRole('textbox', { name: 'Возраст' })).toHaveValue('46 и старше');
    expect(within(form).getByRole('textbox', { name: 'Район и метро' })).toHaveValue('Ладожская');
    expect(within(form).getByRole('textbox', { name: 'Комментарий' })).toHaveValue('Просила звонить после 18:00.');
    expect(within(form).getByText('Район и возраст влияют на подбор — предложение пересчитается')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'ФИО' })).toHaveFocus();
  });

  test('пока ничего не изменено, «Сохранить» отключена', async () => {
    const { section } = await openEdit(5);
    const { user, form } = await openForm(section);
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Район и метро' }), 'а');
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await user.type(within(form).getByRole('textbox', { name: 'Район и метро' }), '{Backspace}');
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('уходит только изменённое поле', async () => {
    const { fetchMock, section } = await openEdit(5);
    const { user, form } = await openForm(section);
    const phone = within(form).getByRole('textbox', { name: 'Телефон' });
    await user.clear(phone);
    await user.type(phone, '8 921 555-00-22');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(section).findByText('Сохранено: телефон.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/5/edit' });
    expect(posts(fetchMock)[0]!.body).toEqual({ phone: '8 921 555-00-22' });
  });

  test('несколько полей — все изменённые и ничего лишнего; очищенное необязательное поле уходит как null', async () => {
    const { fetchMock, section } = await openEdit(5);
    const { user, form } = await openForm(section);
    const fio = within(form).getByRole('textbox', { name: 'ФИО' });
    await user.clear(fio);
    await user.type(fio, '  Новое Имя  ');
    await user.clear(within(form).getByRole('textbox', { name: 'Комментарий' }));
    const age = within(form).getByRole('textbox', { name: 'Возраст' });
    await user.clear(age);
    await user.type(age, '26-35');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(section).findByText('Сохранено: ФИО, возраст, комментарий.')).toBeInTheDocument();
    expect(posts(fetchMock)[0]!.body).toEqual({ fio: 'Новое Имя', age: '26-35', note: null });
  });

  test('в подтверждении нет ни имени, ни телефона: только названия полей', async () => {
    const { section } = await openEdit(5);
    const { user, form } = await openForm(section);
    const phone = within(form).getByRole('textbox', { name: 'Телефон' });
    await user.clear(phone);
    await user.type(phone, '89215550022');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    const notice = await within(section).findByRole('status');
    expect(notice).not.toHaveTextContent('89215550022');
  });

  test('после успеха форма закрывается, а заявки, «Сегодня» и группы перечитываются', async () => {
    const { fetchMock, section } = await openEdit(5);
    const { user, form } = await openForm(section);
    await user.type(within(form).getByRole('textbox', { name: 'Район и метро' }), ' пр.');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await within(section).findByText('Сохранено: район и метро.');
    expect(within(section).queryByRole('form', { name: 'Правка данных заявки' })).not.toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    // и то и другое читалось при открытии карточки, поэтому ждём второе чтение, а не первое
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
  });

  test('bad_request показывается текстом сервера, форма остаётся открытой с введённым', async () => {
    const { section } = await openEdit(5, {
      'requests/5/edit': () => json({ error: 'bad_request', message: 'Телефон не похож на номер.' }, 400),
    });
    const { user, form } = await openForm(section);
    const phone = within(form).getByRole('textbox', { name: 'Телефон' });
    await user.clear(phone);
    await user.type(phone, '12');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Телефон не похож на номер.');
    expect(within(section).getByRole('textbox', { name: 'Телефон' })).toHaveValue('12');
  });

  test('ФИО нельзя очистить: подсказка и «Сохранить» отключена', async () => {
    const { section } = await openEdit(5);
    const { user, form } = await openForm(section);
    await user.clear(within(form).getByRole('textbox', { name: 'ФИО' }));
    expect(within(form).getByText('ФИО не может быть пустым.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('«Отмена» закрывает форму, ничего не отправляя', async () => {
    const { fetchMock, section } = await openEdit(5);
    const { user, form } = await openForm(section);
    await user.type(within(form).getByRole('textbox', { name: 'Район и метро' }), 'x');
    await user.click(within(form).getByRole('button', { name: 'Отмена' }));
    expect(within(section).queryByRole('form', { name: 'Правка данных заявки' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    // повторное открытие снова показывает данные заявки, а не недописанное
    const again = await openForm(section);
    expect(within(again.form).getByRole('textbox', { name: 'Район и метро' })).toHaveValue('Ладожская');
  });

  test('пока запрос идёт, поля и кнопки заблокированы', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, section } = await openEdit(5, {
      'requests/5/edit': async () => {
        await gate;
        return ok();
      },
    });
    const { user, form } = await openForm(section);
    await user.type(within(form).getByRole('textbox', { name: 'Район и метро' }), 'x');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(within(form).getByRole('textbox', { name: 'Район и метро' })).toBeDisabled());
    expect(within(form).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await within(section).findByText('Сохранено: район и метро.');
  });
});
