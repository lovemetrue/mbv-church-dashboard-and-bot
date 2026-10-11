import type { SettingsAssistantView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsAssistant } from '../../fixtures/settings';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { settingsKeys } from './queries';

afterEach(() => vi.unstubAllGlobals());

const LAST_RUN = { at: '2026-10-09T09:30:00+03:00', actor: 'Трофимова С.', asked: 12, filled: 9, withQuestions: 5, proposals: 4 };

const view = (patch: Partial<SettingsAssistantView> = {}): SettingsAssistantView => ({
  ...buildSettingsAssistant(),
  available: true,
  enabled: false,
  model: 'deepseek-chat',
  lastRun: null,
  ...patch,
});

/** «Сервер» настройки: хранит значение и отдаёт его при чтении. */
function server(initial: SettingsAssistantView = view()) {
  let current = initial;
  return {
    get: () => json(current),
    set(patch: Partial<SettingsAssistantView>) {
      current = { ...current, ...patch };
    },
    save: () => {
      current = { ...current, enabled: true };
      return json({ ok: true });
    },
  };
}

function openAssistant(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, role: 'admin' | 'super' = 'super') {
  const client = makeClient();
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=assistant', client);
  return { fetchMock, client };
}

async function block() {
  const region = await screen.findByRole('region', { name: 'Помощник' });
  await within(region).findByRole('switch', { name: 'Помощник включён' });
  return region;
}
const saveBtn = (scope: HTMLElement) => within(scope).getByRole('button', { name: 'Сохранить' });

describe('«Настройки»: помощник', () => {
  test('раздел «Помощник» есть в списке разделов полного входа и открывается по адресу sec=assistant', async () => {
    openAssistant({ 'settings/assistant': server().get });
    const nav = await screen.findByRole('navigation', { name: 'Разделы настроек' });
    expect(within(nav).getByRole('button', { name: 'Помощник' })).toHaveAttribute('aria-current', 'page');
    expect(await block()).toBeInTheDocument();
  });

  test('обычный вход не видит раздела и не запрашивает настройку помощника', async () => {
    const { fetchMock } = openAssistant({}, 'admin');
    await screen.findByText(/Распределено/);
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Помощник' })).not.toBeInTheDocument();
    expect(getsOf(fetchMock, 'settings/assistant')).toBe(0);
  });

  test('если ключ задан, так и написано, и называется модель', async () => {
    openAssistant({ 'settings/assistant': server(view({ available: true, model: 'deepseek-chat' })).get });
    const b = await block();
    expect(within(b).getByText('Ключ задан на сервере')).toBeInTheDocument();
    expect(within(b).getByText('deepseek-chat')).toBeInTheDocument();
  });

  test('если ключа нет, сказано, что делать, и переключатель при этом остаётся доступным', async () => {
    openAssistant({ 'settings/assistant': server(view({ available: false, model: null })).get });
    const b = await block();
    expect(within(b).getByText('Ключ не задан: добавьте DEEPSEEK_API_KEY в файл .env на сервере и перезапустите сервис')).toBeInTheDocument();
    expect(within(b).queryByText('Ключ задан на сервере')).not.toBeInTheDocument();
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeEnabled();
  });

  test('ключ нигде не показывается и не вводится: ни поля ввода, ни значения из ответа', async () => {
    // Даже если бы сервер по ошибке прислал лишнее поле, интерфейс его не рисует.
    const leaked = { ...view(), apiKey: 'sk-секретный-ключ-12345', key: 'sk-секретный-ключ-12345' };
    openAssistant({ 'settings/assistant': () => json(leaked) });
    const b = await block();
    expect(b).not.toHaveTextContent('sk-');
    expect(within(b).queryByRole('textbox')).not.toBeInTheDocument();
    expect(b.querySelector('input[type="password"], input[type="text"]')).toBeNull();
  });

  test('переключатель показывает то, что действует на сервере', async () => {
    openAssistant({ 'settings/assistant': server(view({ enabled: true })).get });
    const b = await block();
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeChecked();
  });

  test('«Сохранить» неактивна, пока переключатель не тронули', async () => {
    openAssistant({ 'settings/assistant': server().get });
    const b = await block();
    expect(saveBtn(b)).toBeDisabled();
  });

  test('включение и «Сохранить» шлёт POST settings/assistant/enabled, перечитывает настройку и подтверждает', async () => {
    const s = server();
    const { fetchMock } = openAssistant({ 'settings/assistant': s.get, 'settings/assistant/enabled': s.save });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('switch', { name: 'Помощник включён' }));
    await user.click(saveBtn(b));
    expect(await within(b).findByText('Сохранено. Кнопка помощника появится на экране «Заявки» в течение минуты.')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'settings/assistant/enabled', body: { enabled: true } }]);
    await waitFor(() => expect(getsOf(fetchMock, 'settings/assistant')).toBe(2));
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeChecked();
    expect(saveBtn(b)).toBeDisabled();
  });

  test('два нажатия «Сохранить» подряд дают один запрос', async () => {
    const s = server();
    const { fetchMock } = openAssistant({ 'settings/assistant': s.get, 'settings/assistant/enabled': s.save });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('switch', { name: 'Помощник включён' }));
    await user.dblClick(saveBtn(b));
    await within(b).findByText(/^Сохранено/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('два нажатия «Сохранить» до перерисовки тоже дают один запрос', async () => {
    const s = server();
    const { fetchMock } = openAssistant({ 'settings/assistant': s.get, 'settings/assistant/enabled': s.save });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('switch', { name: 'Помощник включён' }));
    const save = saveBtn(b);
    act(() => {
      save.click();
      save.click();
    });
    await within(b).findByText(/^Сохранено/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('несохранённая правка переключателя не теряется, когда настройка перечитывается в фоне', async () => {
    const s = server();
    const { client } = openAssistant({ 'settings/assistant': s.get });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('switch', { name: 'Помощник включён' }));
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeChecked();
    // кто-то другой изменил настройку на сервере; интерфейс перечитал её по таймеру
    s.set({ enabled: false, lastRun: LAST_RUN });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.assistant });
    });
    await within(b).findByText(/Трофимова С\./);
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeChecked();
    expect(saveBtn(b)).toBeEnabled();
  });

  test('ошибка сохранения показывается текстом сервера, а правка остаётся', async () => {
    const { fetchMock } = openAssistant({
      'settings/assistant': server().get,
      'settings/assistant/enabled': () => json({ error: 'forbidden', message: 'Менять помощника может только полный вход' }, 403),
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('switch', { name: 'Помощник включён' }));
    await user.click(saveBtn(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent('Менять помощника может только полный вход');
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeChecked();
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('последний запуск: когда, кто и сколько заявок разобрано', async () => {
    openAssistant({ 'settings/assistant': server(view({ lastRun: LAST_RUN })).get });
    const b = await block();
    const line = within(b).getByText(/^Последний запуск:/);
    expect(line).toHaveTextContent(/Последний запуск: .*\d{2}:\d{2}, Трофимова С\./);
    expect(b).toHaveTextContent('заявок отправлено 12, определено по 9, вопросы по 5, новых предложений групп 4');
  });

  test('если помощника ещё не запускали, так и написано', async () => {
    openAssistant({ 'settings/assistant': server(view({ lastRun: null })).get });
    const b = await block();
    expect(within(b).getByText('Помощника ещё не запускали')).toBeInTheDocument();
    expect(within(b).queryByText(/Последний запуск/)).not.toBeInTheDocument();
  });

  test('блок «Что отправляется» объясняет, что уходит к модели, а что нет, и кто выбирает группу', async () => {
    openAssistant({ 'settings/assistant': server().get });
    const b = await block();
    const sent = within(b).getByRole('group', { name: 'Что отправляется' });
    expect(sent).toHaveTextContent(
      'К сервису модели уходят только: возрастная категория, место (как написал человек) и удобное время. Имена, телефоны, почты и адреса не отправляются; номера телефонов и почты в тексте вырезаются. Группу выбирает расчёт сервиса, помощник только разбирает записи.',
    );
    expect(b).toHaveTextContent('Инструкции помощника можно править в разделе «Инструкции агентов» (блоки роль, принципы, шаги, примеры)');
  });

  test('если настройку не удалось прочитать, раздел говорит об этом и даёт повторить', async () => {
    openAssistant({ 'settings/assistant': () => json({ error: 'forbidden', message: 'x' }, 500) });
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeInTheDocument();
  });
});
