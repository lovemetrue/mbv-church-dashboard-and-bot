import type { DeliveryOk, PersonalLoginsState, SettingsStaffView, StaffItem } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsStaff } from '../../fixtures/settings';
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
  ...over,
});

const personal = (over: Partial<PersonalLoginsState> = {}): PersonalLoginsState => ({
  enabled: false,
  canEnable: true,
  activeWithPassword: 2,
  mailConfigured: false,
  ...over,
});

const view = (items: StaffItem[], p: PersonalLoginsState = personal()): SettingsStaffView => ({
  generatedAt: '2026-10-09T09:30:00+03:00',
  items,
  personal: p,
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

const sentOk = (email = 'x@example.org'): DeliveryOk => ({ ok: true, delivery: 'sent', email });
const linkOk = (path = '/set-password?token=abc123', email = 'x@example.org'): DeliveryOk => ({
  ok: true,
  delivery: 'link',
  email,
  path,
});

/** Заполняет форму «Добавить пользователя». */
async function fillAdd(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, fullName: string, email: string) {
  await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), fullName);
  await user.type(within(dialog).getByRole('textbox', { name: 'Почта' }), email);
}

describe('«Пользователи и роли»: список', () => {
  test('статус каждого пользователя написан словами, роль тоже, а не входивший помечен', async () => {
    open(
      view([
        item({ id: 1, fullName: 'Ирина Иванова', status: 'active', role: 'super' }),
        item({ id: 2, fullName: 'Пётр Петров', login: 'p_petrov', status: 'invited', lastLoginAt: null }),
        item({ id: 3, fullName: 'Анна Сидорова', login: 'a_sidorova', status: 'disabled' }),
      ]),
    );
    const active = await rowOf(/Иванова/);
    expect(within(active).getByText('Активен')).toBeInTheDocument();
    expect(within(active).getByText('Полный')).toBeInTheDocument();
    expect(within(active).getByText('p_ivanova')).toBeInTheDocument();
    expect(within(active).getByText('ivanova@example.org')).toBeInTheDocument();
    expect(within(active).getByText(/октября/)).toBeInTheDocument();

    const invited = await rowOf(/Петров/);
    expect(within(invited).getByText('Ждёт пароль')).toBeInTheDocument();
    expect(within(invited).getByText('Обычный')).toBeInTheDocument();
    expect(within(invited).getByText('не входил')).toBeInTheDocument();

    expect(within(await rowOf(/Сидорова/)).getByText('Отключён')).toBeInTheDocument();
  });

  test('у пользователя с действующей ссылкой на пароль есть пометка', async () => {
    open(view([item({ id: 2, fullName: 'Пётр Петров', status: 'invited', hasPendingLink: true })]));
    expect(within(await rowOf(/Петров/)).getByText('Есть действующая ссылка на пароль')).toBeInTheDocument();
  });

  test('действия в строке зависят от статуса: сброс — активному, приглашение — ждущему пароль', async () => {
    open(
      view([
        item({ id: 1, fullName: 'Ирина Иванова', status: 'active' }),
        item({ id: 2, fullName: 'Пётр Петров', login: 'p_petrov', status: 'invited' }),
        item({ id: 3, fullName: 'Анна Сидорова', login: 'a_sidorova', status: 'disabled' }),
      ]),
    );
    const active = await rowOf(/Иванова/);
    expect(within(active).getByRole('button', { name: /^Сбросить пароль/ })).toBeInTheDocument();
    expect(within(active).queryByRole('button', { name: /^Прислать приглашение/ })).not.toBeInTheDocument();
    expect(within(active).getByRole('button', { name: /^Отключить/ })).toBeInTheDocument();

    const invited = await rowOf(/Петров/);
    expect(within(invited).getByRole('button', { name: /^Прислать приглашение снова/ })).toBeInTheDocument();
    expect(within(invited).queryByRole('button', { name: /^Сбросить пароль/ })).not.toBeInTheDocument();

    const off = await rowOf(/Сидорова/);
    expect(within(off).getByRole('button', { name: /^Включить/ })).toBeInTheDocument();
    expect(within(off).queryByRole('button', { name: /^Сбросить пароль/ })).not.toBeInTheDocument();
    expect(within(off).queryByRole('button', { name: /^Прислать приглашение/ })).not.toBeInTheDocument();
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
      within(block).getByText('Сначала заведите пользователей и дождитесь, пока хотя бы один задаст пароль.'),
    ).toBeInTheDocument();
    expect(within(block).getByText('Уже задали пароль: 0')).toBeInTheDocument();
  });

  test('когда включать можно, кнопка доступна и подсказки «сначала заведите» нет', async () => {
    open(view([item({})], personal({ canEnable: true, activeWithPassword: 2 })));
    const block = await screen.findByRole('region', { name: 'Личные входы' });
    expect(within(block).getByRole('button', { name: 'Включить личные входы' })).toBeEnabled();
    expect(within(block).queryByText(/Сначала заведите/)).not.toBeInTheDocument();
    expect(within(block).getByText(/Пока выключено, все входят общими логином и паролем/)).toBeInTheDocument();
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

  test('если почта на сервере не настроена, об этом сказано заметно; если настроена — молчим', async () => {
    open(view([item({})], personal({ mailConfigured: false })));
    expect(await screen.findByText(/Почта на сервере не настроена: ссылки на пароль показываются на экране/)).toBeInTheDocument();
  });

  test('при настроенной почте подсказки про ссылки на экране нет', async () => {
    open(view([item({})], personal({ mailConfigured: true })));
    await screen.findByRole('region', { name: 'Личные входы' });
    expect(screen.queryByText(/Почта на сервере не настроена/)).not.toBeInTheDocument();
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

  test('создание шлёт ФИО, почту и роль, а при отправленном письме пишет «Письмо отправлено на …»', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ ok: true, login: 'm_sokolova' }),
      'settings/staff/create': () => json(sentOk('sokolova@example.org')),
    });
    await fillAdd(user, dialog, '  Мария Соколова ', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('radio', { name: 'Полный' }));
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Письмо отправлено на sokolova@example.org')).toBeInTheDocument();
    const created = posts(fetchMock).filter((p) => p.path === 'settings/staff/create');
    expect(created).toEqual([
      {
        path: 'settings/staff/create',
        body: { fullName: 'Мария Соколова', email: 'sokolova@example.org', role: 'super', login: 'm_sokolova' },
      },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('роль по умолчанию «Обычный», пустой логин в запрос не попадает', async () => {
    const { fetchMock, user, dialog } = await openAdd({
      'settings/staff/suggest': () => json({ error: 'bad_request', message: 'нет' }, 400),
      'settings/staff/create': () => json(sentOk()),
    });
    expect(within(dialog).getByRole('radio', { name: 'Обычный' })).toBeChecked();
    await fillAdd(user, dialog, 'Мария Соколова', 'm@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await waitFor(() =>
      expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toEqual([
        { path: 'settings/staff/create', body: { fullName: 'Мария Соколова', email: 'm@example.org', role: 'admin' } },
      ]),
    );
  });

  test('если письмо не ушло, показывается полная ссылка (адрес страницы + путь), кнопка копирования и предупреждение', async () => {
    const { user, dialog } = await openAdd({
      'settings/staff/create': () => json(linkOk('/set-password?token=abc123', 'sokolova@example.org')),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    const linkDialog = await screen.findByRole('dialog', { name: 'Ссылка для Мария Соколова' });
    const full = `${window.location.origin}/set-password?token=abc123`;
    expect(within(linkDialog).getByLabelText('Ссылка на пароль')).toHaveValue(full);
    expect(
      within(linkDialog).getByText('Ссылка действует ограниченное время и одноразовая; передайте её только этому человеку.'),
    ).toBeInTheDocument();
    expect(within(linkDialog).getByText(/Письмо на sokolova@example.org не отправлено/)).toBeInTheDocument();

    await user.click(within(linkDialog).getByRole('button', { name: 'Копировать' }));
    expect(await navigator.clipboard.readText()).toBe(full);
    expect(await within(linkDialog).findByText('Скопировано')).toBeInTheDocument();
  });

  test('конфликт логина или почты показывает понятный текст, а введённое остаётся в форме', async () => {
    const { user, dialog } = await openAdd({
      'settings/staff/create': () => json({ error: 'conflict', message: 'duplicate key' }, 409),
    });
    await fillAdd(user, dialog, 'Мария Соколова', 'sokolova@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Такой логин или почта уже есть');
    expect(within(dialog).queryByText(/duplicate key/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Почта' })).toHaveValue('sokolova@example.org');
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
    const email = within(dialog).getByRole('textbox', { name: 'Почта' });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(/Укажите почту полностью/)).toBeInTheDocument();
  });

  test('пустое ФИО не отправляется', async () => {
    const { fetchMock, user, dialog } = await openAdd();
    await user.type(within(dialog).getByRole('textbox', { name: 'Почта' }), 'a@example.org');
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
    await act(async () => release(json(sentOk())));
    await act(async () => {});
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/create')).toHaveLength(1);
  });

  test('в окне сказано, что пароль человек задаст сам', async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).getByText('Пароль человек задаст сам по ссылке из письма.')).toBeInTheDocument();
  });
});

describe('«Пользователи и роли»: действия над пользователем', () => {
  test('сброс пароля шлёт id и при отправленном письме пишет об этом', async () => {
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/reset': () => json(sentOk('ivanova@example.org')),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Сбросить пароль/ }));
    expect(await screen.findByText('Письмо отправлено на ivanova@example.org')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/reset', body: { id: 7 } }]);
  });

  test('при сбросе без почты показывается ссылка на новый пароль', async () => {
    open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/reset': () => json(linkOk('/set-password?token=zzz', 'ivanova@example.org')),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Сбросить пароль/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ссылка для Ирина Иванова' });
    expect(within(dialog).getByLabelText('Ссылка на пароль')).toHaveValue(`${window.location.origin}/set-password?token=zzz`);
  });

  test('повторное приглашение шлёт id ждущего пароль', async () => {
    const { fetchMock } = open(view([item({ id: 9, fullName: 'Пётр Петров', status: 'invited' })]), {
      'settings/staff/invite': () => json(sentOk('petrov@example.org')),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Петров/)).getByRole('button', { name: /^Прислать приглашение снова/ }));
    expect(await screen.findByText('Письмо отправлено на petrov@example.org')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/invite', body: { id: 9 } }]);
  });

  test('ошибка сброса показывается заметно, а не теряется', async () => {
    open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/reset': () => json({ error: 'not_found', message: 'нет' }, 404),
    });
    const user = userEvent.setup();
    await user.click(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Сбросить пароль/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Пользователь не найден');
  });

  test('двойное нажатие «Сбросить пароль» отправляет один запрос', async () => {
    let release: (r: Response) => void = () => {};
    const { fetchMock } = open(view([item({ id: 7, fullName: 'Ирина Иванова' })]), {
      'settings/staff/reset': () => new Promise<Response>((ok) => (release = ok)),
    });
    const user = userEvent.setup();
    await user.dblClick(within(await rowOf(/Иванова/)).getByRole('button', { name: /^Сбросить пароль/ }));
    await act(async () => release(json(sentOk())));
    await act(async () => {});
    expect(posts(fetchMock).filter((p) => p.path === 'settings/staff/reset')).toHaveLength(1);
  });

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
    expect(within(dialog).getByRole('textbox', { name: 'Почта' })).toHaveValue('ivanova@example.org');
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
