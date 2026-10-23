import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

const REFERENCE = '/?tab=reference';
const OK = () => json({ ok: true, id: 41, registrationNo: 7 });

/** Открывает форму регистрации через меню «+ Создать» и ждёт, пока загрузятся списки формы. */
async function openRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '+ Создать' }));
  const menu = screen.getByRole('menu', { name: 'Что создать' });
  await user.click(within(menu).getByRole('menuitem', { name: /Участник/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Регистрация участника' });
  await within(dialog).findByRole('combobox', { name: 'Церковь' });
  return dialog;
}

const fio = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'ФИО' });
const phone = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Телефон' });
const status = (d: HTMLElement) => within(d).getByRole('combobox', { name: 'Малая группа' });
const submitButton = (d: HTMLElement) => within(d).getByRole('button', { name: 'Зарегистрировать' });

async function fillRequired(user: ReturnType<typeof userEvent.setup>, d: HTMLElement) {
  await user.type(fio(d), 'Анна Петрова');
  await user.type(phone(d), '+7 911 000 11 22');
}

describe('регистрация участника: меню', () => {
  test('пункт «Участник» открывает форму регистрации в окне, а не ссылку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    await user.click(screen.getByRole('button', { name: '+ Создать' }));
    const menu = screen.getByRole('menu', { name: 'Что создать' });
    const item = within(menu).getByRole('menuitem', { name: /Участник/ });
    expect(item).not.toHaveAttribute('href');
    expect(within(menu).queryByRole('link')).not.toBeInTheDocument();
    await user.click(item);
    const dialog = await screen.findByRole('dialog', { name: 'Регистрация участника' });
    expect(await within(dialog).findByRole('textbox', { name: 'ФИО' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('пункт «Участник» есть сразу: ответ /me ему не нужен', async () => {
    stubFetchWithFixtures({ me: () => new Promise<Response>(() => {}) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    await user.click(screen.getByRole('button', { name: '+ Создать' }));
    const menu = screen.getByRole('menu', { name: 'Что создать' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Заявка', 'Группа', 'Координатор', 'Участник (регистрация)']);
  });
});

describe('регистрация участника: форма', () => {
  test('без ФИО и телефона запрос не уходит, поля подсвечены', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await user.click(submitButton(dialog));
    expect(within(dialog).getByText('Заполните поле «ФИО».')).toBeInTheDocument();
    expect(within(dialog).getByText('Заполните поле «Телефон».')).toBeInTheDocument();
    expect(fio(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(fio(dialog)).toHaveFocus();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('списки церквей и ответов про группу берутся из справочников сервера, у каждого есть пустой пункт', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    const church = within(dialog).getByRole('combobox', { name: 'Церковь' });
    expect(within(church).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '— не указана —',
      'МБВ Колизей',
      'МБВ Филиалы',
      'МБВ онлайн',
      'Другая церковь',
      'Не посещаю церковь',
    ]);
    expect(within(status(dialog)).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '— не спрошено —',
      'хочет открыть Малую группу',
      'может предоставить свой дом для Малой группы',
      'хочет присоединиться к Малой группе',
      'уже состоит в Малой группе',
      'ведёт Малую группу',
    ]);
  });

  test('поля меняются вместе с ответом про группу: «уже состоит» просит ведущего, «хочет» — район, возраст, дни, время и улицу, «ведёт» и пусто — ничего', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    const extra = () => ({
      leader: within(dialog).queryByRole('textbox', { name: 'Ведущий группы' }),
      location: within(dialog).queryByRole('textbox', { name: 'Район' }) ?? within(dialog).queryByRole('combobox', { name: 'Район' }),
      age: within(dialog).queryByRole('combobox', { name: 'Возраст' }),
      days: within(dialog).queryByRole('group', { name: 'Удобные дни' }),
      time: within(dialog).queryByRole('combobox', { name: 'Удобное время' }),
      address: within(dialog).queryByRole('textbox', { name: 'Улица и дом' }),
    });
    // Пусто: никаких дополнительных полей.
    expect(Object.values(extra()).every((x) => x === null)).toBe(true);

    await user.selectOptions(status(dialog), 'member');
    expect(extra().leader).toBeInTheDocument();
    expect(extra().location).toBeNull();
    expect(extra().age).toBeNull();
    expect(extra().days).toBeNull();
    expect(extra().time).toBeNull();
    expect(extra().address).toBeNull();

    for (const value of ['join', 'open', 'home']) {
      await user.selectOptions(status(dialog), value);
      expect(extra().leader).toBeNull();
      expect(extra().location).toBeInTheDocument();
      expect(extra().age).toBeInTheDocument();
      // Те же вопросы, что бот задаёт после возраста: по ним идёт подбор группы.
      expect(extra().days).toBeInTheDocument();
      expect(extra().time).toBeInTheDocument();
      expect(extra().address).toBeInTheDocument();
    }

    await user.selectOptions(status(dialog), 'leader');
    expect(Object.values(extra()).every((x) => x === null)).toBe(true);

    await user.selectOptions(status(dialog), '');
    expect(Object.values(extra()).every((x) => x === null)).toBe(true);
  });

  test('под «Малой группой» подсказка: заявку отдельно заводить не нужно, она появится сама', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    // Подсказка связана с полем: её зачитывает и скринридер, а не только видит глаз.
    expect(status(dialog)).toHaveAccessibleDescription(/Заявку отдельно заводить не нужно: она появится сама/);
    expect(status(dialog)).toHaveAccessibleDescription(/«Хочет в группу» уйдёт в подбор/);
  });

  test('скрытые поля не уходят в запрос, даже если их успели заполнить', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);

    // Сначала «уже состоит»: заполняем ведущего. Потом «хочет»: заполняем район. Потом «ведёт»: оба скрыты.
    await user.selectOptions(status(dialog), 'member');
    await user.type(within(dialog).getByRole('textbox', { name: 'Ведущий группы' }), 'Пётр Иванов');
    await user.selectOptions(status(dialog), 'join');
    await user.type(within(dialog).getByRole('textbox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Возраст' }), '25-40');
    await user.selectOptions(status(dialog), 'leader');
    await user.click(submitButton(dialog));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toEqual({
      fio: 'Анна Петрова',
      phone: '+7 911 000 11 22',
      mdgStatus: 'leader',
    });
  });

  test('тело запроса состоит только из заполненных полей, значения без лишних пробелов', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await user.type(fio(dialog), '  Анна Петрова ');
    await user.type(phone(dialog), '+7 911 000 11 22');
    await user.click(submitButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    // Ни церкви, ни ответа про группу, ни комментария: пустые поля не отправляются.
    expect(posts(fetchMock)[0]).toEqual({
      path: 'people/create',
      body: { fields: { fio: 'Анна Петрова', phone: '+7 911 000 11 22' } },
    });
  });

  test('заполненная форма уходит со всеми полями под именами полей API', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Церковь' }), 'МБВ онлайн');
    await user.selectOptions(status(dialog), 'join');
    await user.type(within(dialog).getByRole('textbox', { name: 'Район' }), 'Приморский');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Возраст' }), '25-40');
    const days = within(dialog).getByRole('group', { name: 'Удобные дни' });
    await user.click(within(days).getByRole('checkbox', { name: 'Ср' }));
    await user.click(within(days).getByRole('checkbox', { name: 'Пн' }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Удобное время' }), 'Вечер');
    await user.type(within(dialog).getByRole('textbox', { name: 'Улица и дом' }), 'Савушкина 5');
    await user.type(within(dialog).getByRole('textbox', { name: 'Хобби' }), 'хор');
    await user.type(within(dialog).getByRole('textbox', { name: 'Профессия' }), 'врач');
    await user.type(within(dialog).getByRole('textbox', { name: 'Семейное положение' }), 'замужем');
    await user.type(within(dialog).getByRole('textbox', { name: 'Как удобнее связаться' }), 'звонить после 18:00');
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'пришла с подругой');
    await user.click(submitButton(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body.fields).toEqual({
      fio: 'Анна Петрова',
      phone: '+7 911 000 11 22',
      church: 'МБВ онлайн',
      mdgStatus: 'join',
      location: 'Приморский',
      age: '25-40',
      // Дни уходят кодами через запятую, время — частью суток: фразу «пн, ср вечером» собирает сервер.
      days: 'пн, ср',
      time: 'вечер',
      address: 'Савушкина 5',
      hobby: 'хор',
      profession: 'врач',
      family: 'замужем',
      preferredContact: 'звонить после 18:00',
      comment: 'пришла с подругой',
    });
  });
});

describe('регистрация участника: результат', () => {
  async function registered(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.click(submitButton(dialog));
    await within(dialog).findByText('Участник зарегистрирован.');
    return dialog;
  }

  test('успех не закрывает окно: показывает номер регистрации, QR и ссылку на карточку в новой вкладке', async () => {
    stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await registered(user);
    expect(screen.getByRole('dialog', { name: 'Регистрация участника' })).toBe(dialog);
    expect(within(dialog).getByText('Номер регистрации №7')).toBeInTheDocument();
    const qr = within(dialog).getByRole('img', { name: 'QR регистрации №7' });
    expect(qr.getAttribute('src')).toMatch(/\/api\/v1\/people\/41\/qr$/);
    const card = within(dialog).getByRole('link', { name: /Распечатать карточку/ });
    expect(card.getAttribute('href')).toMatch(/\/api\/v1\/people\/41\/card$/);
    expect(card).toHaveAttribute('target', '_blank');
    expect(card.getAttribute('rel')).toContain('noopener');
    // Самой формы уже нет.
    expect(within(dialog).queryByRole('textbox', { name: 'ФИО' })).not.toBeInTheDocument();
  });

  test('«Зарегистрировать ещё» возвращает чистую форму без прежних значений', async () => {
    stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await registered(user);
    await user.click(within(dialog).getByRole('button', { name: 'Зарегистрировать ещё' }));
    expect(within(dialog).queryByText('Участник зарегистрирован.')).not.toBeInTheDocument();
    expect(fio(dialog)).toHaveValue('');
    expect(phone(dialog)).toHaveValue('');
    expect(status(dialog)).toHaveValue('');
  });

  test('«Готово» закрывает окно', async () => {
    stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await registered(user);
    await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog', { name: 'Регистрация участника' })).not.toBeInTheDocument();
  });

  test('после успеха перечитываются люди и заявки (ответ «хочет в группу» заводит заявку), а также «Сегодня» и группы', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    await screen.findByText(/Распределено/);
    const before = {
      people: getsOf(fetchMock, 'people'),
      requests: getsOf(fetchMock, 'requests'),
      today: getsOf(fetchMock, 'today'),
      groups: getsOf(fetchMock, 'groups'),
    };
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.selectOptions(status(dialog), 'join');
    await user.click(submitButton(dialog));
    await within(dialog).findByText('Участник зарегистрирован.');
    await waitFor(() => {
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
      expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
    });
  });

  test('если QR не загрузился, вместо картинки подсказка открыть карточку, а ссылка остаётся', async () => {
    stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await registered(user);
    act(() => {
      within(dialog).getByRole('img', { name: 'QR регистрации №7' }).dispatchEvent(new Event('error'));
    });
    expect(within(dialog).queryByRole('img', { name: 'QR регистрации №7' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/QR не загрузился/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Распечатать карточку/ })).toBeInTheDocument();
  });
});

describe('регистрация участника: ошибки и повторные нажатия', () => {
  test('отказ сервера показывается его текстом, введённое остаётся, кнопка снова доступна', async () => {
    stubFetchWithFixtures({
      'people/create': () => json({ error: 'bad_request', message: 'Укажите телефон: не меньше десяти цифр.' }, 400),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.click(submitButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Укажите телефон: не меньше десяти цифр.');
    expect(fio(dialog)).toHaveValue('Анна Петрова');
    expect(submitButton(dialog)).toBeEnabled();
    expect(within(dialog).queryByText('Участник зарегистрирован.')).not.toBeInTheDocument();
  });

  test('двойное нажатие шлёт один запрос, кнопки на время запроса заблокированы', async () => {
    let release: () => void = () => {};
    const fetchMock = stubFetchWithFixtures({
      'people/create': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(OK());
        }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.dblClick(submitButton(dialog));
    await user.keyboard('{Enter}');
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Регистрируем…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await act(async () => release());
    expect(await within(dialog).findByText('Участник зарегистрирован.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('два отправления подряд до перерисовки тоже дают один запрос: кнопка ещё не успела заблокироваться', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/create': () => new Promise<Response>(() => {}) });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    const form = fio(dialog).closest('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('пока идёт запрос, окно не закрывается по Esc: иначе номер регистрации остался бы неизвестным', async () => {
    let release: () => void = () => {};
    stubFetchWithFixtures({
      'people/create': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(OK());
        }),
    });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.click(submitButton(dialog));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Регистрация участника' })).toBeInTheDocument();
    await act(async () => release());
    expect(await within(dialog).findByText('Номер регистрации №7')).toBeInTheDocument();
  });
});

describe('регистрация участника: страница для регистрации на месте', () => {
  const PAGE_LINE = () => `Стойка регистрации (регистрация участников и групп, выдача наборов): ${window.location.origin}/registration`;

  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  test('внизу окна написан адрес страницы /registration и есть кнопка «Скопировать ссылку»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    expect(dialog).toHaveTextContent(PAGE_LINE());
    expect(within(dialog).getByRole('button', { name: 'Скопировать ссылку' })).toBeInTheDocument();
  });

  test('строка с адресом остаётся и после регистрации, рядом с номером и QR', async () => {
    stubFetchWithFixtures({ 'people/create': OK });
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    await fillRequired(user, dialog);
    await user.click(submitButton(dialog));
    await within(dialog).findByText('Участник зарегистрирован.');
    expect(dialog).toHaveTextContent(PAGE_LINE());
  });

  test('«Скопировать ссылку» кладёт в буфер полный адрес страницы и говорит об этом', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    stubClipboard(writeText);
    await user.click(within(dialog).getByRole('button', { name: 'Скопировать ссылку' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/registration`);
    expect(await within(dialog).findByText('Ссылка скопирована.')).toBeInTheDocument();
  });

  test('если буфер обмена недоступен, сказано словами, а не тихо', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, REFERENCE);
    const dialog = await openRegistration(user);
    stubClipboard(async () => {
      throw new Error('запрещено');
    });
    await user.click(within(dialog).getByRole('button', { name: 'Скопировать ссылку' }));
    expect(await within(dialog).findByText(/Не получилось скопировать/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Ссылка скопирована.')).not.toBeInTheDocument();
  });
});
