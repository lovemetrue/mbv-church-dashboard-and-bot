import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures, currentSearch } from '../../test/render';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const meOf = (_unused: string | null, role: 'admin' | 'super' = 'admin') => () => json({ role });

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));
const posts = (fetchMock: FetchMock) =>
  callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, body: JSON.parse(String(c.init!.body)) as { fields: Record<string, string> } }));
const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

/**
 * Меню живёт в шапке и работает на любой вкладке. Тесты открывают «Справочник»: там одновременно
 * подписаны на данные «группы», «люди» и «координаторы», а вместе с шапкой и вкладками — на «Сегодня» и «Заявки»,
 * поэтому видно, что после создания перечитываются все списки.
 */
const REFERENCE = '/?tab=reference';

const createButton = () => screen.getByRole('button', { name: '+ Создать' });

/** Открывает меню «Создать» и ждёт, пока в нём появится пункт «Участник»: значит, /me уже ответил. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(createButton());
  const menu = screen.getByRole('menu', { name: 'Что создать' });
  await within(menu).findByRole('menuitem', { name: /Участник/ });
  return menu;
}

async function openForm(user: ReturnType<typeof userEvent.setup>, item: 'Заявка' | 'Группа') {
  const menu = await openMenu(user);
  await user.click(within(menu).getByRole('menuitem', { name: item }));
  return screen.findByRole('dialog', { name: item === 'Заявка' ? 'Новая заявка' : 'Новая группа' });
}

/** Окно открыто и списки формы уже загружены. */
async function ready(dialog: HTMLElement) {
  await within(dialog).findByRole('textbox', { name: /^(ФИО|ФИО ведущего)$/ });
  return dialog;
}

describe('«+ Создать»: меню', () => {
  test('кнопка «Создать» открывает меню с четырьмя пунктами', async () => {
    stubFetchWithFixtures({ me: meOf('https://old.example.org') });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const button = createButton();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Что создать' });
    await within(menu).findByRole('menuitem', { name: /Участник/ });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Заявка',
      'Группа',
      'Координатор',
      expect.stringContaining('Участник (регистрация)'),
    ]);
  });

  test('Esc закрывает меню и возвращает фокус на кнопку', async () => {
    stubFetchWithFixtures({ me: meOf(null) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    await openMenu(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(createButton()).toHaveFocus();
    expect(createButton()).toHaveAttribute('aria-expanded', 'false');
  });

  test('стрелки переходят по пунктам по кругу, а клик вне меню его закрывает', async () => {
    stubFetchWithFixtures({ me: meOf('https://old.example.org') });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const menu = await openMenu(user);
    const [request, group, coordinator, member] = within(menu).getAllByRole('menuitem');
    expect(request).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(group).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(coordinator).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(member).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(request).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(member).toHaveFocus();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('«+ Создать»: заявка', () => {
  test('форма заявки не отправляется без ФИО и говорит об этом', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    const field = within(dialog).getByRole('textbox', { name: 'ФИО' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Заполните поле «ФИО».')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('отправка шлёт только заполненные поля: пустые не уходят, значения по умолчанию на месте', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00'));
    const fetchMock = stubFetchWithFixtures({
      me: meOf(null),
      'requests/create': () => json({ ok: true, id: 101 }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), '  Мария Соколова ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Телефон' }), '+7 911 124 20 15');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Возраст' }), '25-40');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'requests/create',
      body: {
        fields: {
          fio: 'Мария Соколова',
          type: 'join_group',
          status: 'Новая',
          phone: '+7 911 124 20 15',
          age: '25-40',
          requestedAt: '2026-10-09',
          source: 'Дашборд',
        },
      },
    });
  });

  test('улица и дом, удобные дни галочками и время суток, хобби, профессия и семья уходят на сервер', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'requests/create': () => json({ ok: true, id: 101 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.type(within(dialog).getByRole('textbox', { name: 'Улица и дом' }), 'Савушкина 5');
    const days = within(dialog).getByRole('group', { name: 'Удобные дни' });
    expect(within(days).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    await user.click(within(days).getByRole('checkbox', { name: 'Сб' }));
    await user.click(within(days).getByRole('checkbox', { name: 'Вт' }));
    const time = within(dialog).getByRole('combobox', { name: 'Удобное время' });
    expect(within(time).getAllByRole('option').map((o) => o.textContent)).toEqual(['любое', 'Утро', 'День', 'Вечер']);
    await user.selectOptions(time, 'Утро');
    await user.type(within(dialog).getByRole('textbox', { name: 'Хобби' }), 'хор');
    await user.type(within(dialog).getByRole('textbox', { name: 'Профессия' }), 'врач');
    await user.type(within(dialog).getByRole('textbox', { name: 'Семейное положение' }), 'замужем');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toMatchObject({
      address: 'Савушкина 5', days: 'вт, сб', time: 'утро', hobby: 'хор', profession: 'врач', family: 'замужем',
    });
  });

  test('под «О чём заявка» подсказка: форма — для обращений без регистрации, регистрация заводит заявку сама', async () => {
    stubFetchWithFixtures({ me: meOf(null) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    const type = within(dialog).getByRole('combobox', { name: 'О чём заявка' });
    expect(type).toHaveAccessibleDescription(/Для обращений без регистрации/);
    expect(type).toHaveAccessibleDescription(/«Участник \(регистрация\)»/);
  });

  test('«Домашняя группа» есть только у исполненной заявки, а текстового «Ходит в группу» нет: поле о группе одно', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'requests/create': () => json({ ok: true, id: 103 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    expect(within(dialog).queryByRole('combobox', { name: 'Домашняя группа' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Ходит в группу' })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Статус' }), 'Исполнена');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Домашняя группа' }), 'Андрей М. · ДГ-0002');
    // Вернули статус — выбранная группа не уходит: у открытой заявки группу выбирает подбор.
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Статус' }), 'Новая');
    expect(within(dialog).queryByRole('combobox', { name: 'Домашняя группа' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).not.toHaveProperty('groupId');
  });

  test('поля старого дашборда: домашняя и рекомендованная группа — из списка, служение, посещение, причина, «Дополнительно»', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'requests/create': () => json({ ok: true, id: 102 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Статус' }), 'Исполнена');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Домашняя группа' }), 'Андрей М. · ДГ-0002');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Рекомендованная группа' }), 'Ольга К.');
    await user.type(within(dialog).getByLabelText('Дата рекомендации'), '2026-09-01');
    await user.type(within(dialog).getByRole('textbox', { name: 'Служение' }), 'Колизей 13:00');
    await user.type(within(dialog).getByRole('textbox', { name: 'Контроль посещения' }), 'ходит');
    await user.type(within(dialog).getByRole('textbox', { name: 'Причина аннулирования' }), 'нет');
    await user.type(within(dialog).getByRole('textbox', { name: 'Дополнительно' }), 'из таблицы');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toMatchObject({
      fio: 'Мария Соколова', status: 'Исполнена', groupId: '2', recommended: 'Ольга К.', recommendedAt: '2026-09-01',
      ministry: 'Колизей 13:00', attendance: 'ходит', cancelReason: 'нет', extra: 'из таблицы',
    });
  });

  test('успех закрывает окно, перечитывает данные и показывает «Заявка №N создана» с кнопкой «Открыть»', async () => {
    const fetchMock = stubFetchWithFixtures({
      me: meOf(null),
      'requests/create': () => json({ ok: true, id: 101 }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    await screen.findByText(/Распределено/);
    const before = {
      requests: getsOf(fetchMock, 'requests'),
      today: getsOf(fetchMock, 'today'),
      groups: getsOf(fetchMock, 'groups'),
      people: getsOf(fetchMock, 'people'),
    };
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));

    const notice = await screen.findByRole('status', { name: 'Заявка №101 создана' });
    expect(screen.queryByRole('dialog', { name: 'Новая заявка' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
    });

    await user.click(within(notice).getByRole('button', { name: 'Открыть' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('101');
    expect(screen.queryByRole('status', { name: 'Заявка №101 создана' })).not.toBeInTheDocument();
  });

  test('отказ сервера показывается его текстом, окно и введённое остаются', async () => {
    stubFetchWithFixtures({
      me: meOf(null),
      'requests/create': () =>
        json({ error: 'bad_request', message: 'Дата заявки — в виде 2026-08-27.' }, 400),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Дата заявки — в виде 2026-08-27.');
    expect(within(dialog).getByRole('textbox', { name: 'ФИО' })).toHaveValue('Мария Соколова');
    expect(within(dialog).getByRole('button', { name: 'Создать заявку' })).toBeEnabled();
  });

  test('нет прав и обрыв связи объясняются своими словами', async () => {
    let mode: 'forbidden' | 'network' = 'forbidden';
    stubFetchWithFixtures({
      me: meOf(null),
      'requests/create': () => {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        return json({ error: 'forbidden', message: 'служебный текст' }, 403);
      },
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет прав создавать записи с этого входа.');
    mode = 'network';
    await user.click(within(dialog).getByRole('button', { name: 'Создать заявку' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Нет связи с сервером'));
  });

  test('двойное нажатие шлёт один запрос, а кнопки на время запроса заблокированы', async () => {
    let release: () => void = () => {};
    const fetchMock = stubFetchWithFixtures({
      me: meOf(null),
      'requests/create': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true, id: 7 }));
        }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Заявка'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО' }), 'Мария Соколова');
    const submit = within(dialog).getByRole('button', { name: 'Создать заявку' });
    await user.dblClick(submit);
    await user.keyboard('{Enter}');
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Создаём…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByRole('status', { name: 'Заявка №7 создана' })).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('если списки формы не загрузились, есть кнопка «Повторить» и форма появляется после неё', async () => {
    let fail = true;
    const { fixtureResponse } = await import('../../fixtures');
    stubFetchWithFixtures({
      me: meOf(null),
      'form-meta': () => (fail ? new Response('{}', { status: 500 }) : json(fixtureResponse('form-meta'))),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Заявка' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая заявка' });
    expect(await within(dialog).findByText('Не удалось загрузить списки для формы.')).toBeInTheDocument();
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Повторить' }));
    expect(await within(dialog).findByRole('textbox', { name: 'ФИО' })).toBeInTheDocument();
  });
});

describe('«+ Создать»: группа', () => {
  test('форма группы шлёт нужные имена полей, а адрес лежит в отдельном блоке внизу', async () => {
    const fetchMock = stubFetchWithFixtures({
      me: meOf(null),
      'groups/create': () => json({ ok: true, id: 13 }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));

    const addressBlock = within(dialog).getByRole('group', { name: 'Адрес (виден только здесь)' });
    const address = within(addressBlock).getByRole('textbox', { name: 'Адрес' });
    expect(within(dialog).getAllByRole('textbox', { name: 'Адрес' })).toHaveLength(1);
    // Блок адреса идёт после всех остальных полей, прямо перед кнопками.
    const comment = within(dialog).getByRole('textbox', { name: 'Комментарий' });
    expect(comment.compareDocumentPosition(addressBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' }), 'Ольга Крылова');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Формат группы' }), 'Молодежная');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'День' }), 'Вт');
    await user.type(within(dialog).getByRole('textbox', { name: 'Время' }), '19:00');
    await user.type(within(dialog).getByRole('textbox', { name: 'Сколько человек' }), '8');
    await user.type(within(dialog).getByRole('textbox', { name: 'Мест в группе' }), '5');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Координатор' }), 'Петров Г.');
    await user.type(address, 'Комендантский пр., 12');
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'groups/create',
      body: {
        fields: {
          leader: 'Ольга Крылова',
          district: 'Приморский',
          format: 'Молодежная',
          status: 'Функционирует',
          day: 'Вт',
          time: '19:00',
          people: '8',
          capacity: '5',
          coordinator: 'Петров Г.',
          address: 'Комендантский пр., 12',
        },
      },
    });

    const notice = await screen.findByRole('status', { name: 'Группа ДГ-0013 создана' });
    await user.click(within(notice).getByRole('button', { name: 'Открыть' }));
    expect(currentSearch().get('tab')).toBe('reference');
    expect(currentSearch().get('rec')).toBe('13');
  });

  test('поля старого дашборда: соведущий, состав галочками, обучение, обратная связь и флажки; ни «Приёма новых», ни «№ в реестре» нет', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'groups/create': () => json({ ok: true, id: 14 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' }), 'Ольга Крылова');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Формат группы' }), 'Молодежная');
    await user.type(within(dialog).getByRole('textbox', { name: 'Со-ведущий' }), 'Анна Петрова');
    await user.type(within(dialog).getByRole('textbox', { name: 'Телефон соведущего' }), '+7 921 000-11-44');
    const composition = within(dialog).getByRole('group', { name: 'Состав' });
    await user.click(within(composition).getByRole('checkbox', { name: 'Ментальная' }));
    for (const gone of ['Семейная', 'Служение', 'Приватная']) {
      expect(within(composition).queryByRole('checkbox', { name: gone })).not.toBeInTheDocument();
    }
    await user.click(within(composition).getByRole('checkbox', { name: 'Мужская' }));
    expect(within(dialog).queryByRole('combobox', { name: 'Приём новых' })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Обучение' }), 'Да');
    await user.type(within(dialog).getByLabelText('Дата обратной связи'), '2026-09-10');
    expect(within(dialog).queryByRole('textbox', { name: '№ в реестре' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Данные проверены' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '«40 дней» — зарегистрирован в кампании' }));
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toEqual({
      leader: 'Ольга Крылова', district: 'Приморский', format: 'Молодежная', status: 'Функционирует',
      coLeader: 'Анна Петрова', coLeaderPhone: '+7 921 000-11-44', composition: 'Мужская, Ментальная',
      training: 'Да', feedbackAt: '2026-09-10', checked: '1', campaignRegistered: '1',
    });
  });

  test('«Подобрать из зарегистрированных» подставляет ФИО и телефон, а сам выбор на сервер не уходит', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'groups/create': () => json({ ok: true, id: 15 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));
    const pick = within(dialog).getByRole('combobox', { name: 'Подобрать из зарегистрированных' });
    await user.selectOptions(pick, 'Ольга Домова · +79110001122 · МБВ Колизей · готов предоставить свой дом · Приморский · 25-40');
    expect(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' })).toHaveValue('Ольга Домова');
    expect(within(dialog).getByRole('textbox', { name: 'Телефон' })).toHaveValue('+79110001122');
    // Подставленное правится как обычно.
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' }), ' Ивановна');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Формат группы' }), 'Молодежная');
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toEqual({
      leader: 'Ольга Домова Ивановна', phone: '+79110001122', district: 'Приморский', format: 'Молодежная', status: 'Функционирует',
    });
  });

  test('группа не отправляется, пока не выбраны район и формат', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' }), 'Ольга Крылова');
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    expect(within(dialog).getByText('Выберите значение в поле «Район».')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Район' })).toHaveFocus();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

describe('«+ Создать»: потенциальная группа и «40 дней»', () => {
  test('выбор статуса «Потенциальная» сам отмечает «40 дней», и оба поля уходят на сервер', async () => {
    const fetchMock = stubFetchWithFixtures({ me: meOf(null), 'groups/create': () => json({ ok: true, id: 16 }) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));
    const forty = within(dialog).getByRole('checkbox', { name: '«40 дней» — зарегистрирован в кампании' });
    expect(forty).not.toBeChecked();
    const status = within(dialog).getByRole('combobox', { name: 'Статус' });
    expect(within(status).queryByRole('option', { name: 'Кампания' })).not.toBeInTheDocument();
    await user.selectOptions(status, 'Потенциальная');
    expect(forty).toBeChecked();
    await user.type(within(dialog).getByRole('textbox', { name: 'ФИО ведущего' }), 'Ольга Крылова');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Формат группы' }), 'Молодежная');
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toMatchObject({ status: 'Потенциальная', campaignRegistered: '1' });
  });

  test('в форме создания есть галочка «Работает только в кампанию»', async () => {
    stubFetchWithFixtures({ me: meOf(null) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await ready(await openForm(user, 'Группа'));
    expect(within(dialog).getByRole('checkbox', { name: 'Работает только в кампанию' })).not.toBeChecked();
  });
});
