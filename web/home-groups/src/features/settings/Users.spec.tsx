import type { PersonalLoginsState, SettingsStaffView, StaffItem, TeamAccountItem } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsStaff, SAMPLE_ISSUED } from '../../fixtures/settings';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { UsersSection } from './UsersSection';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
type Overrides = Parameters<typeof stubFetchWithFixtures>[0];

const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));
const posts = (fetchMock: FetchMock) =>
  callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, body: JSON.parse(String(c.init!.body)) as unknown }));

const item = (over: Partial<StaffItem>): StaffItem => ({
  id: 1,
  login: 'p_ivanova',
  fullName: 'Ирина Иванова',
  email: 'ivanova@example.org',
  role: 'admin',
  status: 'active',
  lastLoginAt: '2026-10-08T18:20:00+03:00',
  hasPendingLink: false,
  personKey: null,
  personName: null,
  coordinatorId: null,
  teamRole: null,
  hasPassword: true,
  passwordViewable: true,
  ...over,
});

const member = (over: Partial<TeamAccountItem>): TeamAccountItem => ({
  coordinatorId: 7,
  name: 'Родионов Давид',
  teamRole: 'Распределитель',
  staffId: null,
  login: null,
  hasPassword: false,
  active: true,
  lastLoginAt: null,
  ...over,
});

const personal = (over: Partial<PersonalLoginsState> = {}): PersonalLoginsState => ({
  enabled: false,
  canEnable: true,
  activeWithPassword: 2,
  mailConfigured: false,
  ...over,
});

const view = (items: StaffItem[], p: PersonalLoginsState = personal(), team: TeamAccountItem[] = []): SettingsStaffView => ({
  generatedAt: '2026-10-09T09:30:00+03:00',
  items,
  personal: p,
  team,
});

/** Открывает раздел на заданных данных. Остальные маршруты — как в фикстурах. */
function open(data: SettingsStaffView, overrides: Overrides = {}) {
  const fetchMock = stubFetchWithFixtures({ 'settings/staff': () => json(data), ...overrides });
  renderAt(<UsersSection />, '/?tab=settings&sec=users', makeClient());
  return { fetchMock };
}

const rowOf = async (name: string | RegExp) => {
  const row = await screen.findByRole('row', { name });
  return row;
};

/** Заполняет форму «Добавить пользователя». */
async function fillAdd(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, fullName: string, email = '') {
  await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), fullName);
  if (email) await user.type(within(dialog).getByRole('textbox', { name: EMAIL }), email);
}

const EMAIL = 'Почта (необязательно)';
const issuedOk = (id = 50, login = 'm_sokolova') => ({ ok: true, login, password: SAMPLE_ISSUED, id });

describe('«Пользователи и роли»: один список', () => {
  test('учётная запись и её место в команде — одна строка; участник команды без входа — тоже строка', async () => {
    open(
      view(
        [item({ id: 2, fullName: 'Анна Лебедева', login: 'a_lebedeva', personName: 'Лебедева Анна Игоревна', coordinatorId: 1, teamRole: 'Старший координатор' })],
        personal(),
        [member({ coordinatorId: 1, name: 'Лебедева Анна', staffId: 2, login: 'a_lebedeva', hasPassword: true }), member({})],
      ),
    );
    expect(await screen.findAllByRole('row', { name: /Лебедев/ })).toHaveLength(1);
    const anna = await rowOf(/Лебедева/);
    expect(within(anna).getByText('Карточка: Лебедева Анна Игоревна')).toBeInTheDocument();
    expect(within(anna).getByText('Команда: Старший координатор')).toBeInTheDocument();
    expect(within(anna).getByText('a_lebedeva')).toBeInTheDocument();

    const david = await rowOf(/Родионов/);
    expect(within(david).getByText('Команда: Распределитель')).toBeInTheDocument();
    expect(within(david).getByText('входа нет')).toBeInTheDocument();
    expect(within(david).getByText('появится с первым паролем')).toBeInTheDocument();
    expect(within(david).queryByRole('button', { name: /^Изменить/ })).not.toBeInTheDocument();
  });

  test('уровень входа словами, в том числе «Только чтение»; не привязанная к «Людям» запись помечена, отключённая — тоже', async () => {
    open(
      view([
        item({ id: 1, fullName: 'Ирина Иванова', role: 'readonly' }),
        item({ id: 3, fullName: 'Анна Сидорова', login: 'a_sidorova', status: 'disabled' }),
      ]),
    );
    const reader = await rowOf(/Иванова/);
    expect(within(reader).getByText('Только чтение')).toBeInTheDocument();
    expect(within(reader).getByText('Карточка в «Людях» не привязана')).toBeInTheDocument();
    expect(within(reader).getByText(/октября/)).toBeInTheDocument();
    const off = await rowOf(/Сидорова/);
    expect(within(off).getByText('Отключён')).toBeInTheDocument();
    expect(within(off).getByRole('button', { name: /^Новый пароль/ })).toBeDisabled();
  });

  test('пароль скрыт точками; «глазик» просит его у сервера один раз, показывает и прячет, «Скопировать» кладёт в буфер', async () => {
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/password': () => json({ ok: true, password: SAMPLE_ISSUED }),
    });
    const user = userEvent.setup();
    const row = await rowOf(/Иванова/);
    expect(within(row).getByTestId('user-password')).not.toHaveTextContent('k7mf');
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(row).getByRole('button', { name: 'Показать пароль: Ирина Иванова' }));
    await waitFor(() => expect(within(row).getByTestId('user-password')).toHaveTextContent(SAMPLE_ISSUED));
    expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/password', body: { id: 7 } }]);
    await user.click(within(row).getByRole('button', { name: 'Скопировать пароль: Ирина Иванова' }));
    expect(await navigator.clipboard.readText()).toBe(SAMPLE_ISSUED);
    await user.click(within(row).getByRole('button', { name: 'Скрыть пароль: Ирина Иванова' }));
    expect(within(row).getByTestId('user-password')).not.toHaveTextContent('k7mf');
    await user.click(within(row).getByRole('button', { name: 'Показать пароль: Ирина Иванова' }));
    expect(within(row).getByTestId('user-password')).toHaveTextContent(SAMPLE_ISSUED);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('пароль, заданный раньше, не открыть — так и написано; у кого пароля нет — «Пароля нет»', async () => {
    open(view([item({ id: 1, fullName: 'Ирина Иванова', passwordViewable: false }), item({ id: 2, fullName: 'Пётр Петров', login: 'p_petrov', status: 'invited', hasPassword: false, passwordViewable: false })]));
    const old = await rowOf(/Иванова/);
    expect(within(old).getByText(/Задан раньше — посмотреть нельзя/)).toBeInTheDocument();
    expect(within(old).queryByRole('button', { name: /Показать пароль/ })).not.toBeInTheDocument();
    const none = await rowOf(/Петров/);
    expect(within(none).getByText('Пароля нет')).toBeInTheDocument();
    expect(within(none).getByRole('button', { name: 'Сгенерировать пароль: Пётр Петров' })).toBeInTheDocument();
  });

  test('отказ сервера открыть пароль виден словами', async () => {
    open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/password': () => json({ error: 'not_found', message: 'нет' }, 404),
    });
    const user = userEvent.setup();
    const row = await rowOf(/Иванова/);
    await user.click(within(row).getByRole('button', { name: 'Показать пароль: Ирина Иванова' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent('Пользователь не найден');
  });

  test('участнику команды без входа пароль выдаётся сразу по кнопке: запрос по справочнику, пароль открыт', async () => {
    let data = view([], personal(), [member({})]);
    const { fetchMock } = open(data, {
      'settings/staff': () => json(data),
      'settings/staff/generate-password': () => {
        data = view([item({ id: 9, fullName: 'Родионов Давид', login: 'd_rodionov', coordinatorId: 7, teamRole: 'Распределитель' })], personal(), [member({ staffId: 9, login: 'd_rodionov', hasPassword: true })]);
        return json(issuedOk(9, 'd_rodionov'));
      },
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Родионов/)).getByRole('button', { name: 'Сгенерировать пароль: Родионов Давид' }));
    expect(await screen.findByText(/Пароль для Родионов Давид выдан, логин d_rodionov/)).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/generate-password', body: { coordinatorId: 7 } }]);
    await waitFor(async () => expect(within(await rowOf(/Родионов/)).getByTestId('user-password')).toHaveTextContent(SAMPLE_ISSUED));
  });

  test('новый пароль тому, у кого он уже есть, — только после подтверждения, и уходит по учётной записи', async () => {
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/generate-password': () => json(issuedOk(7, 'p_ivanova')),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: 'Новый пароль: Ирина Иванова' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый пароль для Ирина Иванова' });
    expect(within(dialog).getByText(/Прежний пароль перестанет работать/)).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Сгенерировать' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/generate-password', body: { staffId: 7 } }]));
    expect(within(await rowOf(/Иванова/)).getByTestId('user-password')).toHaveTextContent(SAMPLE_ISSUED);
  });

  test('раздел открывается из «Настроек» и показывает фикстурных пользователей', async () => {
    const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }) });
    renderAt(<App />, '/?tab=settings&sec=users');
    expect(await screen.findByRole('region', { name: 'Личные входы' })).toBeInTheDocument();
    const fixtureFirst = buildSettingsStaff().items[0]!;
    expect(await screen.findByText(fixtureFirst.login)).toBeInTheDocument();
    expect(callsOf(fetchMock).some((c) => c.path === 'settings/staff')).toBe(true);
  });
});

describe('«Пользователи и роли»: личные входы', () => {
  test('кнопка включения отключена, пока включать нельзя, и объясняет, чего не хватает', async () => {
    open(view([], personal({ canEnable: false, activeWithPassword: 0 })));
    const block = await screen.findByRole('region', { name: 'Личные входы' });
    expect(within(block).getByRole('button', { name: 'Включить личные входы' })).toBeDisabled();
    expect(
      within(block).getByText('Сначала выдайте пароль хотя бы одному пользователю.'),
    ).toBeInTheDocument();
    expect(within(block).getByText('С паролем: 0')).toBeInTheDocument();
  });

  test('когда включать можно, кнопка доступна и подсказки «сначала заведите» нет', async () => {
    open(view([item({})], personal({ canEnable: true, activeWithPassword: 2 })));
    const block = await screen.findByRole('region', { name: 'Личные входы' });
    expect(within(block).getByRole('button', { name: 'Включить личные входы' })).toBeEnabled();
    expect(within(block).queryByText(/Сначала выдайте/)).not.toBeInTheDocument();
    expect(within(block).getByText(/Пока выключено, работает и общий вход mbv_admin, и личные логины/)).toBeInTheDocument();
  });

  test('включение требует подтверждения и после него шлёт enabled: true', async () => {
    const { fetchMock } = open(view([item({})]), { 'settings/staff/personal-mode': () => json({ ok: true }) });
    const user = userEvent.setup();
    const block = await screen.findByRole('region', { name: 'Личные входы' });
    await user.click(within(block).getByRole('button', { name: 'Включить личные входы' }));

    const dialog = await screen.findByRole('dialog', { name: 'Включить личные входы?' });
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Включить личные входы' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/personal-mode', body: { enabled: true } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('отмена в окне подтверждения ничего не отправляет', async () => {
    const { fetchMock } = open(view([item({})]));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Включить личные входы' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
  });

  test('выключение доступно, даже когда включить заново было бы нельзя, и шлёт enabled: false', async () => {
    const { fetchMock } = open(view([item({})], personal({ enabled: true, canEnable: false })), {
      'settings/staff/personal-mode': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    const block = await screen.findByRole('region', { name: 'Личные входы' });
    expect(within(block).getByText('Включены')).toBeInTheDocument();
    await user.click(within(block).getByRole('button', { name: 'Выключить личные входы' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выключить личные входы?' });
    await user.click(within(dialog).getByRole('button', { name: 'Выключить личные входы' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/personal-mode', body: { enabled: false } }]));
  });

  test('отказ сервера показывает его текст в самом окне, окно остаётся открытым', async () => {
    open(view([item({})]), {
      'settings/staff/personal-mode': () =>
        json({ error: 'bad_request', message: 'Нет ни одного пользователя с паролем' }, 400),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Включить личные входы' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Включить личные входы' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет ни одного пользователя с паролем');
  });

});

describe('«Пользователи и роли»: добавление', () => {
  async function openAdd(overrides: Overrides = {}, data = view([item({})])) {
    const { fetchMock } = open(data, overrides);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Добавить пользователя' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить пользователя' });
    return { fetchMock, user, dialog };
  }

  test('создание шлёт ФИО, почту, роль и просьбу сразу выдать пароль; после — логин и где пароль', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'm_sokolova' }),
      'settings/staff/create': () => json(issuedOk()),
    });
    await fillAdd(user, dialog, '  Мария Соколова ', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('radio', { name: 'Полный' }));
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Мария Соколова добавлен(а), логин m_sokolova. Пароль открыт в строке — передайте его человеку.')).toBeInTheDocument();
    const created = posts(fetchMock).filter((p) => p.path === 'settings/staff/create');
    expect(created).toEqual([
      {
        path: 'settings/staff/create',
        body: { fullName: 'Мария Соколова', email: 'sokolova@example.org', role: 'super', login: 'm_sokolova', generatePassword: true },
      },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('человек из «Людей» — необязательно: выбранный уходит ключом, а пустое ФИО заполняется его именем', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'd_efimova' }),
      'settings/staff/create': () => json(issuedOk()),
    });
    await user.type(within(dialog).getByRole('searchbox', { name: 'Найти: Человек из «Людей»' }), 'Ефимова');
    await user.click(await within(within(dialog).getByRole('list', { name: 'Подходящие люди: Человек из «Людей»' })).findByRole('button', { name: /Дарья Ефимова/ }));
    expect(within(dialog).getByRole('textbox', { name: 'ФИО' })).toHaveValue('Дарья Ефимова');

    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await screen.findByText(/добавлен\(а\)/);
    expect(posts(fetchMock).find((p) => p.path === 'settings/staff/create')!.body).toMatchObject({ fullName: 'Дарья Ефимова', personKey: 'u1' });
  });

  test('без человека ФИО — просто строка, ключ не уходит', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'stoika' }),
      'settings/staff/create': () => json(issuedOk()),
    });
    await fillAdd(user, dialog, 'Стойка Вход', 'desk@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await screen.findByText(/добавлен\(а\)/);
    expect(posts(fetchMock).find((p) => p.path === 'settings/staff/create')!.body).not.toHaveProperty('personKey');
  });

  test('третий уровень — «Стойка регистрации»: с пояснением, что открыта только страница стойки', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'stoika' }),
      'settings/staff/create': () => json(issuedOk()),
    });
    await fillAdd(user, dialog, 'Стойка Вход', 'desk@example.org');
    const desk = within(dialog).getByRole('radio', { name: 'Стойка регистрации' });
    expect(desk).toHaveAccessibleDescription(/регистрация участника и выдача наборов/);
    await user.click(desk);
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await screen.findByText(/добавлен\(а\)/);
    expect(posts(fetchMock).find((p) => p.path === 'settings/staff/create')?.body).toMatchObject({ role: 'registration' });
  });

  test('роль по умолчанию «Обычный»; без почты и с пустым логином они в запрос не попадают', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ error: 'bad_request', message: 'нет' }, 400),
      'settings/staff/create': () => json(issuedOk()),
    });
    expect(within(dialog).getByRole('radio', { name: 'Обычный' })).toBeChecked();
    await fillAdd(user, dialog, 'Мария Соколова');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await waitFor(() =>
      expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toEqual([
        { path: 'settings/staff/create', body: { fullName: 'Мария Соколова', role: 'admin', generatePassword: true } },
      ]),
    );
  });

  test('конфликт логина или почты показывает понятный текст, а введённое остаётся в форме', async () => {
    const { user, dialog } = await openAdd({
      'settings/staff/create': () => json({ error: 'conflict', message: 'duplicate key' }, 409),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Такой логин или почта уже есть');
    expect(within(dialog).queryByText(/duplicate key/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: EMAIL })).toHaveValue('sokolova@example.org');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('«плохой запрос» показывает текст сервера, потому что он написан для людей', async () => {
    const { user, dialog } = await openAdd({
      'settings/staff/create': () => json({ error: 'bad_request', message: 'Логин может содержать только латиницу' }, 400),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Логин может содержать только латиницу');
  });

  test('обрыв сети и отсутствие доступа различаются в тексте ошибки', async () => {
    const net = await openAdd({ 'settings/staff/create': () => Promise.reject(new TypeError('Failed to fetch')) });
    await fillAdd(net.user, net.dialog, 'Мария Соколова', 'sokolova@example.org');
    await net.user.click(within(net.dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(net.dialog).findByRole('alert')).toHaveTextContent('Нет связи с сервером');
  });

  test('ответ «нет доступа» объясняет, что пользователями управляет только полный вход', async () => {
    const { user, dialog } = await openAdd({
      'settings/staff/create': () => json({ error: 'forbidden', message: 'Нет доступа' }, 403),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('пользователями управляет только полный вход');
  });

  test('невалидная почта не отправляется, а у поля появляется подсказка', async () => {
    const { fetchMock, user, dialog } = await openAdd();
    await fillAdd(user, dialog, 'Мария Соколова', 'не-почта');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toEqual([]);
    const email = within(dialog).getByRole('textbox', { name: EMAIL });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(/Укажите почту полностью/)).toBeInTheDocument();
  });

  test('пустое ФИО не отправляется', async () => {
    const { fetchMock, user, dialog } = await openAdd();

    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toEqual([]);
    expect(within(dialog).getByText('Укажите ФИО.')).toBeInTheDocument();
  });

  test('подсказка логина подставляется после ввода ФИО, когда поле теряет фокус', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'i_petrov' }),
    });
    const login = within(dialog).getByRole('textbox', { name: 'Логин' });
    expect(login).toHaveValue('');
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Иван Петров');
    expect(login).toHaveValue('');
    await user.tab();
    await waitFor(() => expect(login).toHaveValue('i_petrov'));
    expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/suggest', body: { fullName: 'Иван Петров' } }]);
  });

  test('подсказка не затирает логин, который человек уже ввёл сам', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'i_petrov' }),
    });
    await user.type(within(dialog).getByRole('textbox', { name: 'Логин' }), 'ivan');
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Иван Петров');
    await user.tab();
    await act(async () => {});
    expect(within(dialog).getByRole('textbox', { name: 'Логин' })).toHaveValue('ivan');
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/suggest')).toEqual([]);
  });

  test('двойное нажатие «Добавить» отправляет один запрос', async () => {
    let release: (r: Response) => void = () => {};
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/create': () => new Promise<Response>((ok) => (release = ok)),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Добавить' }));
    await act(async () => release(json(issuedOk())));
    await act(async () => {});
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toHaveLength(1);
  });

  test('в окне сказано, что пароль выдастся сразу и откроется в строке', async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).getByText(/Пароль сгенерируется сразу и откроется в строке пользователя/)).toBeInTheDocument();
  });

  test('уровень «Только чтение» — с пояснением, что ничего не меняет', async () => {
    const { fetchMock, user, dialog } = await openAdd({ 'settings/staff/create': () => json(issuedOk()) });
    await fillAdd(user, dialog, 'Мария Соколова');
    const reader = within(dialog).getByRole('radio', { name: 'Только чтение' });
    expect(reader).toHaveAccessibleDescription(/ничего не меняет и подбор не запускает/);
    await user.click(reader);
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await screen.findByText(/добавлен\(а\)/);
    expect(posts(fetchMock).find((p) => p.path === 'settings/staff/create')?.body).toMatchObject({ role: 'readonly' });
  });
});

describe('«Пользователи и роли»: действия над пользователем', () => {
  test('отключение требует подтверждения и шлёт id и active: false', async () => {
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Отключить/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Отключить Ирина Иванова?' });
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/update', body: { id: 7, active: false } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('включение отключённого тоже спрашивает подтверждение и шлёт active: true', async () => {
    const { fetchMock } = open(view([item({ id: 3, fullName: 'Анна Сидорова', status: 'disabled' })]), {
      'settings/staff/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Сидорова/)).getByRole('button', { name: /^Включить/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Включить Анна Сидорова?' });
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/update', body: { id: 3, active: true } }]));
  });

  test('«Изменить» шлёт только то, что поменяли', async () => {
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова', role: 'admin' })]), {
      'settings/staff/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Изменить/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'ФИО' })).toHaveValue('Ирина Иванова');
    expect(within(dialog).getByRole('textbox', { name: EMAIL })).toHaveValue('ivanova@example.org');
    expect(within(dialog).getByRole('radio', { name: 'Обычный' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: 'Полный' }));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/update', body: { id: 7, role: 'super' } }]));
  });

  test('«Изменить» без изменений ничего не отправляет: кнопка «Сохранить» отключена', async () => {
    open(view([item({ id: 7, fullName: 'Ирина Иванова' })]));
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Изменить/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('после действия список перечитывается', async () => {
    let calls = 0;
    open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff': () => {
        calls += 1;
        return json(view([item({ id: 7, fullName: 'Ирина Иванова' })]));
      },
      'settings/staff/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Отключить/ }));
    const dialog = await screen.findByRole('dialog');
    const before = calls;
    await user.click(within(dialog).getByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});
