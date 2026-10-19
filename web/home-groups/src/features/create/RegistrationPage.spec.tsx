import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { getPaths, getsOf, json, posts } from '../../test/calls';
import { buildFormMeta } from '../../fixtures/formMeta';

afterEach(() => vi.unstubAllGlobals());

const OK = () => json({ ok: true, id: 41, registrationNo: 7 });
const PAGE = '/registration';

const fio = () => screen.getByRole('textbox', { name: 'ФИО' });
const phone = () => screen.getByRole('textbox', { name: 'Телефон' });
const status = () => screen.getByRole('combobox', { name: 'Малая группа' });
const submit = () => screen.getByRole('button', { name: 'Зарегистрировать' });

async function openPage(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, url = PAGE) {
  const fetchMock = stubFetchWithFixtures(overrides);
  renderAt(<App />, url);
  await screen.findByRole('combobox', { name: 'Церковь' });
  return fetchMock;
}

describe('страница /registration: что на экране', () => {
  test('только форма регистрации: ни шапки, ни вкладок, ни поиска, ни меню «Создать»', async () => {
    await openPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Регистрация участника' })).toBeInTheDocument();
    expect(fio()).toBeInTheDocument();
    expect(phone()).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Создать' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Распределено/)).not.toBeInTheDocument();
    // Форма не в окне, а на самой странице.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('данные приложения не запрашиваются: уходит только справочник формы', async () => {
    const fetchMock = await openPage();
    expect(getPaths(fetchMock)).toEqual(['form-meta']);
    for (const path of ['today', 'requests', 'groups', 'people', 'coordinators', 'team', 'me']) {
      expect(getsOf(fetchMock, path)).toBe(0);
    }
  });

  test('«Выйти» — обычная форма POST на /logout, как в шапке', async () => {
    await openPage();
    const button = screen.getByRole('button', { name: 'Выйти' });
    const form = button.closest('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form.getAttribute('action')).toMatch(/\/logout$/);
  });

  test('«Отмены» и «Готово» на странице нет: закрывать нечего', async () => {
    await openPage();
    expect(screen.queryByRole('button', { name: 'Отмена' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Готово' })).not.toBeInTheDocument();
  });

  test('адрес со слэшем на конце — та же страница', async () => {
    const fetchMock = await openPage({}, '/registration/');
    expect(getPaths(fetchMock)).toEqual(['form-meta']);
  });

  test('обычные адреса приложения не превращаются в страницу регистрации', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    expect(await screen.findByRole('tablist', { name: 'Разделы' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Регистрация участника' })).not.toBeInTheDocument();
  });

  test('если справочники не загрузились, есть «Повторить», а «Отмены» нет', async () => {
    let fail = true;
    stubFetchWithFixtures({ 'form-meta': () => (fail ? json({}, 500) : json(buildFormMeta())) });
    const user = userEvent.setup();
    renderAt(<App />, PAGE);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить списки для формы.');
    expect(within(alert).queryByRole('button', { name: 'Отмена' })).not.toBeInTheDocument();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('combobox', { name: 'Церковь' })).toBeInTheDocument();
  });
});

describe('страница /registration: регистрация', () => {
  test('без ФИО и телефона запрос не уходит', async () => {
    const fetchMock = await openPage({ 'people/create': OK });
    const user = userEvent.setup();
    await user.click(submit());
    expect(screen.getByText('Заполните поле «ФИО».')).toBeInTheDocument();
    expect(screen.getByText('Заполните поле «Телефон».')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('ответ про группу открывает дополнительные поля, как в окне приложения', async () => {
    await openPage();
    const user = userEvent.setup();
    expect(screen.queryByRole('textbox', { name: 'Ведущий группы' })).not.toBeInTheDocument();
    await user.selectOptions(status(), 'member');
    expect(screen.getByRole('textbox', { name: 'Ведущий группы' })).toBeInTheDocument();
    await user.selectOptions(status(), 'join');
    expect(screen.queryByRole('textbox', { name: 'Ведущий группы' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Район' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Возраст' })).toBeInTheDocument();
  });

  test('после сохранения видны номер, QR и «Зарегистрировать ещё», и форма возвращается чистой', async () => {
    const fetchMock = await openPage({ 'people/create': OK });
    const user = userEvent.setup();
    await user.type(fio(), 'Анна Петрова');
    await user.type(phone(), '+7 911 000 11 22');
    await user.selectOptions(status(), 'join');
    await user.click(submit());
    expect(await screen.findByText('Участник зарегистрирован.')).toBeInTheDocument();
    expect(screen.getByText('Номер регистрации №7')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR регистрации №7' }).getAttribute('src')).toMatch(/\/api\/v1\/people\/41\/qr$/);
    expect(posts(fetchMock)).toEqual([
      { path: 'people/create', body: { fields: { fio: 'Анна Петрова', phone: '+7 911 000 11 22', mdgStatus: 'join' } } },
    ]);
    // Страница по-прежнему не просит данных приложения, даже после сохранения: регистрация помечает устаревшими
    // и списки заявок, но их здесь никто не читает; справочник формы перечитаться может.
    await waitFor(() => expect(getsOf(fetchMock, 'form-meta')).toBeGreaterThanOrEqual(1));
    expect([...new Set(getPaths(fetchMock))]).toEqual(['form-meta']);
    await user.click(screen.getByRole('button', { name: 'Зарегистрировать ещё' }));
    expect(fio()).toHaveValue('');
    expect(phone()).toHaveValue('');
    expect(status()).toHaveValue('');
    expect(screen.queryByText('Участник зарегистрирован.')).not.toBeInTheDocument();
  });

  test('отказ сервера показывается его текстом, введённое остаётся', async () => {
    await openPage({ 'people/create': () => json({ error: 'bad_request', message: 'Укажите телефон: не меньше десяти цифр.' }, 400) });
    const user = userEvent.setup();
    await user.type(fio(), 'Анна Петрова');
    await user.type(phone(), '123');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Укажите телефон: не меньше десяти цифр.');
    expect(fio()).toHaveValue('Анна Петрова');
  });
});
