import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { groupsWith } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Обычный вход: удалять нельзя. Полный вход в фикстурах по умолчанию. */
const asAdmin = { me: () => json({ role: 'admin' }) };
const DELETE_TEXT = 'Запись пропадёт из списков. Восстановить её сможет только разработчик.';

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));
const posts = (fetchMock: FetchMock) =>
  callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, body: JSON.parse(String(c.init!.body)) as unknown }));
const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

type User = ReturnType<typeof userEvent.setup>;

/** Карточка группы открыта по адресу; кнопка «Править» есть у любого входа. */
async function groupCard(rec = 1) {
  renderAt(<App />, `/?tab=reference&rec=${rec}`);
  return screen.findByRole('dialog', { name: /Карточка группы/ });
}

/** Окно правки открыто и списки формы уже загружены. */
async function openGroupEdit(user: User, rec = 1) {
  const card = await groupCard(rec);
  await user.click(within(card).getByRole('button', { name: /^Править группу/ }));
  const dialog = await screen.findByRole('dialog', { name: /^Правка группы/ });
  await within(dialog).findByRole('combobox', { name: 'Район' });
  return { card, dialog };
}

const saveButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Сохранить' });

describe('карточки показывают то, что вводят при создании', () => {
  test('карточка группы: телефоны ведущего и соведущего, приём новых как записан, обучение, № в реестре, «проверено», «40 дней»', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(2, { openToNew: 'По требованию', training: 'Да', checked: true, campaignRegistered: true })) });
    const card = await groupCard(2);
    const row = (label: string) => within(card).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(row('Телефон')).toHaveTextContent('+7 921 200 44 77');
    expect(row('Телефон соведущего')).toHaveTextContent('+7 921 000 11 44');
    expect(row('Принимает новых')).toHaveTextContent('По требованию');
    expect(row('Обучение')).toHaveTextContent('Да');
    expect(row('№ в реестре')).toHaveTextContent('27');
    expect(row('Данные проверены')).toHaveTextContent('Да');
    expect(row('«40 дней»')).toHaveTextContent('Зарегистрирован в кампании');
  });

  test('карточка человека: церковь, кто ведущий и как удобнее связаться из регистрации', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    const row = (label: string) => within(card).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(row('Церковь')).toHaveTextContent('МБВ Колизей');
    expect(row('Кто ведущий')).toHaveTextContent('Ольга К.');
    expect(row('Как удобнее связаться')).toHaveTextContent('звонок вечером');
  });
});

describe('правка группы', () => {
  test('форма открывается заполненной текущими значениями группы', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 1);
    expect(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' })).toHaveValue('Ольга К.');
    expect(within(dialog).getByRole('combobox', { name: 'Район' })).toHaveValue('Приморский');
    expect(within(dialog).getByRole('combobox', { name: 'Статус' })).toHaveValue('Функционирует');
    expect(within(dialog).getByRole('textbox', { name: 'Сколько человек' })).toHaveValue('8');
    expect(within(dialog).getByRole('combobox', { name: 'День' })).toHaveValue('Вт');
    expect(within(dialog).getByRole('combobox', { name: 'Координатор' })).toHaveValue('Трофимова С.');
    expect(within(dialog).getByRole('textbox', { name: 'Со-ведущий' })).toHaveValue('');
    expect(within(dialog).getByRole('checkbox', { name: 'Не направлять в эту группу' })).not.toBeChecked();
  });

  test('значение, которого нет в справочнике формы, остаётся выбранным и не считается изменением', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 1);
    // В демо-справочнике нет формата «Смешанная», но у группы он стоит: форма не должна его терять.
    expect(within(dialog).getByRole('combobox', { name: 'Формат группы' })).toHaveValue('Смешанная');
    expect(saveButton(dialog)).toBeDisabled();
  });

  test('«Сохранить» неактивна, пока ничего не изменено, и снова гаснет, если вернуть прежнее значение', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    expect(saveButton(dialog)).toBeDisabled();
    const people = within(dialog).getByRole('textbox', { name: 'Сколько человек' });
    await user.clear(people);
    await user.type(people, '9');
    expect(saveButton(dialog)).toBeEnabled();
    await user.clear(people);
    await user.type(people, '8');
    expect(saveButton(dialog)).toBeDisabled();
  });

  test('отправляются только изменённые поля', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    const leader = within(dialog).getByRole('textbox', { name: 'ФИО ведущего' });
    await user.clear(leader);
    await user.type(leader, '  Ольга Крылова ');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Район' }), 'Выборгский');
    const people = within(dialog).getByRole('textbox', { name: 'Сколько человек' });
    await user.clear(people);
    await user.type(people, '10');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'groups/1/update',
      body: { fields: { leader: 'Ольга Крылова', district: 'Выборгский', people: '10' } },
    });
  });

  test('состав — галочками: отмеченные уходят одной строкой в порядке списка, а значение не из списка можно снять', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/5/update': () => json({ ok: true }), 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 5);
    const box = within(dialog).getByRole('group', { name: 'Состав' });
    await user.click(within(box).getByRole('checkbox', { name: 'Семейная' }));
    await user.click(within(box).getByRole('checkbox', { name: 'Мужская' }));
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: 'groups/5/update', body: { fields: { composition: 'Мужская, Семейная' } } });
  });

  test('у состава не из списка галочка стоит, а её снятие очищает поле', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 1);
    const old = within(within(dialog).getByRole('group', { name: 'Состав' })).getByRole('checkbox', { name: 'Студенты и молодые специалисты' });
    expect(old).toBeChecked();
    expect(saveButton(dialog)).toBeDisabled();
    await user.click(old);
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: 'groups/1/update', body: { fields: { composition: '' } } });
  });

  test('поля старого дашборда — возраст, приём новых, обучение, № в реестре, «проверено», «40 дней» — заполнены и правятся', async () => {
    const fetchMock = stubFetchWithFixtures({
      groups: () => json(groupsWith(1, { campaignRegistered: true, training: 'Нет' })),
      'groups/1/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 1);
    expect(within(dialog).getByRole('combobox', { name: 'Возраст' })).toHaveValue('18–25, 26–35');
    expect(within(dialog).getByRole('textbox', { name: 'Обучение' })).toHaveValue('Нет');
    expect(within(dialog).getByRole('combobox', { name: 'Приём новых' })).toHaveValue('ДА');
    expect(within(dialog).getByRole('textbox', { name: '№ в реестре' })).toHaveValue('12');
    expect(within(dialog).getByRole('checkbox', { name: 'Данные проверены' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: '«40 дней» — зарегистрирован в кампании' })).toBeChecked();
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Приём новых' }), 'По требованию');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Обучение' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Обучение' }), 'Да');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Данные проверены' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '«40 дней» — зарегистрирован в кампании' }));
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'groups/1/update',
      body: { fields: { openToNew: 'По требованию', training: 'Да', checked: '0', campaignRegistered: '0' } },
    });
  });

  test('очищенное необязательное поле уходит пустой строкой, а пустое непротронутое не уходит вовсе', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/2/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 2);
    const coLeader = within(dialog).getByRole('textbox', { name: 'Со-ведущий' });
    expect(coLeader).toHaveValue('Наталья М.');
    await user.clear(coLeader);
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ fields: { coLeader: '' } });
  });

  test('время и дата обратной связи отправляются, только если их вписали', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Время' }), '19:30');
    await user.type(within(dialog).getByLabelText('Дата обратной связи'), '2026-10-09');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ fields: { time: '19:30', feedbackAt: '2026-10-09' } });
  });

  test('флажок «Не направлять»: включение шлёт «1», выключение шлёт «0»', async () => {
    const fetchMock = stubFetchWithFixtures({
      'groups/1/update': () => json({ ok: true }),
      'groups/12/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    const first = await openGroupEdit(user, 1);
    const on = within(first.dialog).getByRole('checkbox', { name: 'Не направлять в эту группу' });
    await user.click(on);
    await user.click(saveButton(first.dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: 'groups/1/update', body: { fields: { doNotRefer: '1' } } });
  });

  test('у группы с флажком «Не направлять» он отмечен, а снятие шлёт «0»', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/12/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 12);
    const box = within(dialog).getByRole('checkbox', { name: 'Не направлять в эту группу' });
    expect(box).toBeChecked();
    await user.click(box);
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: 'groups/12/update', body: { fields: { doNotRefer: '0' } } });
  });

  test('пустое ФИО ведущего не отправляется и объясняется на месте', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    const leader = within(dialog).getByRole('textbox', { name: 'ФИО ведущего' });
    await user.clear(leader);
    expect(within(dialog).getByText('Заполните поле «ФИО ведущего».')).toBeInTheDocument();
    expect(leader).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton(dialog)).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('телефоны ведущего и соведущего открываются с текущим значением; адрес и метро тоже показаны как есть', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user, 2);
    // По этим номерам координаторы обзванивают ведущих: править их вслепую нельзя.
    expect(within(dialog).getByRole('textbox', { name: 'Телефон ведущего' })).toHaveValue('79212004477');
    expect(within(dialog).getByRole('textbox', { name: 'Телефон соведущего' })).toHaveValue('+7 921 000-11-44');
    expect(saveButton(dialog)).toBeDisabled();
  });

  test('адрес и метро показаны как есть, с подсказками про автоподбор', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    // Адрес — обычное поле с текущим значением; подсказка говорит, что подбор идёт по нему, а при пустом — по метро.
    const address = within(dialog).getByRole('textbox', { name: 'Адрес' });
    expect(address).toHaveValue('Комендантский пр.');
    expect(address).toHaveAccessibleDescription(/Автоподбор сопоставляет группу с адресом человека сначала по этому полю/);
    expect(within(dialog).getByRole('textbox', { name: 'Метро или ориентир' })).toHaveAccessibleDescription(/Если адрес пуст/);
    expect(within(dialog).queryByText(/дашборд/i)).not.toBeInTheDocument();
  });

  test('нетронутые телефоны и адрес в запрос не попадают: на сервере остаётся как было', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'x');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const fields = (posts(fetchMock)[0]!.body as { fields: Record<string, string> }).fields;
    expect(fields).toEqual({ comment: expect.stringContaining('x') });
    expect(fields).not.toHaveProperty('phone');
    expect(fields).not.toHaveProperty('coLeaderPhone');
    expect(fields).not.toHaveProperty('address');
  });

  test('в форме правки группы видно и правится поле, по которому идёт автоподбор (метро), и оно уходит как metro', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    const metro = within(dialog).getByRole('textbox', { name: 'Метро или ориентир' });
    await user.clear(metro);
    await user.type(metro, 'Парк Победы');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect((posts(fetchMock)[0]!.body as { fields: Record<string, string> }).fields).toEqual({ metro: 'Парк Победы' });
  });

  test('заполненные поля уходят под именами phone, coLeaderPhone и address, остальное не трогается', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    const phone = within(dialog).getByRole('textbox', { name: 'Телефон ведущего' });
    await user.clear(phone);
    await user.type(phone, ' +7 911 111 22 33 ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Телефон соведущего' }), '+7 922 333 44 55');
    const address = within(dialog).getByRole('textbox', { name: 'Адрес' });
    await user.clear(address);
    await user.type(address, 'ул. Садовая, 5');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'groups/1/update',
      body: { fields: { phone: '+7 911 111 22 33', coLeaderPhone: '+7 922 333 44 55', address: 'ул. Садовая, 5' } },
    });
  });

  test('адрес можно очистить: пустая строка уходит на сервер, чтобы подбор откатился на метро', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    expect(saveButton(dialog)).toBeDisabled();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Адрес' }));
    expect(saveButton(dialog)).toBeEnabled();
    await user.click(saveButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect((posts(fetchMock)[0]!.body as { fields: Record<string, string> }).fields).toEqual({ address: '' });
  });

  test('успех закрывает окно, пишет подтверждение в карточке и перечитывает все списки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const { card, dialog } = await openGroupEdit(user);
    const before = {
      requests: getsOf(fetchMock, 'requests'),
      today: getsOf(fetchMock, 'today'),
      groups: getsOf(fetchMock, 'groups'),
      people: getsOf(fetchMock, 'people'),
      coordinators: getsOf(fetchMock, 'coordinators'),
      meta: getsOf(fetchMock, 'form-meta'),
    };
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'Новый комментарий');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка группы/ })).not.toBeInTheDocument());
    expect(within(card).getByText('Изменения сохранены.')).toHaveAttribute('role', 'status');
    await waitFor(() => {
      expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
      expect(getsOf(fetchMock, 'coordinators')).toBeGreaterThan(before.coordinators);
      expect(getsOf(fetchMock, 'form-meta')).toBeGreaterThan(before.meta);
    });
  });

  test('отказ сервера показывается его словами, окно и введённое остаются', async () => {
    stubFetchWithFixtures({
      'groups/1/update': () => json({ error: 'bad_request', message: 'Число человек — целое от 1 до 200 или пусто.' }, 400),
    });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    const people = within(dialog).getByRole('textbox', { name: 'Сколько человек' });
    await user.clear(people);
    await user.type(people, '999');
    await user.click(saveButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Число человек — целое от 1 до 200 или пусто.');
    expect(people).toHaveValue('999');
    expect(saveButton(dialog)).toBeEnabled();
  });

  test('обрыв связи и нехватка прав объясняются своими словами', async () => {
    let mode: 'network' | 'forbidden' = 'network';
    stubFetchWithFixtures({
      'groups/1/update': () => {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        return json({ error: 'forbidden', message: 'служебный текст' }, 403);
      },
    });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'x');
    await user.click(saveButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Ничего не изменилось, попробуйте ещё раз.');
    mode = 'forbidden';
    await user.click(saveButton(dialog));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Нет прав на это действие с этого входа.'));
  });

  test('двойное нажатие шлёт один запрос, а кнопки на время запроса заблокированы', async () => {
    let release: () => void = () => {};
    const fetchMock = stubFetchWithFixtures({
      'groups/1/update': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true }));
        }),
    });
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'x');
    // Два нажатия в одном такте: React ещё не успел отключить кнопку, защита должна быть в самом запросе.
    const save = saveButton(dialog);
    act(() => {
      save.click();
      save.click();
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка группы/ })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('«Отмена» закрывает окно, ничего не отправив', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const { dialog } = await openGroupEdit(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: /^Правка группы/ })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

describe('удаление группы', () => {
  test('обычному входу кнопки «Удалить» нет, а «Править» есть', async () => {
    stubFetchWithFixtures(asAdmin);
    const card = await groupCard();
    expect(within(card).getByRole('button', { name: /^Править группу/ })).toBeInTheDocument();
    // Роль приходит отдельным запросом: ждём, пока он точно отработал, и только потом проверяем отсутствие.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Править группу/ })).toBeEnabled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(card).queryByRole('button', { name: /^Удалить группу/ })).not.toBeInTheDocument();
  });

  test('полному входу кнопка видна; удаление просит подтверждение и до него ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить группу/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить группу/ });
    expect(within(dialog).getByText(DELETE_TEXT)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: /^Удалить группу/ })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждение шлёт пустое тело, закрывает карточку и перечитывает списки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить группу/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить группу/ });
    const before = { groups: getsOf(fetchMock, 'groups'), today: getsOf(fetchMock, 'today'), people: getsOf(fetchMock, 'people') };
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(currentSearch().has('rec')).toBe(false));
    expect(posts(fetchMock)).toEqual([{ path: 'groups/1/delete', body: {} }]);
    expect(screen.queryByRole('dialog', { name: /^Удалить группу/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
    });
  });

  test('отказ сервера показывается в окне, карточка остаётся', async () => {
    stubFetchWithFixtures({ 'groups/1/delete': () => json({ error: 'forbidden', message: 'нужен полный вход' }, 403) });
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить группу/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить группу/ });
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет прав на это действие с этого входа.');
    expect(currentSearch().get('rec')).toBe('1');
    expect(screen.getByRole('dialog', { name: /Карточка группы/ })).toBeInTheDocument();
  });

  test('двойное нажатие «Удалить» шлёт один запрос', async () => {
    let release: () => void = () => {};
    const fetchMock = stubFetchWithFixtures({
      'groups/1/delete': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true }));
        }),
    });
    const user = userEvent.setup();
    const card = await groupCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить группу/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить группу/ });
    const confirm = within(dialog).getByRole('button', { name: 'Удалить' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Удаляем…' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(currentSearch().has('rec')).toBe(false));
    expect(posts(fetchMock)).toHaveLength(1);
  });
});

async function coordinatorCard(rec = 1) {
  renderAt(<App />, `/?tab=reference&ent=coordinators&rec=${rec}`);
  return screen.findByRole('dialog', { name: /Карточка координатора/ });
}

describe('координаторы: правка и удаление', () => {
  test('«Править» открывает форму с ФИО и ролью, заполненную текущими значениями', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await coordinatorCard();
    await user.click(within(card).getByRole('button', { name: /^Править координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка координатора/ });
    expect(within(dialog).getByRole('textbox', { name: 'ФИО' })).toHaveValue('Трофимова С.');
    expect(within(dialog).getByRole('textbox', { name: 'Роль' })).toHaveValue('Координатор');
    expect(saveButton(dialog)).toBeDisabled();
  });

  test('отправляется только изменённое поле; после успеха перечитываются координаторы, группы и справочники форм', async () => {
    const fetchMock = stubFetchWithFixtures({ 'coordinators/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await coordinatorCard();
    await user.click(within(card).getByRole('button', { name: /^Править координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка координатора/ });
    const before = { coordinators: getsOf(fetchMock, 'coordinators'), groups: getsOf(fetchMock, 'groups') };
    const role = within(dialog).getByRole('textbox', { name: 'Роль' });
    await user.clear(role);
    await user.type(role, 'Старший координатор');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка координатора/ })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toEqual([{ path: 'coordinators/1/update', body: { fields: { role: 'Старший координатор' } } }]);
    expect(within(card).getByText('Изменения сохранены.')).toHaveAttribute('role', 'status');
    await waitFor(() => {
      expect(getsOf(fetchMock, 'coordinators')).toBeGreaterThan(before.coordinators);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
    });
  });

  test('пустое ФИО не отправляется', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await coordinatorCard();
    await user.click(within(card).getByRole('button', { name: /^Править координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка координатора/ });
    await user.clear(within(dialog).getByRole('textbox', { name: 'ФИО' }));
    expect(within(dialog).getByText('Заполните поле «ФИО».')).toBeInTheDocument();
    expect(saveButton(dialog)).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('отказ сервера показывается его словами', async () => {
    stubFetchWithFixtures({ 'coordinators/1/update': () => json({ error: 'bad_request', message: 'Укажите роль.' }, 400) });
    const user = userEvent.setup();
    const card = await coordinatorCard();
    await user.click(within(card).getByRole('button', { name: /^Править координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка координатора/ });
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'а');
    await user.click(saveButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Укажите роль.');
  });

  test('после переименования справочник форм устаревает: при следующем открытии формы он читается заново', async () => {
    const fetchMock = stubFetchWithFixtures({ 'coordinators/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    // Справочник форм загружается при первом открытии формы «Группа».
    renderAt(<App />, '/?tab=reference');
    await user.click(await screen.findByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Группа' }));
    const create = await screen.findByRole('dialog', { name: 'Новая группа' });
    await within(create).findByRole('combobox', { name: 'Район' });
    await user.click(within(create).getByRole('button', { name: 'Отмена' }));
    expect(getsOf(fetchMock, 'form-meta')).toBe(1);

    await user.click(screen.getByRole('button', { name: /^Координаторы/ }));
    await user.click(await screen.findByRole('row', { name: /Трофимова С\./ }));
    const card = await screen.findByRole('dialog', { name: /Карточка координатора/ });
    await user.click(within(card).getByRole('button', { name: /^Править координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка координатора/ });
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'а');
    await user.click(saveButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Правка координатора/ })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Группа' }));
    await within(await screen.findByRole('dialog', { name: 'Новая группа' })).findByRole('combobox', { name: 'Район' });
    await waitFor(() => expect(getsOf(fetchMock, 'form-meta')).toBe(2));
  });

  test('обычному входу кнопки «Удалить» нет', async () => {
    stubFetchWithFixtures(asAdmin);
    const card = await coordinatorCard();
    expect(within(card).getByRole('button', { name: /^Править координатора/ })).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(card).queryByRole('button', { name: /^Удалить координатора/ })).not.toBeInTheDocument();
  });

  test('удаление просит подтверждение, шлёт пустое тело и закрывает карточку', async () => {
    const fetchMock = stubFetchWithFixtures({ 'coordinators/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await coordinatorCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить координатора/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить координатора/ });
    expect(within(dialog).getByText(DELETE_TEXT)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    const before = getsOf(fetchMock, 'coordinators');
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(currentSearch().has('rec')).toBe(false));
    expect(posts(fetchMock)).toEqual([{ path: 'coordinators/1/delete', body: {} }]);
    await waitFor(() => expect(getsOf(fetchMock, 'coordinators')).toBeGreaterThan(before));
  });
});

describe('«+ Создать» → «Координатор»', () => {
  async function openCreate(user: User) {
    renderAt(<App />, '/?tab=reference&ent=coordinators');
    await user.click(await screen.findByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Координатор' }));
    return screen.findByRole('dialog', { name: 'Новый координатор' });
  }

  test('форма просит ФИО и роль и не отправляется пустой', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', { name: 'Добавить координатора' }));
    expect(within(dialog).getByText('Заполните поле «ФИО».')).toBeInTheDocument();
    expect(within(dialog).getByText('Заполните поле «Роль».')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('отправка шлёт ФИО и роль, показывает подтверждение и перечитывает координаторов', async () => {
    const fetchMock = stubFetchWithFixtures({ 'coordinators/create': () => json({ ok: true, id: 5 }) });
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    const before = getsOf(fetchMock, 'coordinators');
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), '  Иванова Е. ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Роль' }), 'Координатор');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить координатора' }));
    const notice = await screen.findByRole('status', { name: 'Координатор добавлен' });
    expect(posts(fetchMock)).toEqual([{ path: 'coordinators/create', body: { fields: { name: 'Иванова Е.', role: 'Координатор' } } }]);
    await waitFor(() => expect(getsOf(fetchMock, 'coordinators')).toBeGreaterThan(before));
    await user.click(within(notice).getByRole('button', { name: 'Открыть' }));
    expect(currentSearch().get('tab')).toBe('reference');
    expect(currentSearch().get('ent')).toBe('coordinators');
    expect(currentSearch().get('rec')).toBe('5');
  });

  test('отказ сервера показывается его словами', async () => {
    stubFetchWithFixtures({ 'coordinators/create': () => json({ error: 'bad_request', message: 'Укажите роль.' }, 400) });
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Иванова Е.');
    await user.type(within(dialog).getByRole('textbox', { name: 'Роль' }), 'К');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить координатора' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Укажите роль.');
  });

  test('после создания справочник форм устаревает и читается заново при следующем открытии формы', async () => {
    const fetchMock = stubFetchWithFixtures({ 'coordinators/create': () => json({ ok: true, id: 5 }) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await user.click(await screen.findByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Группа' }));
    const group = await screen.findByRole('dialog', { name: 'Новая группа' });
    await within(group).findByRole('combobox', { name: 'Район' });
    await user.click(within(group).getByRole('button', { name: 'Отмена' }));
    expect(getsOf(fetchMock, 'form-meta')).toBe(1);

    await user.click(screen.getByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Координатор' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый координатор' });
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Иванова Е.');
    await user.type(within(dialog).getByRole('textbox', { name: 'Роль' }), 'Координатор');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить координатора' }));
    await screen.findByRole('status', { name: 'Координатор добавлен' });

    await user.click(screen.getByRole('button', { name: '+ Создать' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Группа' }));
    await within(await screen.findByRole('dialog', { name: 'Новая группа' })).findByRole('combobox', { name: 'Район' });
    await waitFor(() => expect(getsOf(fetchMock, 'form-meta')).toBe(2));
  });
});

async function requestCard(id = 1) {
  renderAt(<App />, `/?tab=requests&req=${id}`);
  return screen.findByRole('dialog', { name: /Карточка заявки/ });
}

describe('удаление заявки', () => {
  test('обычному входу кнопки «Удалить заявку» нет', async () => {
    stubFetchWithFixtures(asAdmin);
    const card = await requestCard();
    await within(card).findByRole('button', { name: /^Править данные: / });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(card).queryByRole('button', { name: /^Удалить заявку/ })).not.toBeInTheDocument();
    // И пустого раздела под журналом нет: он оставил бы в карточке голую линию.
    const sections = card.querySelectorAll('section');
    expect(sections[sections.length - 1]).toHaveTextContent('Журнал');
  });

  test('полному входу кнопка видна внизу карточки; подтверждение шлёт запрос, закрывает карточку и перечитывает списки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await requestCard();
    const button = await within(card).findByRole('button', { name: /^Удалить заявку/ });
    // Кнопка в самом конце карточки: после журнала, чтобы не нажимать случайно.
    const log = within(card).getByText('Журнал');
    expect(log.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: /^Удалить заявку/ });
    expect(within(dialog).getByText(DELETE_TEXT)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    // На вкладке «Заявки» читаются заявки, «Сегодня» (счётчики шапки) и группы (карточка): их и ждём заново.
    const before = { requests: getsOf(fetchMock, 'requests'), today: getsOf(fetchMock, 'today'), groups: getsOf(fetchMock, 'groups') };
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(currentSearch().has('req')).toBe(false));
    expect(posts(fetchMock)).toEqual([{ path: 'requests/1/delete', body: {} }]);
    await waitFor(() => {
      expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
    });
  });

  test('«Отмена» ничего не отправляет, а отказ сервера показывается в окне', async () => {
    let fail = false;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/delete': () => (fail ? json({ error: 'not_found', message: 'Заявка не найдена.' }, 404) : json({ ok: true })),
    });
    const user = userEvent.setup();
    const card = await requestCard();
    await user.click(await within(card).findByRole('button', { name: /^Удалить заявку/ }));
    let dialog = await screen.findByRole('dialog', { name: /^Удалить заявку/ });
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(posts(fetchMock)).toHaveLength(0);

    fail = true;
    await user.click(within(card).getByRole('button', { name: /^Удалить заявку/ }));
    dialog = await screen.findByRole('dialog', { name: /^Удалить заявку/ });
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Записи уже нет в списке. Обновите страницу.');
    expect(currentSearch().get('req')).toBe('1');
  });
});
