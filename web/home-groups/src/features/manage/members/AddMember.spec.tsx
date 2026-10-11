import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { getsOf, json, posts } from '../../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { todayIso } from './model';

afterEach(() => vi.unstubAllGlobals());

type User = ReturnType<typeof userEvent.setup>;

/** Окно «Добавить человека»: группа №31 (id 3) без состава, группа №8 (id 4) — с Дарьей Ефимовой и Георгием Шмелёвым. */
async function openDialog(user: User, rec = 3) {
  renderAt(<App />, `/?tab=reference&rec=${rec}`);
  const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
  await user.click(within(card).getByRole('button', { name: 'Добавить человека' }));
  const dialog = await screen.findByRole('dialog', { name: /^Добавить человека в группу/ });
  // Список людей приходит отдельным запросом.
  await within(dialog).findByRole('list', { name: 'Люди из справочника' });
  return dialog;
}
const search = (dialog: HTMLElement) => within(dialog).getByRole('searchbox', { name: 'Найти человека' });
const submit = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Добавить' });
const option = (dialog: HTMLElement, fio: string) => within(dialog).getByRole('button', { name: new RegExp(fio) });

describe('«Добавить человека»: выбор из справочника', () => {
  test('окно названо по группе, а режимов два: «Из справочника» (выбран) и «Новый человек»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(dialog).toHaveAccessibleName('Добавить человека в группу №31');
    expect(within(dialog).getByRole('tab', { name: 'Из справочника' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: 'Новый человек' })).toHaveAttribute('aria-selected', 'false');
  });

  test('в строке человека видны телефон, район, возраст, откуда он и коды групп', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const row = option(dialog, 'Дарья Ефимова');
    expect(row).toHaveTextContent('+7 911 000 40 02');
    expect(row).toHaveTextContent('Приморский');
    expect(row).toHaveTextContent('26–35');
    expect(row).toHaveTextContent('Форма регистрации');
    expect(row).toHaveTextContent('ДГ-0012, ДГ-0008');
  });

  test('поиск по ФИО не различает регистр и «ё»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), 'ШМЕЛЕВ');
    const list = within(dialog).getByRole('list', { name: 'Люди из справочника' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(option(dialog, 'Георгий Шмелёв')).toBeInTheDocument();
  });

  test('поиск по телефону идёт по цифрам, от трёх', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), '+7 (921) 000');
    expect(option(dialog, 'Михаил Громов')).toBeInTheDocument();
    expect(within(within(dialog).getByRole('list', { name: 'Люди из справочника' })).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(search(dialog));
    await user.type(search(dialog), '921');
    expect(within(within(dialog).getByRole('list', { name: 'Люди из справочника' })).getAllByRole('listitem').length).toBeGreaterThan(1);
  });

  test('две цифры телефоном не считаются: слишком много совпадений', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), '92');
    expect(within(dialog).queryByRole('list', { name: 'Люди из справочника' })).not.toBeInTheDocument();
  });

  test('если никого не нашли, подсказка про «+» вместо пустого списка', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), 'Нет такого');
    expect(within(dialog).getByText(/Никого не нашли/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('list', { name: 'Люди из справочника' })).not.toBeInTheDocument();
  });

  test('уже состоящие в группе (направленные и внесённые вручную) неактивны и помечены «Уже в составе»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user, 4);
    for (const fio of ['Дарья Ефимова', 'Георгий Шмелёв']) {
      expect(option(dialog, fio)).toBeDisabled();
      expect(option(dialog, fio)).toHaveTextContent('Уже в составе');
    }
    expect(option(dialog, 'Юлия Орлова')).toBeEnabled();
    expect(option(dialog, 'Юлия Орлова')).not.toHaveTextContent('Уже в составе');
  });

  test('направленный через сервис тоже считается состоящим в группе', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user, 1);
    expect(option(dialog, 'Артём Лебедев')).toBeDisabled();
    expect(option(dialog, 'Артём Лебедев')).toHaveTextContent('Уже в составе');
  });

  test('«Добавить» неактивна, пока никого не выбрали; выбранный отмечен и назван под списком', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(submit(dialog)).toBeDisabled();
    expect(within(dialog).getByText('Выберите человека из списка.')).toBeInTheDocument();
    await user.click(option(dialog, 'Юлия Орлова'));
    expect(option(dialog, 'Юлия Орлова')).toHaveAttribute('aria-pressed', 'true');
    expect(option(dialog, 'Михаил Громов')).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByText('Выбрано: Юлия Орлова')).toBeInTheDocument();
    expect(submit(dialog)).toBeEnabled();
  });

  test('дата вступления не позже сегодняшнего дня', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText('В группе с')).toHaveAttribute('max', todayIso());
  });

  test('на сервер уходит только personKey с датой и заметкой, без newPerson', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u4' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    fireEvent.change(within(dialog).getByLabelText('В группе с'), { target: { value: '2026-09-01' } });
    await user.type(within(dialog).getByRole('textbox', { name: 'Заметка' }), 'пришла с мужем');
    await user.click(submit(dialog));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([
        { path: 'groups/3/members/create', body: { personKey: 'u4', joinedOn: '2026-09-01', note: 'пришла с мужем' } },
      ]),
    );
  });

  test('без даты и заметки в теле только personKey', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u4' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'groups/3/members/create', body: { personKey: 'u4' } }]));
  });

  test('дата из будущего: подсказка, «Добавить» неактивна и ничего не уходит', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    fireEvent.change(within(dialog).getByLabelText('В группе с'), { target: { value: '2999-01-01' } });
    expect(within(dialog).getByText('Дата не может быть в будущем.')).toBeInTheDocument();
    expect(submit(dialog)).toBeDisabled();
    await user.click(submit(dialog));
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('успех: «Добавлен в состав.», группы и люди перечитаны, карточки в справочнике не обещают', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u4' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const before = { groups: getsOf(fetchMock, 'groups'), people: getsOf(fetchMock, 'people') };
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Добавлен в состав.');
    expect(within(dialog).queryByText(/Карточка появилась/)).not.toBeInTheDocument();
    expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
    expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
  });

  test('«Добавить ещё» возвращает к пустому поиску в том же окне', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u4' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), 'Орлова');
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    await user.click(await within(dialog).findByRole('button', { name: 'Добавить ещё' }));
    expect(search(dialog)).toHaveValue('');
    expect(submit(dialog)).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Заметка' })).toHaveValue('');
  });

  test('«Готово» после добавления закрывает окно, карточка группы остаётся', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u4' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    await user.click(await within(dialog).findByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog', { name: /^Добавить человека в группу/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Карточка группы/ })).toBeInTheDocument();
  });

  test('двойное нажатие «Добавить» шлёт один запрос', async () => {
    const fetchMock = stubFetchWithFixtures({
      'groups/3/members/create': () => new Promise<Response>((ok) => setTimeout(() => ok(json({ ok: true, id: 9, personKey: 'u4' })), 30)),
    });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    const add = submit(dialog);
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    await within(dialog).findByRole('status');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('409: «Этот человек уже в составе группы», окно остаётся с выбором', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ error: 'conflict', message: 'служебный текст' }, 409) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Этот человек уже в составе группы');
    expect(option(dialog, 'Юлия Орлова')).toHaveAttribute('aria-pressed', 'true');
    expect(submit(dialog)).toBeEnabled();
  });

  test('400: показывается текст сервера', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ error: 'bad_request', message: 'Заметка длиннее 300 знаков.' }, 400) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Заметка длиннее 300 знаков.');
  });

  test('сеть не отвечает: понятный текст, а не код', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => Promise.reject(new TypeError('fail')) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(option(dialog, 'Юлия Орлова'));
    await user.click(submit(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет связи с сервером');
  });
});

describe('«Добавить человека»: новый человек', () => {
  const fio = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: /^ФИО/ });

  test('вкладка «Новый человек»: поля и «Добавить» неактивна, пока не вписано ФИО', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    for (const name of [/^ФИО/, 'Телефон', 'Возраст', 'Район или место', 'Заметка']) {
      expect(within(dialog).getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(within(dialog).getByLabelText('В группе с')).toHaveAttribute('max', todayIso());
    expect(submit(dialog)).toBeDisabled();
    await user.type(fio(dialog), 'Анна Лебедева');
    expect(submit(dialog)).toBeEnabled();
  });

  test('«+» в строке поиска переносит набранное имя в новую карточку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), 'Анна Лебедева');
    await user.click(within(dialog).getByRole('button', { name: 'Внести нового человека' }));
    expect(within(dialog).getByRole('tab', { name: 'Новый человек' })).toHaveAttribute('aria-selected', 'true');
    expect(fio(dialog)).toHaveValue('Анна Лебедева');
  });

  test('«+» с набранными цифрами переносит их в телефон, а не в ФИО', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.type(search(dialog), '+7 911 555');
    await user.click(within(dialog).getByRole('button', { name: 'Внести нового человека' }));
    expect(fio(dialog)).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'Телефон' })).toHaveValue('+7 911 555');
  });

  test('на сервер уходит newPerson и без personKey, пустые поля опущены', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'p2' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    await user.type(fio(dialog), ' Анна Лебедева ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Телефон' }), '+7 911 111 22 33');
    await user.type(within(dialog).getByRole('textbox', { name: 'Район или место' }), 'Купчино');
    fireEvent.change(within(dialog).getByLabelText('В группе с'), { target: { value: '2026-09-02' } });
    await user.click(submit(dialog));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([
        {
          path: 'groups/3/members/create',
          body: { newPerson: { fio: 'Анна Лебедева', phone: '+7 911 111 22 33', place: 'Купчино' }, joinedOn: '2026-09-02' },
        },
      ]),
    );
  });

  test('после успеха сказано, что карточка появилась в справочнике, и есть «Открыть карточку»', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'p2' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    await user.type(fio(dialog), 'Анна Лебедева');
    await user.click(submit(dialog));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Добавлен в состав. Карточка появилась в справочнике людей.');
    await user.click(within(dialog).getByRole('button', { name: 'Открыть карточку' }));
    expect(currentSearch().get('ent')).toBe('people');
    expect(currentSearch().get('rec')).toBe('p2');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Добавить человека в группу/ })).not.toBeInTheDocument());
  });

  test('после успеха людей перечитано заново: новая карточка уже в списке', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'p2' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const before = getsOf(fetchMock, 'people');
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    await user.type(fio(dialog), 'Анна Лебедева');
    await user.click(submit(dialog));
    await within(dialog).findByRole('status');
    expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before);
  });

  test('«Добавить ещё» после нового человека очищает форму', async () => {
    stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'p2' }) });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    await user.type(fio(dialog), 'Анна Лебедева');
    await user.click(submit(dialog));
    await user.click(await within(dialog).findByRole('button', { name: 'Добавить ещё' }));
    expect(within(dialog).getByRole('tab', { name: 'Новый человек' })).toHaveAttribute('aria-selected', 'true');
    expect(fio(dialog)).toHaveValue('');
    expect(submit(dialog)).toBeDisabled();
  });

  test('дата из будущего не пропускается и у нового человека', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Новый человек' }));
    await user.type(fio(dialog), 'Анна Лебедева');
    fireEvent.change(within(dialog).getByLabelText('В группе с'), { target: { value: '2999-01-01' } });
    expect(within(dialog).getByText('Дата не может быть в будущем.')).toBeInTheDocument();
    expect(submit(dialog)).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});
