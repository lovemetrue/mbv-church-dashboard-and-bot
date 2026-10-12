import type { LlmConfigView, LlmTestResult, SettingsAssistantView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildLlmConfig, buildSettingsAssistant, resetDemoLlm } from '../../fixtures/settings';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { settingsKeys } from './queries';

beforeEach(() => resetDemoLlm());
afterEach(() => vi.unstubAllGlobals());

const LAST_RUN = { at: '2026-10-09T09:30:00+03:00', actor: 'Трофимова С.', asked: 12, filled: 9, withQuestions: 5, proposals: 4 };

const llm = (patch: Partial<LlmConfigView> = {}): LlmConfigView => ({ ...buildLlmConfig(), ...patch });

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
const keyField = (scope: HTMLElement) => within(scope).getByLabelText('Ключ доступа');

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

  test('если ключ не задан, сказано, что делать, и переключатель при этом остаётся доступным', async () => {
    openAssistant({ 'settings/assistant': server(view({ available: false, model: null, llm: llm({ keySet: false, keySource: null, keyHint: null }) })).get });
    const b = await block();
    expect(within(b).getByText('Ключ не задан: введите его в поле ниже или задайте в файле .env на сервере.')).toBeInTheDocument();
    expect(within(b).getByRole('switch', { name: 'Помощник включён' })).toBeEnabled();
  });

  test('имён переменных окружения в разделе нет', async () => {
    openAssistant({ 'settings/assistant': server(view({ llm: llm({ keySet: false, keySource: null, keyHint: null }) })).get });
    const b = await block();
    expect(b).not.toHaveTextContent(/DEEPSEEK|_API_KEY|_BASE_URL/);
  });

  test('даже если сервер по ошибке пришлёт лишнее поле с ключом, интерфейс его не рисует', async () => {
    const leaked = { ...view(), apiKey: 'sk-секретный-ключ-12345', key: 'sk-секретный-ключ-12345' };
    openAssistant({ 'settings/assistant': () => json(leaked) });
    const b = await block();
    expect(b).not.toHaveTextContent('sk-');
    expect(b.innerHTML).not.toContain('sk-секретный');
    expect((keyField(b) as HTMLInputElement).value).toBe('');
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
    // Про чат «✦ Помощник» сказано отдельно: туда уходят вопрос и результаты запросов, но вместо имён условные номера.
    expect(sent).toHaveTextContent(
      'Для чата «✦ Помощник» к модели уходят вопрос и результаты запросов к базе. Вместо имён там условные номера (Участник-1042, Ведущий-3fa9c1), телефоны замаскированы, свободные заметки не передаются. Районы, улицы и даты модель видит. Настоящие имена подставляются здесь, в ответе, который видите вы.',
    );
    expect(b).toHaveTextContent('Инструкции помощника можно править в разделе «Инструкции агентов» (блоки роль, принципы, шаги, примеры)');
  });

  test('если настройку не удалось прочитать, раздел говорит об этом и даёт повторить', async () => {
    openAssistant({ 'settings/assistant': () => json({ error: 'forbidden', message: 'x' }, 500) });
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeInTheDocument();
  });
});

// ── подключение: провайдер, модель, ключ ─────────────────────────────────────

const KEY = 'sk-test-SECRET-9f3a7c1d';
const TEST_OK: LlmTestResult = { ok: true, provider: 'DeepSeek', model: 'deepseek-chat', ms: 1234 };
const TEST_FAIL: LlmTestResult = {
  ok: false,
  code: 'auth',
  message: 'Провайдер не принял ключ (код 401). Проверьте, что ключ скопирован целиком.',
  status: 401,
  detail: 'Authentication Fails',
};

/** Раздел с «сервером», который принимает сохранение и проверку подключения. */
function openConnection(data: SettingsAssistantView = view(), extra: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const s = server(data);
  const opened = openAssistant({
    'settings/assistant': s.get,
    'settings/assistant/llm': () => json({ ok: true }),
    'settings/assistant/llm-test': () => json(TEST_OK),
    ...extra,
  });
  return { ...opened, s };
}

const llmPosts = (fm: Parameters<typeof posts>[0]) => posts(fm).filter((p) => p.path === 'settings/assistant/llm');
const testPosts = (fm: Parameters<typeof posts>[0]) => posts(fm).filter((p) => p.path === 'settings/assistant/llm-test');
const connSave = (b: HTMLElement) => within(b).getByRole('button', { name: 'Сохранить подключение' });
const checkBtn = (b: HTMLElement) => within(b).getByRole('button', { name: /^Проверить|^Проверяем/ });
const modelField = (b: HTMLElement) => within(b).getByLabelText('Модель') as HTMLInputElement;
const urlField = (b: HTMLElement) => within(b).getByLabelText('Адрес провайдера (https)') as HTMLInputElement;
const providerField = (b: HTMLElement) => within(b).getByLabelText('Провайдер') as HTMLSelectElement;
const atProtocol = (protocol: 'http:' | 'https:') => vi.stubGlobal('location', { ...window.location, protocol });

const withUnreadable = view({ llm: llm({ keyUnreadable: true }) });

describe('«Настройки»: помощник, подключение', () => {
  // По умолчанию страница «открыта по https», чтобы предупреждение о шифровании не мешало остальным проверкам; про http есть свой тест.
  beforeEach(() => atProtocol('https:'));

  test('поле ключа закрыто точками: type=password, без имени, без автозаполнения и проверки орфографии', async () => {
    openConnection();
    const b = await block();
    const field = keyField(b);
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'new-password');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(field).not.toHaveAttribute('name');
  });

  test('кнопки «показать» у поля ключа нет', async () => {
    openConnection();
    const b = await block();
    expect(within(b).queryByRole('button', { name: /показать|видеть|глаз/i })).not.toBeInTheDocument();
    expect(b.querySelectorAll('input[type="text"]')).toHaveLength(1); // только модель
  });

  test('введённый ключ не показывается текстом нигде, кроме самого закрытого поля', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), KEY);
    expect(keyField(b)).toHaveValue(KEY);
    expect(keyField(b)).toHaveAttribute('type', 'password');
    expect(document.body).not.toHaveTextContent(KEY);
    expect(screen.queryByDisplayValue(KEY, { exact: true })).toBe(keyField(b));
  });

  test('ключ сохранён в настройках: видны только точки и последние четыре символа', async () => {
    openConnection(view({ llm: llm({ keySource: 'settings', keyHint: 'ABCD' }) }));
    const b = await block();
    expect(within(b).getByText('Ключ сохранён в настройках: ••••••••ABCD')).toBeInTheDocument();
    expect(keyField(b)).toHaveAccessibleDescription(/Ключ сохранён в настройках: ••••••••ABCD/);
    expect(within(b).getByRole('button', { name: 'Убрать сохранённый ключ' })).toBeInTheDocument();
  });

  test('ключ из файла .env: сказано, откуда он и что ключ из поля важнее, а убрать его кнопкой нельзя', async () => {
    openConnection(view({ llm: llm({ keySource: 'env', keyHint: 'WXYZ' }) }));
    const b = await block();
    expect(within(b).getByText('Ключ задан в файле .env на сервере: ••••••••WXYZ. Ключ из этого поля будет важнее')).toBeInTheDocument();
    expect(within(b).queryByRole('button', { name: 'Убрать сохранённый ключ' })).not.toBeInTheDocument();
  });

  test('ключа нет нигде: строки о сохранённом ключе нет, кнопки «Убрать» тоже', async () => {
    openConnection(view({ llm: llm({ keySet: false, keySource: null, keyHint: null }) }));
    const b = await block();
    expect(b).not.toHaveTextContent('••••');
    expect(within(b).queryByRole('button', { name: 'Убрать сохранённый ключ' })).not.toBeInTheDocument();
  });

  test('ключ не читается: предупреждение role=alert, а убрать сохранённый ключ можно', async () => {
    openConnection(withUnreadable);
    const b = await block();
    expect(within(b).getByRole('alert')).toHaveTextContent(
      'Сохранённый ключ не читается (на сервере сменился секрет шифрования). Введите ключ заново.',
    );
    expect(within(b).getByRole('button', { name: 'Убрать сохранённый ключ' })).toBeInTheDocument();
  });

  test('как только человек начал вводить ключ, строка о прежнем ключе пропадает', async () => {
    openConnection(withUnreadable);
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), 'x');
    expect(within(b).queryByRole('alert')).not.toBeInTheDocument();
    expect(b).not.toHaveTextContent('Сохранённый ключ не читается');
  });

  test('провайдеры в списке названы по-человечески, у выбранного видно пояснение, а подсказки модели берутся из его списка', async () => {
    openConnection();
    const b = await block();
    const options = within(providerField(b)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['DeepSeek', 'OpenAI', 'OpenRouter', 'Другой (свой адрес)']);
    expect(providerField(b)).toHaveValue('deepseek');
    expect(providerField(b)).toHaveAccessibleDescription(buildLlmConfig().providers[0]!.note);
    const list = b.querySelector(`datalist[id="${modelField(b).getAttribute('list')}"]`)!;
    expect(Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual(['deepseek-chat']);
    expect(modelField(b)).toHaveValue('deepseek-chat');
  });

  test('смена провайдера подставляет его модель по умолчанию, если прежняя в его списке не значится', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(modelField(b)).toHaveValue('gpt-4o-mini');
    const list = b.querySelector(`datalist[id="${modelField(b).getAttribute('list')}"]`)!;
    expect(Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']);
    await user.selectOptions(providerField(b), 'OpenRouter');
    expect(modelField(b)).toHaveValue('deepseek/deepseek-chat');
  });

  test('модель, вписанную человеком, смена провайдера не затирает', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.clear(modelField(b));
    await user.type(modelField(b), 'моя-модель-7');
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(modelField(b)).toHaveValue('моя-модель-7');
  });

  test('а пустую модель смена провайдера заполняет, даже если её стирал сам человек', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.clear(modelField(b));
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(modelField(b)).toHaveValue('gpt-4o-mini');
  });

  test('модель, которая есть в списке нового провайдера, при смене остаётся', async () => {
    openConnection(view({ llm: llm({ provider: 'custom', baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' }) }));
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(modelField(b)).toHaveValue('gpt-4o');
  });

  test('«Другой» провайдер просит адрес с подсказкой, у остальных поля адреса нет', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    expect(within(b).queryByLabelText('Адрес провайдера (https)')).not.toBeInTheDocument();
    await user.selectOptions(providerField(b), 'Другой (свой адрес)');
    expect(urlField(b)).toHaveAttribute('placeholder', 'например: https://api.example.com/v1');
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(within(b).queryByLabelText('Адрес провайдера (https)')).not.toBeInTheDocument();
  });

  test('«Другой» провайдер без адреса сохранить и проверить нельзя, с адресом можно', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'Другой (свой адрес)');
    await user.clear(modelField(b));
    await user.type(modelField(b), 'my-model');
    expect(connSave(b)).toBeDisabled();
    expect(checkBtn(b)).toBeDisabled();
    await user.type(urlField(b), 'https://api.example.com/v1');
    expect(connSave(b)).toBeEnabled();
    expect(checkBtn(b)).toBeEnabled();
  });

  test('провайдер «другой» сохраняется вместе с адресом, а у готовых провайдеров адрес не отправляется', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'Другой (свой адрес)');
    await user.clear(modelField(b));
    await user.type(modelField(b), 'my-model');
    await user.type(urlField(b), ' https://api.example.com/v1 ');
    await user.click(connSave(b));
    await within(b).findByText(/^Сохранено\. Помощник/);
    expect(llmPosts(fetchMock)).toEqual([
      { path: 'settings/assistant/llm', body: { provider: 'custom', model: 'my-model', baseUrl: 'https://api.example.com/v1' } },
    ]);
  });

  test('при смене провайдера предупреждает, какие данные ему уйдут; при возврате к прежнему предупреждение уходит', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    expect(within(b).queryByText(/Вы меняете провайдера/)).not.toBeInTheDocument();
    await user.selectOptions(providerField(b), 'OpenAI');
    expect(within(b).getByRole('note')).toHaveTextContent(
      'Вы меняете провайдера: ему будут уходить те же данные (очищенный текст места, возраста и времени; в чате — вопросы по условным номерам вместо имён). Согласуйте это с ответственным за персональные данные.',
    );
    await user.selectOptions(providerField(b), 'DeepSeek');
    expect(within(b).queryByText(/Вы меняете провайдера/)).not.toBeInTheDocument();
  });

  test('«Проверить» шлёт ровно текущие значения полей и ничего не сохраняет', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'OpenAI');
    await user.clear(modelField(b));
    await user.type(modelField(b), 'gpt-4o');
    await user.type(keyField(b), KEY);
    await user.click(checkBtn(b));
    await within(b).findByRole('status');
    expect(testPosts(fetchMock)).toEqual([
      { path: 'settings/assistant/llm-test', body: { provider: 'openai', model: 'gpt-4o', apiKey: KEY } },
    ]);
    expect(llmPosts(fetchMock)).toHaveLength(0);
    // поле ключа проверка не очищает: человек ещё может сохранить
    expect(keyField(b)).toHaveValue(KEY);
  });

  test('«Проверить» без введённого ключа не передаёт поле apiKey: проверяется действующий ключ', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    await within(b).findByRole('status');
    const [sent] = testPosts(fetchMock);
    expect(sent!.body).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
    expect('apiKey' in sent!.body).toBe(false);
  });

  test('успешная проверка: подключение работает, провайдер, модель и время ответа с одним знаком', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    expect(await within(b).findByRole('status')).toHaveTextContent('Подключение работает: DeepSeek, модель deepseek-chat, ответ за 1,2 с');
  });

  test('отказ проверки: слова сервера, ответ провайдера и код ответа', async () => {
    openConnection(view(), { 'settings/assistant/llm-test': () => json(TEST_FAIL) });
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    const alert = await within(b).findByRole('alert');
    expect(alert).toHaveTextContent('Провайдер не принял ключ (код 401). Проверьте, что ключ скопирован целиком.');
    expect(alert).toHaveTextContent('Ответ провайдера: Authentication Fails');
    expect(alert).toHaveTextContent('Код ответа: 401');
    expect(within(b).queryByRole('status')).not.toBeInTheDocument();
  });

  test('отказ без пояснения и кода показывает только сообщение', async () => {
    openConnection(view(), { 'settings/assistant/llm-test': () => json({ ok: false, code: 'nokey', message: 'Ключ не задан.' }) });
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    const alert = await within(b).findByRole('alert');
    expect(alert).toHaveTextContent('Ключ не задан.');
    expect(alert).not.toHaveTextContent('Ответ провайдера');
    expect(alert).not.toHaveTextContent('Код ответа');
  });

  test('сбой связи при проверке: «Нет связи с сервером. Проверка не выполнена.»', async () => {
    openConnection(view(), {
      'settings/assistant/llm-test': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Проверка не выполнена.');
  });

  test('пока идёт проверка, кнопка неактивна, а двойное нажатие даёт один запрос', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock } = openConnection(view(), {
      'settings/assistant/llm-test': async () => {
        await gate;
        return json(TEST_OK);
      },
    });
    const user = userEvent.setup();
    const b = await block();
    const btn = checkBtn(b);
    act(() => {
      btn.click();
      btn.click();
    });
    expect(await within(b).findByRole('button', { name: 'Проверяем…' })).toBeDisabled();
    release();
    await within(b).findByRole('status');
    expect(testPosts(fetchMock)).toHaveLength(1);
    expect(within(b).getByRole('button', { name: 'Проверить' })).toBeEnabled();
    void user;
  });

  test('правка формы убирает прежний результат проверки: он был про другие значения', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    await within(b).findByRole('status');
    await user.type(modelField(b), '2');
    expect(within(b).queryByRole('status')).not.toBeInTheDocument();
  });

  test('ответ проверки, пришедший после правки формы, не показывается', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    openConnection(view(), {
      'settings/assistant/llm-test': async () => {
        await gate;
        return json(TEST_OK);
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.click(checkBtn(b));
    await user.type(modelField(b), '2');
    release();
    await act(async () => {});
    await waitFor(() => expect(within(b).getByRole('button', { name: 'Проверить' })).toBeEnabled());
    expect(within(b).queryByRole('status')).not.toBeInTheDocument();
  });

  test('«Сохранить подключение» неактивна, пока форма совпадает с действующим и ключ не введён', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    expect(connSave(b)).toBeDisabled();
    await user.type(keyField(b), 'k');
    expect(connSave(b)).toBeEnabled();
    await user.clear(keyField(b));
    expect(connSave(b)).toBeDisabled();
    await user.type(modelField(b), 'x');
    expect(connSave(b)).toBeEnabled();
    await user.type(modelField(b), '{Backspace}');
    expect(connSave(b)).toBeDisabled();
  });

  test('без модели сохранить и проверить нельзя', async () => {
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.clear(modelField(b));
    await user.type(keyField(b), 'k');
    expect(connSave(b)).toBeDisabled();
    expect(checkBtn(b)).toBeDisabled();
  });

  test('«Сохранить подключение» без нового ключа не передаёт поле apiKey: прежний остаётся', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.type(modelField(b), '-v2');
    await user.click(connSave(b));
    await within(b).findByText(/^Сохранено\. Помощник/);
    const [sent] = llmPosts(fetchMock);
    expect(sent!.body).toEqual({ provider: 'deepseek', model: 'deepseek-chat-v2' });
    expect('apiKey' in sent!.body).toBe(false);
  });

  test('«Сохранить подключение» с новым ключом шлёт его строкой без пробелов по краям', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), `  ${KEY}  `);
    await user.click(connSave(b));
    await within(b).findByText(/^Сохранено\. Помощник/);
    expect(llmPosts(fetchMock)).toEqual([{ path: 'settings/assistant/llm', body: { provider: 'deepseek', model: 'deepseek-chat', apiKey: KEY } }]);
    expect(testPosts(fetchMock)).toHaveLength(0);
  });

  test('после сохранения поле ключа пусто, а сам ключ нигде не остался: ни в странице, ни в кэше, ни в хранилище браузера', async () => {
    const { fetchMock, client } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), KEY);
    await user.click(connSave(b));
    expect(await within(b).findByRole('status')).toHaveTextContent('Сохранено. Помощник использует новое подключение сразу');
    expect(keyField(b)).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(KEY);
    // ключ видел только один запрос: тело POST на сохранение
    const carriers = (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][])
      .filter(([url, init]) => JSON.stringify([String(url), init]).includes(KEY))
      .map(([url]) => String(url).replace(/^.*\/api\/v1\//, ''));
    expect(carriers).toEqual(['settings/assistant/llm']);
    const cached = client.getQueryCache().getAll().map((q) => JSON.stringify(q.state.data));
    expect(cached.join('')).not.toContain(KEY);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    const stored = [window.localStorage, window.sessionStorage].map((st) => JSON.stringify(Object.entries(st)));
    expect(stored.join('')).not.toContain(KEY);
  });

  test('после сохранения настройка перечитывается и новое подключение видно', async () => {
    const s = server();
    const { fetchMock } = openAssistant({
      'settings/assistant': s.get,
      'settings/assistant/llm': () => {
        s.set({ llm: llm({ provider: 'openai', model: 'gpt-4o-mini', keySource: 'settings', keyHint: '1d2e' }) });
        return json({ ok: true });
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'OpenAI');
    await user.type(keyField(b), KEY);
    await user.click(connSave(b));
    await within(b).findByText(/^Сохранено\. Помощник/);
    await waitFor(() => expect(getsOf(fetchMock, 'settings/assistant')).toBe(2));
    expect(providerField(b)).toHaveValue('openai');
    expect(within(b).getByText('Ключ сохранён в настройках: ••••••••1d2e')).toBeInTheDocument();
    // прежний провайдер теперь действующий: предупреждения о смене нет
    expect(within(b).queryByText(/Вы меняете провайдера/)).not.toBeInTheDocument();
    expect(connSave(b)).toBeDisabled();
  });

  test('два нажатия «Сохранить подключение» до перерисовки дают один запрос', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), KEY);
    const btn = connSave(b);
    act(() => {
      btn.click();
      btn.click();
    });
    await within(b).findByText(/^Сохранено\. Помощник/);
    expect(llmPosts(fetchMock)).toHaveLength(1);
  });

  test.each([
    ['400', 400, { error: 'bad_request', message: 'Адрес провайдера должен начинаться с https://' }, 'Адрес провайдера должен начинаться с https://'],
    ['503', 503, { error: 'unavailable', message: 'На сервере не задан секрет шифрования, ключ сохранить нельзя.' }, 'На сервере не задан секрет шифрования, ключ сохранить нельзя.'],
    ['403', 403, { error: 'forbidden', message: 'Нет доступа' }, 'Нет прав менять подключение.'],
  ])('отказ сервера %s при сохранении показывается человеку, а набранный ключ остаётся в поле', async (_name, status, body, text) => {
    const { fetchMock } = openConnection(view(), { 'settings/assistant/llm': () => json(body, status) });
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), KEY);
    await user.click(connSave(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent(text);
    expect(keyField(b)).toHaveValue(KEY);
    expect(llmPosts(fetchMock)).toHaveLength(1);
    expect(connSave(b)).toBeEnabled();
  });

  test('сбой связи при сохранении: «Нет связи с сервером. Ничего не сохранено.», а ключ остаётся в поле', async () => {
    openConnection(view(), {
      'settings/assistant/llm': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    const b = await block();
    await user.type(keyField(b), KEY);
    await user.click(connSave(b));
    expect(await within(b).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Ничего не сохранено.');
    expect(keyField(b)).toHaveValue(KEY);
  });

  test('набранное, и ключ в том числе, не теряется, когда настройка перечитывается в фоне', async () => {
    const s = server();
    const { client } = openAssistant({ 'settings/assistant': s.get });
    const user = userEvent.setup();
    const b = await block();
    await user.selectOptions(providerField(b), 'Другой (свой адрес)');
    await user.clear(modelField(b));
    await user.type(modelField(b), 'my-model');
    await user.type(urlField(b), 'https://api.example.com/v1');
    await user.type(keyField(b), KEY);
    // на сервере тем временем что-то изменилось (другое устройство, новый запуск)
    s.set({ lastRun: LAST_RUN, llm: llm({ keyHint: 'ZZZZ' }) });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.assistant });
    });
    await within(b).findByText(/Трофимова С\./);
    expect(providerField(b)).toHaveValue('custom');
    expect(modelField(b)).toHaveValue('my-model');
    expect(urlField(b)).toHaveValue('https://api.example.com/v1');
    expect(keyField(b)).toHaveValue(KEY);
  });

  test('нетронутая форма, наоборот, подхватывает то, что изменилось на сервере', async () => {
    const s = server();
    const { client } = openAssistant({ 'settings/assistant': s.get });
    const b = await block();
    s.set({ llm: llm({ provider: 'openai', model: 'gpt-4o' }) });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.assistant });
    });
    await waitFor(() => expect(providerField(b)).toHaveValue('openai'));
    expect(modelField(b)).toHaveValue('gpt-4o');
  });

  test('«Убрать сохранённый ключ» спрашивает подтверждение, отмена ничего не отправляет', async () => {
    const { fetchMock } = openConnection();
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('button', { name: 'Убрать сохранённый ключ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Убрать сохранённый ключ?' });
    expect(dialog).toHaveTextContent('Сохранённый ключ будет удалён. Если в файле .env сервера есть ключ, будет использоваться он.');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждённое удаление шлёт apiKey: null с действующими провайдером и моделью, а несохранённую правку не трогает', async () => {
    const s = server();
    const { fetchMock } = openAssistant({
      'settings/assistant': s.get,
      'settings/assistant/llm': () => {
        s.set({ llm: llm({ keySet: true, keySource: 'env', keyHint: 'WXYZ' }) });
        return json({ ok: true });
      },
    });
    const user = userEvent.setup();
    const b = await block();
    // в форме набрано другое: на удаление ключа это влиять не должно
    await user.selectOptions(providerField(b), 'OpenAI');
    await user.click(within(b).getByRole('button', { name: 'Убрать сохранённый ключ' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Убрать ключ' }));
    await within(b).findByText('Сохранённый ключ удалён.');
    expect(llmPosts(fetchMock)).toEqual([{ path: 'settings/assistant/llm', body: { provider: 'deepseek', model: 'deepseek-chat', apiKey: null } }]);
    await waitFor(() => expect(getsOf(fetchMock, 'settings/assistant')).toBe(2));
    expect(within(b).getByText(/Ключ задан в файле .env на сервере: ••••••••WXYZ/)).toBeInTheDocument();
    expect(providerField(b)).toHaveValue('openai');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('ошибка при удалении ключа остаётся в окне, а окно не закрывается', async () => {
    openConnection(view(), { 'settings/assistant/llm': () => json({ error: 'forbidden', message: 'Нет доступа' }, 403) });
    const user = userEvent.setup();
    const b = await block();
    await user.click(within(b).getByRole('button', { name: 'Убрать сохранённый ключ' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Убрать ключ' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет прав менять подключение.');
  });

  test('сайт открыт по http: рядом с полем ключа предупреждение, а само поле остаётся рабочим', async () => {
    atProtocol('http:');
    openConnection();
    const user = userEvent.setup();
    const b = await block();
    const note = within(b).getByRole('note');
    expect(note).toHaveTextContent(
      'Сайт открыт по http: ключ при вводе передаётся без шифрования. Заведите у провайдера ключ с лимитом расходов; если ключ мог попасть к посторонним, отзовите его и введите новый.',
    );
    expect(keyField(b)).toHaveAccessibleDescription(/Сайт открыт по http/);
    expect(keyField(b)).toBeEnabled();
    await user.type(keyField(b), 'k');
    expect(keyField(b)).toHaveValue('k');
    expect(within(b).getByRole('note')).toBeInTheDocument();
  });

  test('сайт открыт по https: предупреждения о шифровании нет', async () => {
    atProtocol('https:');
    openConnection();
    const b = await block();
    expect(within(b).queryByRole('note')).not.toBeInTheDocument();
    expect(b).not.toHaveTextContent('без шифрования');
  });

  test('обычный вход не видит подключения: раздела нет, поля ключа в странице тоже', async () => {
    openAssistant({}, 'admin');
    await screen.findByText(/Распределено/);
    await act(async () => {});
    expect(screen.queryByLabelText('Ключ доступа')).not.toBeInTheDocument();
  });
});

describe('«Настройки»: isInsecurePage', () => {
  test('только http считается открытым; https и прочее — нет', async () => {
    const { isInsecurePage } = await import('./model');
    atProtocol('http:');
    expect(isInsecurePage()).toBe(true);
    atProtocol('https:');
    expect(isInsecurePage()).toBe(false);
  });
});
