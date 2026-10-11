import type { SettingsBotView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsBot } from '../../fixtures/settings';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { settingsKeys } from './queries';

afterEach(() => vi.unstubAllGlobals());

const SAVED = 'Сохранено. Бот подхватит настройку в течение минуты.';

const view = (extra: Partial<SettingsBotView['extraQuestions']> = {}): SettingsBotView => ({
  ...buildSettingsBot(),
  extraQuestions: { mode: 'off', ids: '', source: 'env', envValue: 'off', ...extra },
});

/** «Сервер» настройки: хранит сохранённое значение, отдаёт его при чтении. */
function botServer(initial: SettingsBotView = view()) {
  let current = initial;
  return {
    get: () => json(current),
    set(next: Partial<SettingsBotView['extraQuestions']>) {
      current = { ...current, extraQuestions: { ...current.extraQuestions, ...next } };
    },
    save: () => {
      current = { ...current, extraQuestions: { ...current.extraQuestions, source: 'settings' } };
      return json({ ok: true });
    },
  };
}

function openBot(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, role: 'admin' | 'super' = 'super') {
  const client = makeClient();
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=bot', client);
  return { fetchMock, client };
}

/** Блок настройки, когда данные уже пришли и форма нарисована. */
async function block() {
  const region = await screen.findByRole('region', { name: 'Бот: новые вопросы анкеты' });
  await within(region).findByRole('radiogroup', { name: 'Кому задавать вопросы' });
  return region;
}
const radio = (scope: HTMLElement, name: string) => within(scope).getByRole('radio', { name });
const idsBox = (scope: HTMLElement) => within(scope).getByRole('textbox', { name: 'Номера людей через запятую' });
const saveBtn = (scope: HTMLElement) => within(scope).getByRole('button', { name: 'Сохранить' });

describe('«Настройки»: бот и новые вопросы анкеты', () => {
  test('раздел есть в списке разделов полного входа и открывается по адресу sec=bot', async () => {
    openBot();
    const nav = await screen.findByRole('navigation', { name: 'Разделы настроек' });
    expect(within(nav).getByRole('button', { name: 'Бот: новые вопросы анкеты' })).toHaveAttribute('aria-current', 'page');
    expect(await block()).toBeInTheDocument();
  });

  test('обычный вход не видит раздела и не запрашивает настройку бота', async () => {
    const { fetchMock } = openBot({}, 'admin');
    await screen.findByText(/Распределено/);
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Бот: новые вопросы анкеты' })).not.toBeInTheDocument();
    expect(getsOf(fetchMock, 'settings/bot')).toBe(0);
  });

  test('объяснение, три варианта по порядку и подсказка про дослать вопросы под блоком', async () => {
    openBot({ 'settings/bot': botServer().get });
    const b = await block();
    expect(within(b).getByText('Два вопроса — когда удобно и где живёте. Их задают тем, кто хочет в группу, может открыть её или дать дом.')).toBeInTheDocument();
    const group = within(b).getByRole('radiogroup', { name: 'Кому задавать вопросы' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
      'Выключены',
      'Всем',
      'Только этим людям',
    ]);
    expect(b).toHaveTextContent('Чтобы дослать вопросы тем, кто уже зарегистрирован, в боте нажмите «📝 Дослать вопросы».');
  });

  test.each([
    ['off', 'Выключены'],
    ['all', 'Всем'],
    ['list', 'Только этим людям'],
  ] as const)('выбран тот вариант, который сейчас действует на сервере: %s', async (mode, label) => {
    openBot({ 'settings/bot': botServer(view({ mode, ids: mode === 'list' ? '111, max:222' : '' })).get });
    const b = await block();
    expect(radio(b, label)).toBeChecked();
    for (const other of ['Выключены', 'Всем', 'Только этим людям'].filter((x) => x !== label)) expect(radio(b, other)).not.toBeChecked();
  });

  test('показано, откуда действует значение: из файла .env, пока здесь не меняли, и что там записано', async () => {
    openBot({ 'settings/bot': botServer(view({ source: 'env', envValue: 'all' })).get });
    const b = await block();
    expect(b).toHaveTextContent('Откуда значение: из файла .env, пока здесь не меняли');
    expect(b).toHaveTextContent('В файле .env: all');
  });

  test('после сохранения в настройках источник — «из настроек»', async () => {
    openBot({ 'settings/bot': botServer(view({ source: 'settings', envValue: '' })).get });
    const b = await block();
    expect(b).toHaveTextContent('Откуда значение: из настроек');
    expect(b).not.toHaveTextContent('из файла .env, пока здесь не меняли');
    expect(b).toHaveTextContent('В файле .env: не задано');
  });

  test('поле номеров видно только в режиме «Только этим людям» и содержит текущий список', async () => {
    openBot({ 'settings/bot': botServer(view({ mode: 'list', ids: '111, max:222' })).get });
    const user = userEvent.setup();
    const b = await block();
    expect(idsBox(b)).toHaveValue('111, max:222');
    expect(idsBox(b)).toHaveAccessibleDescription('Свой номер показывает команда /whoami в боте.');
    await user.click(radio(b, 'Всем'));
    expect(within(b).queryByRole('textbox', { name: 'Номера людей через запятую' })).not.toBeInTheDocument();
  });
});

describe('«Настройки»: бот — сохранение', () => {
  test('режим «Только этим людям» без номеров не сохраняется: кнопка неактивна, пока нет хотя бы одного', async () => {
    const { fetchMock } = openBot({ 'settings/bot': botServer().get });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Только этим людям'));
    expect(saveBtn(b)).toBeDisabled();
    await user.type(idsBox(b), '  ,  , ');
    expect(saveBtn(b)).toBeDisabled();
    await user.type(idsBox(b), '111');
    expect(saveBtn(b)).toBeEnabled();
    await user.clear(idsBox(b));
    expect(saveBtn(b)).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Всем» и «Выключены» шлют только режим, без списка номеров', async () => {
    const server = botServer(view({ mode: 'list', ids: '111' }));
    const { fetchMock } = openBot({ 'settings/bot': server.get, 'settings/bot/extra-questions': server.save });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Всем'));
    await user.click(saveBtn(b));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: 'settings/bot/extra-questions', body: { mode: 'all' } });
    await user.click(radio(b, 'Выключены'));
    await user.click(saveBtn(b));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
    expect(posts(fetchMock)[1]).toEqual({ path: 'settings/bot/extra-questions', body: { mode: 'off' } });
  });

  test('«Только этим людям» шлёт режим и список номеров как их вписали, без лишних пробелов по краям', async () => {
    const server = botServer();
    const { fetchMock } = openBot({ 'settings/bot': server.get, 'settings/bot/extra-questions': server.save });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Только этим людям'));
    await user.type(idsBox(b), '  111111111, max:222222222 ');
    await user.click(saveBtn(b));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({
      path: 'settings/bot/extra-questions',
      body: { mode: 'list', ids: '111111111, max:222222222' },
    });
  });

  test('успех: подтверждение словами, настройка перечитана, источник теперь «из настроек»', async () => {
    const server = botServer();
    const { fetchMock } = openBot({
      'settings/bot': server.get,
      'settings/bot/extra-questions': () => {
        server.set({ mode: 'all', source: 'settings' });
        return json({ ok: true });
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Всем'));
    await user.click(saveBtn(b));
    expect(await within(b).findByText(SAVED)).toHaveAttribute('role', 'status');
    await waitFor(() => expect(getsOf(fetchMock, 'settings/bot')).toBe(2));
    expect(b).toHaveTextContent('Откуда значение: из настроек');
    expect(radio(b, 'Всем')).toBeChecked();
  });

  test('отказ сервера показывается словами, набранное остаётся', async () => {
    openBot({
      'settings/bot': botServer().get,
      'settings/bot/extra-questions': () => json({ error: 'bad_request', message: 'Не удалось разобрать номер «abc».' }, 400),
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Только этим людям'));
    await user.type(idsBox(b), 'abc');
    await user.click(saveBtn(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent('Не удалось разобрать номер «abc».');
    expect(idsBox(b)).toHaveValue('abc');
    expect(saveBtn(b)).toBeEnabled();
    expect(within(b).queryByText(SAVED)).not.toBeInTheDocument();
  });

  test('нет связи и нет прав объясняются своими словами', async () => {
    let mode: 'network' | 'forbidden' = 'network';
    openBot({
      'settings/bot': botServer().get,
      'settings/bot/extra-questions': () => {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        return json({ error: 'forbidden' }, 403);
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Всем'));
    await user.click(saveBtn(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Ничего не сохранено, попробуйте ещё раз.');
    mode = 'forbidden';
    await user.click(saveBtn(b));
    await waitFor(() => expect(within(b).getByRole('alert')).toHaveTextContent('Нет прав менять эту настройку.'));
  });

  test('двойное нажатие шлёт один запрос', async () => {
    let release: () => void = () => {};
    const { fetchMock } = openBot({
      'settings/bot': botServer().get,
      'settings/bot/extra-questions': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true }));
        }),
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Всем'));
    const save = saveBtn(b);
    act(() => {
      save.click();
      save.click();
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(b).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    await act(async () => release());
    await within(b).findByText(SAVED);
    expect(posts(fetchMock)).toHaveLength(1);
  });
});

describe('«Настройки»: бот — несохранённая правка', () => {
  test('не теряется, когда настройка перечитывается по таймеру, даже если на сервере она изменилась', async () => {
    const server = botServer();
    const { client } = openBot({ 'settings/bot': server.get });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Только этим людям'));
    await user.type(idsBox(b), '111, 222');

    server.set({ mode: 'all', source: 'settings' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.bot });
    });
    await waitFor(() => expect(b).toHaveTextContent('Откуда значение: из настроек'));

    expect(radio(b, 'Только этим людям')).toBeChecked();
    expect(idsBox(b)).toHaveValue('111, 222');
  });

  test('пока человек ничего не трогал, свежее значение с сервера подставляется', async () => {
    const server = botServer();
    const { client } = openBot({ 'settings/bot': server.get });
    const b = await block();
    expect(radio(b, 'Выключены')).toBeChecked();
    server.set({ mode: 'all', source: 'settings' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.bot });
    });
    await waitFor(() => expect(radio(b, 'Всем')).toBeChecked());
  });

  test('не теряется и при переходе в другой раздел настроек и обратно', async () => {
    openBot({ 'settings/bot': botServer().get });
    const user = userEvent.setup();
    const b = await block();
    await user.click(radio(b, 'Только этим людям'));
    await user.type(idsBox(b), '777');
    const nav = screen.getByRole('navigation', { name: 'Разделы настроек' });
    await user.click(within(nav).getByRole('button', { name: 'Журнал ошибок' }));
    await user.click(within(nav).getByRole('button', { name: 'Бот: новые вопросы анкеты' }));
    const again = await block();
    expect(radio(again, 'Только этим людям')).toBeChecked();
    expect(idsBox(again)).toHaveValue('777');
  });
});
