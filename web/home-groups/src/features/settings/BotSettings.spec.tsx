import type { ExtraInvitesView, SettingsBotView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsBot, resetDemoInvites } from '../../fixtures/settings';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { settingsKeys } from './queries';

afterEach(() => {
  vi.unstubAllGlobals();
  resetDemoInvites();
});

const SAVED = 'Сохранено. Бот подхватит настройку в течение минуты.';

const invites = (extra: Partial<ExtraInvitesView> = {}): ExtraInvitesView => ({
  available: true,
  join: 4,
  lead: 2,
  total: 6,
  off: false,
  textJoin: 'Текст для тех, кто ищет группу.',
  textLead: 'Текст для тех, кто готов открыть.',
  leaders: 3,
  textLeader: 'Текст для ведущих.',
  ...extra,
});

const view = (extra: Partial<SettingsBotView['extraQuestions']> = {}, inv: Partial<ExtraInvitesView> = {}): SettingsBotView => ({
  ...buildSettingsBot(),
  extraQuestions: { mode: 'off', ids: '', source: 'env', envValue: 'off', ...extra },
  invites: invites(inv),
});

/** «Сервер» настройки: хранит сохранённое значение, отдаёт его при чтении. */
function botServer(initial: SettingsBotView = view()) {
  let current = initial;
  return {
    get: () => json(current),
    set(next: Partial<SettingsBotView['extraQuestions']>) {
      current = { ...current, extraQuestions: { ...current.extraQuestions, ...next } };
    },
    setInvites(next: Partial<ExtraInvitesView>) {
      current = { ...current, invites: { ...current.invites, ...next } };
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
    expect(b).toHaveTextContent('Вопросы можно дослать и из бота: служитель нажимает «📝 Дослать вопросы». Правила те же.');
    expect(b).not.toHaveTextContent('Чтобы дослать вопросы тем, кто уже зарегистрирован, в боте нажмите');
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

describe('«Настройки»: бот — дослать вопросы тем, кто уже зарегистрирован', () => {
  const SEND = 'settings/bot/send-extra-questions';
  const QUESTION =
    'Сообщение с двумя вопросами получат 6 человек: ищут группу — 4, готовы открыть — 2. Каждый получит его один раз. Отправить?';

  const box = (scope: HTMLElement) => within(scope).getByRole('group', { name: 'Дослать вопросы тем, кто уже зарегистрирован' });
  const sendBtn = (scope: HTMLElement) => within(box(scope)).getByRole('button', { name: /^Отправить доп\. вопросы/ });
  const noSendBtn = (scope: HTMLElement) => expect(within(box(scope)).queryByRole('button', { name: /^Отправить доп\. вопросы/ })).not.toBeInTheDocument();
  const dialog = () => screen.findByRole('dialog', { name: 'Отправить доп. вопросы' });
  const yes = () => screen.getByRole('button', { name: 'Да, отправить' });

  /** Открыть подтверждение: нажать кнопку отправки и дождаться окна. */
  async function ask(user: ReturnType<typeof userEvent.setup>, b: HTMLElement) {
    await user.click(sendBtn(b));
    return dialog();
  }

  test('показаны числа получателей по группам и общее число, а тексты сообщений — в блоке «Что получат люди»', async () => {
    openBot({ 'settings/bot': botServer().get });
    const b = await block();
    const g = box(b);
    expect(g).toHaveTextContent('Хотят в группу: 4');
    expect(g).toHaveTextContent('Готовы открыть: 2');
    expect(g).toHaveTextContent('Всего получат: 6');
    expect(within(g).getByText('Что получат люди')).toBeInTheDocument();
    expect(within(g).getByText('Текст для тех, кто ищет группу.')).toBeInTheDocument();
    expect(within(g).getByText('Текст для тех, кто готов открыть.')).toBeInTheDocument();
    expect(sendBtn(b)).toBeEnabled();
    expect(sendBtn(b)).toHaveAccessibleName('Отправить доп. вопросы (6)');
  });

  test.each([
    ['в сервисе не подключён бот', { available: false }, 'В сервисе не подключён бот: отправить доп. вопросы нельзя.'],
    [
      'новые вопросы выключены',
      { off: true, total: 0, join: 0, lead: 0 },
      'Новые вопросы выключены: выберите «Всем» или «Только этим людям» и сохраните настройку выше.',
    ],
    [
      'некому отправлять',
      { total: 0, join: 0, lead: 0 },
      'Некому отправлять: все, кому можно написать, уже получили вопросы или ответили.',
    ],
  ] as const)('%s: вместо кнопки отправки пояснение', async (_name, patch, text) => {
    openBot({ 'settings/bot': botServer(view({}, patch)).get });
    const b = await block();
    expect(box(b)).toHaveTextContent(text);
    noSendBtn(b);
  });

  test('пока настройка выше изменена и не сохранена, отправка неактивна и объясняет почему; после сохранения доступна', async () => {
    const server = botServer();
    openBot({ 'settings/bot': server.get, 'settings/bot/extra-questions': server.save });
    const user = userEvent.setup();
    const b = await block();
    expect(sendBtn(b)).toBeEnabled();
    await user.click(radio(b, 'Всем'));
    expect(sendBtn(b)).toBeDisabled();
    expect(sendBtn(b)).toHaveAccessibleDescription('Сначала сохраните настройку выше: доп. вопросы уходят по сохранённой настройке.');
    // Вернули прежнее значение — правки нет, отправлять можно.
    await user.click(radio(b, 'Выключены'));
    expect(sendBtn(b)).toBeEnabled();
    await user.click(radio(b, 'Всем'));
    expect(sendBtn(b)).toBeDisabled();
    await user.click(saveBtn(b));
    await within(b).findByText(SAVED);
    await waitFor(() => expect(sendBtn(b)).toBeEnabled());
    expect(within(box(b)).queryByText(/Сначала сохраните настройку выше/)).not.toBeInTheDocument();
  });

  test('правка списка номеров в режиме «Только этим людям» тоже делает отправку неактивной', async () => {
    openBot({ 'settings/bot': botServer(view({ mode: 'list', ids: '111' })).get });
    const user = userEvent.setup();
    const b = await block();
    expect(sendBtn(b)).toBeEnabled();
    await user.type(idsBox(b), ', 222');
    expect(sendBtn(b)).toBeDisabled();
  });

  test('нажатие открывает подтверждение с числами и ничего не отправляет; «Отмена» закрывает окно без запроса', async () => {
    const { fetchMock } = openBot({ 'settings/bot': botServer().get, [SEND]: () => json({ ok: true, sent: 6, failed: 0, blocked: 0 }) });
    const user = userEvent.setup();
    const b = await block();
    const d = await ask(user, b);
    expect(d).toHaveTextContent(QUESTION);
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(d).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    expect(sendBtn(b)).toBeEnabled();
  });

  test('«Кому отправить: ведущим групп» — своё число, свой текст и в запросе аудитория ведущих', async () => {
    const { fetchMock } = openBot({ 'settings/bot': botServer().get, [SEND]: () => json({ ok: true, sent: 3, failed: 0, blocked: 0 }) });
    const user = userEvent.setup();
    const b = await block();
    const g = box(b);
    expect(within(g).getByRole('radio', { name: 'Ищущим группу и готовым открыть' })).toBeChecked();
    expect(within(g).queryByText('Текст для ведущих.')).not.toBeInTheDocument();
    await user.click(within(g).getByRole('radio', { name: 'Ведущим групп' }));
    expect(g).toHaveTextContent('Ведут группу: 3');
    expect(g).not.toHaveTextContent('Хотят в группу');
    expect(within(g).getByText('Текст для ведущих.')).toBeInTheDocument();
    expect(within(g).queryByText('Текст для тех, кто ищет группу.')).not.toBeInTheDocument();
    expect(sendBtn(b)).toHaveAccessibleName('Отправить доп. вопросы (3)');
    const d = await ask(user, b);
    expect(d).toHaveTextContent('Сообщение с двумя вопросами получат 3 человека, которые ведут группу. Каждый получит его один раз. Отправить?');
    await user.click(yes());
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: SEND, body: { expectedTotal: 3, audience: 'leaders' } });
  });

  test('ведущим некому отправлять — пояснение вместо кнопки, хотя ищущим есть кому', async () => {
    openBot({ 'settings/bot': botServer(view({}, { leaders: 0 })).get });
    const user = userEvent.setup();
    const b = await block();
    expect(sendBtn(b)).toBeEnabled();
    await user.click(within(box(b)).getByRole('radio', { name: 'Ведущим групп' }));
    expect(box(b)).toHaveTextContent('Некому отправлять: все, кому можно написать, уже получили вопросы или ответили.');
    noSendBtn(b);
  });

  test('«Да, отправить» шлёт ровно то число, которое человек видел в окне, даже если обзор успел измениться', async () => {
    const server = botServer();
    const { fetchMock, client } = openBot({
      'settings/bot': server.get,
      [SEND]: () => json({ ok: true, sent: 6, failed: 0, blocked: 0 }),
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    // Пока окно открыто, обзор перечитался и получателей стало больше: в окне и в запросе остаётся то, что видели.
    server.setInvites({ total: 9, join: 6, lead: 3 });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.bot });
    });
    await waitFor(() => expect(box(b)).toHaveTextContent('Всего получат: 9'));
    expect(screen.getByRole('dialog')).toHaveTextContent(QUESTION);
    await user.click(yes());
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toEqual({ path: SEND, body: { expectedTotal: 6, audience: 'seekers' } });
  });

  test('двойное нажатие «Да, отправить» шлёт один запрос, а пока идёт отправка кнопка неактивна', async () => {
    let release: () => void = () => {};
    const { fetchMock } = openBot({
      'settings/bot': botServer().get,
      [SEND]: () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({ ok: true, sent: 6, failed: 0, blocked: 0 }));
        }),
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    const confirm = yes();
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(box(b)).getByRole('button', { name: 'Отправляем…' })).toBeDisabled();
    await act(async () => release());
    await within(b).findByText(/^Готово: доставлено 6/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('успех: итог словами, обзор перечитан, получателей не осталось и кнопки больше нет', async () => {
    const server = botServer();
    const { fetchMock } = openBot({
      'settings/bot': server.get,
      [SEND]: () => {
        server.setInvites({ total: 0, join: 0, lead: 0 });
        return json({ ok: true, sent: 5, failed: 1, blocked: 2 });
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    await user.click(yes());
    const done = await within(b).findByText('Готово: доставлено 5, ошибок 1, заблокировали бота 2.');
    expect(done).toHaveAttribute('role', 'status');
    await waitFor(() => expect(getsOf(fetchMock, 'settings/bot')).toBe(2));
    await waitFor(() => noSendBtn(b));
    expect(box(b)).toHaveTextContent('Некому отправлять');
    // Итог не пропадает вместе с кнопкой.
    expect(within(b).getByText('Готово: доставлено 5, ошибок 1, заблокировали бота 2.')).toBeInTheDocument();
  });

  test('конфликт: показано сообщение сервера с новым числом, обзор перечитан, ничего не повторяется само', async () => {
    const server = botServer();
    const { fetchMock } = openBot({
      'settings/bot': server.get,
      [SEND]: () => {
        server.setInvites({ total: 5, join: 3, lead: 2 });
        return json({ error: 'conflict', message: 'Получателей стало 5, а не 6. Проверьте число и отправьте заново.' }, 409);
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    await user.click(yes());
    expect(await within(b).findByRole('alert')).toHaveTextContent('Получателей стало 5, а не 6. Проверьте число и отправьте заново.');
    await waitFor(() => expect(box(b)).toHaveTextContent('Всего получат: 5'));
    expect(getsOf(fetchMock, 'settings/bot')).toBe(2);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(sendBtn(b)).toHaveAccessibleName('Отправить доп. вопросы (5)');
  });

  test('обрыв связи: сказано, что неизвестно, ушли ли доп. вопросы; запрос не повторяется и повторить не предлагается', async () => {
    const { fetchMock } = openBot({
      'settings/bot': botServer().get,
      [SEND]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    await user.click(yes());
    const alert = await within(b).findByRole('alert');
    expect(alert).toHaveTextContent('Нет связи с сервером. Неизвестно, ушли ли доп. вопросы: обновите обзор и проверьте число получателей.');
    expect(alert).not.toHaveTextContent(/попробуйте ещё раз|повторите/i);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(sendBtn(b)).toBeEnabled();
  });

  test('нет прав, отказ проверки и недоступность объясняются своими словами', async () => {
    let answer: () => Response = () => json({ error: 'forbidden' }, 403);
    openBot({ 'settings/bot': botServer().get, [SEND]: () => answer() });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    await user.click(yes());
    expect(await within(b).findByRole('alert')).toHaveTextContent('Нет прав на эту рассылку.');

    answer = () => json({ error: 'bad_request', message: 'Не указано число получателей.' }, 400);
    await ask(user, b);
    await user.click(yes());
    await waitFor(() => expect(within(b).getByRole('alert')).toHaveTextContent('Не указано число получателей.'));

    answer = () => json({ error: 'unavailable', message: 'Бот сейчас не отвечает.' }, 503);
    await ask(user, b);
    await user.click(yes());
    await waitFor(() => expect(within(b).getByRole('alert')).toHaveTextContent('Бот сейчас не отвечает.'));
  });

  test('сообщение об ошибке пропадает, когда начинается новая отправка', async () => {
    let fail = true;
    openBot({
      'settings/bot': botServer().get,
      [SEND]: () => (fail ? json({ error: 'forbidden' }, 403) : json({ ok: true, sent: 6, failed: 0, blocked: 0 })),
    });
    const user = userEvent.setup();
    const b = await block();
    await ask(user, b);
    await user.click(yes());
    await within(b).findByRole('alert');
    fail = false;
    await ask(user, b);
    await user.click(yes());
    await within(b).findByText(/^Готово: доставлено 6/);
    expect(within(b).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('«Настройки → Бот»: ведущим — контакт координатора', () => {
  const withContacts = (): SettingsBotView => ({
    ...view(),
    coordinatorContacts: { available: true, total: 3, alreadySent: 4, noChat: ['ДГ-0005'], noCoordinator: ['ДГ-0007', 'ДГ-0008'], noPhone: [] },
  });

  test('видно, скольким уйдёт и у каких групп не уйдёт; после подтверждения уходит подтверждённое число', async () => {
    let body: unknown = null;
    const { fetchMock } = openBot({
      'settings/bot': () => json(withContacts()),
      'settings/bot/send-coordinator-contacts': () => json({ ok: true, sent: 3, failed: 0, blocked: 0 }),
    });
    const group = await screen.findByRole('group', { name: 'Ведущим — контакт координатора' });
    expect(within(group).getByText(/Ведущего нет в боте/)).toHaveTextContent('ДГ-0005');
    expect(within(group).getByText(/не закреплён координатор/)).toHaveTextContent('2');
    expect(within(group).getByText(/Уже получили — повторно не придёт/)).toHaveTextContent('4');
    const user = userEvent.setup();
    await user.click(within(group).getByRole('button', { name: 'Разослать ведущим (3)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Разослать ведущим контакт координатора?' });
    expect(dialog).toHaveTextContent('Сообщение уйдёт 3 ведущим.');
    await user.click(within(dialog).getByRole('button', { name: 'Да, разослать' }));
    expect(await within(group).findByRole('status')).toHaveTextContent('Готово: доставлено 3.');
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('settings/bot/send-coordinator-contacts'))!;
    body = JSON.parse(String((call as unknown as [unknown, RequestInit])[1].body));
    expect(body).toEqual({ expectedTotal: 3 });
  });

  test('некому отправлять — кнопки нет, сказано почему', async () => {
    openBot({ 'settings/bot': () => json({ ...view(), coordinatorContacts: { available: true, total: 0, alreadySent: 5, noChat: [], noCoordinator: ['ДГ-0007'], noPhone: [] } }) });
    const group = await screen.findByRole('group', { name: 'Ведущим — контакт координатора' });
    expect(within(group).queryByRole('button', { name: /Разослать ведущим/ })).not.toBeInTheDocument();
    expect(within(group).getByText(/Некому отправлять/)).toBeInTheDocument();
  });
});
