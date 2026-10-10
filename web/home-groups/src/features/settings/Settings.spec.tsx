import type { AuditEntry, HealthMetric, PromptBlock, SettingsHealthView, SettingsPromptsView } from '@contracts';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildSettingsAudit, buildSettingsErrors, buildSettingsHealth, buildSettingsPrompts } from '../../fixtures/settings';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { settingsKeys } from './queries';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Overrides = Parameters<typeof stubFetchWithFixtures>[0];
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

/** Открывает приложение на нужном разделе настроек; по умолчанию вход полный. */
function openSettings(sec: string | null, overrides: Overrides = {}, role: 'admin' | 'super' = 'super') {
  const client = makeClient();
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, sec ? `/?tab=settings&sec=${sec}` : '/?tab=settings', client);
  return { fetchMock, client };
}

describe('вкладка «Настройки»', () => {
  test('у полного входа вкладка «Настройки» есть, и открывается раздел «Состояние сервера»', async () => {
    openSettings(null);
    const tabs = screen.getByRole('tablist', { name: 'Разделы' });
    expect(await within(tabs).findByRole('tab', { name: 'Настройки' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Общее состояние' })).toBeInTheDocument();
  });

  test('у обычного входа вкладки «Настройки» нет', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    renderAt(<App />, '/');
    await screen.findByText(/Распределено/);
    await act(async () => {});
    expect(screen.queryByRole('tab', { name: 'Настройки' })).not.toBeInTheDocument();
  });

  test('пока роль неизвестна, вкладки «Настройки» нет', async () => {
    stubFetchWithFixtures({ me: () => new Promise<Response>(() => {}) });
    renderAt(<App />, '/');
    await screen.findByText(/Распределено/);
    expect(screen.queryByRole('tab', { name: 'Настройки' })).not.toBeInTheDocument();
  });

  test('если обычный вход ввёл адрес вкладки вручную, его возвращает на «Сегодня»', async () => {
    const { fetchMock } = openSettings(null, {}, 'admin');
    expect(await screen.findByText('Спрос и предложение по районам')).toBeInTheDocument();
    expect(currentSearch().get('tab')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Общее состояние' })).not.toBeInTheDocument();
    // Данных настроек обычный вход не запрашивал вовсе.
    expect(callsOf(fetchMock).some((c) => c.path.startsWith('settings/'))).toBe(false);
  });

  test('у вкладки «Настройки» стрелка вправо с «Справочника» ведёт на неё', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    const user = userEvent.setup();
    await screen.findByRole('tab', { name: 'Настройки' });
    screen.getByRole('tab', { name: 'Справочник' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Настройки' })).toHaveAttribute('aria-selected', 'true');
  });

  test('внутренний раздел запоминается в адресе, а «Состояние сервера» в адрес не пишется', async () => {
    openSettings(null);
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Разделы настроек' });
    await user.click(within(nav).getByRole('button', { name: 'Журнал ошибок' }));
    expect(currentSearch().get('sec')).toBe('errors');
    expect(within(nav).getByRole('button', { name: 'Журнал ошибок' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(nav).getByRole('button', { name: 'Состояние сервера' }));
    expect(currentSearch().get('sec')).toBeNull();
  });
});

describe('«Состояние сервера»', () => {
  const metric = (over: Partial<HealthMetric>): HealthMetric => ({
    key: 'disk',
    label: 'Диск',
    status: 'ok',
    value: '41 ГБ свободно из 80 ГБ',
    hint: 'Подсказка',
    percent: 49,
    ...over,
  });
  const health = (overall: SettingsHealthView['overall'], metrics: HealthMetric[]): SettingsHealthView => ({
    ...buildSettingsHealth(),
    overall,
    metrics,
  });

  test('общее состояние названо словом, а у каждой метрики статус написан текстом, не только цветом', async () => {
    openSettings(null, {
      'settings/health': () =>
        json(
          health('crit', [
            metric({ key: 'disk', label: 'Диск', status: 'crit', value: '3 ГБ свободно из 80 ГБ' }),
            metric({ key: 'memory', label: 'Память', status: 'warn', value: '1,4 ГБ свободно' }),
            metric({ key: 'cpu', label: 'Процессор', status: 'ok', value: 'Занят на 18 %', percent: 18 }),
          ]),
        ),
    });
    const overall = await screen.findByRole('region', { name: 'Общее состояние' });
    expect(within(overall).getByText('Критично')).toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Метрики сервера' })).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText('Диск')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Критично')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('3 ГБ свободно из 80 ГБ')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Внимание')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('В норме')).toBeInTheDocument();
  });

  test('полоса есть только у метрик с процентом, и подпись у неё — название метрики', async () => {
    openSettings(null, {
      'settings/health': () =>
        json(
          health('ok', [
            metric({ key: 'disk', label: 'Диск', percent: 49 }),
            metric({ key: 'database', label: 'База данных', percent: null, value: 'Отвечает за 4 мс' }),
          ]),
        ),
    });
    const bar = await screen.findByRole('meter', { name: 'Диск' });
    expect(bar).toHaveAttribute('aria-valuenow', '49');
    expect(screen.queryByRole('meter', { name: 'База данных' })).not.toBeInTheDocument();
  });

  test('подсказка метрики показана, чтобы было понятно, что считать нормой', async () => {
    openSettings(null, { 'settings/health': () => json(health('ok', [metric({ hint: 'Норма — до 70 %' })])) });
    expect(await screen.findByText('Норма — до 70 %')).toBeInTheDocument();
  });

  test('раздел сам перечитывается раз в 30 секунд и не делает этого в скрытой вкладке браузера', async () => {
    const { client } = openSettings(null);
    await screen.findByRole('region', { name: 'Общее состояние' });
    // Параметры опроса лежат у наблюдателя запроса (того, кто сейчас смотрит на экран).
    const options = client.getQueryCache().find({ queryKey: settingsKeys.health })?.observers[0]?.options;
    expect(options?.refetchInterval).toBe(30_000);
    // Фоновое обновление выключено: в скрытой вкладке запросы не уходят.
    expect(options?.refetchIntervalInBackground).toBeFalsy();
  });

  test('«Обновить» перечитывает состояние сервера', async () => {
    const { fetchMock } = openSettings(null);
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Общее состояние' });
    expect(getsOf(fetchMock, 'settings/health')).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(getsOf(fetchMock, 'settings/health')).toBe(2));
  });

  test('если сервер ответил 403, раздел говорит, что доступа нет', async () => {
    openSettings(null, { 'settings/health': () => new Response('{}', { status: 403 }) });
    expect(await screen.findByText('Нет доступа к этому разделу.')).toBeInTheDocument();
  });
});

describe('«Журнал ошибок»', () => {
  test('записи показаны со временем, сервисом, текстом и контекстом', async () => {
    openSettings('errors');
    const list = await screen.findByRole('list', { name: 'Записи об ошибках' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(buildSettingsErrors().items.length);
    expect(within(rows[0]!).getByText('домашние группы')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/группа ДГ-0012 уже закрыта/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('POST /api/v1/requests/12/approve')).toBeInTheDocument();
    expect(rows[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-10-09T09:12:08+03:00');
  });

  test('когда ошибок нет, написано «Ошибок нет»', async () => {
    openSettings('errors', { 'settings/errors': () => json({ generatedAt: '2026-10-09T09:30:00+03:00', items: [] }) });
    expect(await screen.findByText('Ошибок нет')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Записи об ошибках' })).not.toBeInTheDocument();
  });

  test('фильтр по сервису оставляет только его записи', async () => {
    openSettings('errors');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Записи об ошибках' });
    await user.selectOptions(screen.getByLabelText('Сервис'), 'бот');
    const rows = within(screen.getByRole('list', { name: 'Записи об ошибках' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText('бот')).toBeInTheDocument();
  });

  test('поиск ищет по тексту и контексту, а если ничего нет, так и пишет', async () => {
    openSettings('errors');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Записи об ошибках' });
    const box = screen.getByRole('searchbox', { name: 'Поиск по ошибкам' });
    await user.type(box, 'prompts/save');
    expect(within(screen.getByRole('list', { name: 'Записи об ошибках' })).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(box);
    await user.type(box, 'такого нет нигде');
    expect(screen.queryByRole('list', { name: 'Записи об ошибках' })).not.toBeInTheDocument();
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument();
  });
});

describe('«Журнал регистрации»', () => {
  const dataRows = () => within(screen.getByRole('table', { name: 'Журнал регистрации' })).getAllByRole('row').slice(1);

  test('таблица показывает время, автора, действие, объект и примечание', async () => {
    openSettings('audit');
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    const rows = dataRows();
    expect(rows).toHaveLength(buildSettingsAudit().items.length);
    const first = within(rows[0]!);
    expect(first.getByText('mbv_admin')).toBeInTheDocument();
    expect(first.getByText('Утвердил заявку')).toBeInTheDocument();
    expect(first.getByText('заявка №12')).toBeInTheDocument();
    expect(rows[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-10-09T09:20:14+03:00');
    expect(within(rows[1]!).getByText('Причина: время')).toBeInTheDocument();
  });

  test('фильтр по действию оставляет только такие записи', async () => {
    openSettings('audit');
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    await user.selectOptions(screen.getByLabelText('Действие'), 'Утвердил заявку');
    const rows = dataRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText('Утвердил заявку')).toBeInTheDocument();
  });

  test('фильтр по автору оставляет только его записи', async () => {
    openSettings('audit');
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    await user.selectOptions(screen.getByLabelText('Автор'), 'super_mbv_admin');
    expect(dataRows()).toHaveLength(2);
  });

  test('поиск по номеру заявки находит все записи про эту заявку', async () => {
    openSettings('audit');
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    await user.type(screen.getByRole('searchbox', { name: 'Номер заявки' }), '12');
    const rows = dataRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText('заявка №12')).toBeInTheDocument();
  });

  test('если по фильтрам ничего нет, показывается «Ничего не найдено.» и работает «Сбросить»', async () => {
    openSettings('audit');
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    await user.type(screen.getByRole('searchbox', { name: 'Номер заявки' }), '999');
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(dataRows()).toHaveLength(buildSettingsAudit().items.length);
  });

  test('«было → стало» раскрывается и показано парами «поле: значение», а не сырым JSON', async () => {
    openSettings('audit');
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    const toggle = within(dataRows()[0]!).getByRole('button', { name: /Что изменилось/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Было' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const was = within(screen.getByRole('region', { name: 'Было' })).getAllByRole('listitem').map((li) => li.textContent);
    const became = within(screen.getByRole('region', { name: 'Стало' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(was).toEqual(['status: открыта', 'group: —']);
    expect(became).toEqual(['status: исполнена', 'group: ДГ-0007']);
    expect(document.body.textContent).not.toMatch(/[{}]|"status"/);
    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'Было' })).not.toBeInTheDocument();
  });

  test('если «было» нет (запись создана), раздел «Было» говорит «нет данных», а «Стало» показано', async () => {
    const created: AuditEntry = {
      ...buildSettingsAudit().items[2]!,
      before: null,
      after: { предложено: 4, вложено: { a: 1, b: [true, false] } },
    };
    openSettings('audit', { 'settings/audit': () => json({ generatedAt: '2026-10-09T09:30:00+03:00', items: [created] }) });
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Журнал регистрации' });
    await user.click(screen.getByRole('button', { name: /Что изменилось/ }));
    expect(within(screen.getByRole('region', { name: 'Было' })).getByText('нет данных')).toBeInTheDocument();
    const became = within(screen.getByRole('region', { name: 'Стало' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(became).toEqual(['предложено: 4', 'вложено: a: 1, b: да, нет']);
  });
});

describe('«Инструкции агентов»', () => {
  const principles = () => screen.findByRole('region', { name: 'Принципы' });
  const textboxOf = (block: HTMLElement) => within(block).getByRole('textbox', { name: 'Текст инструкции' }) as HTMLTextAreaElement;

  /** Ответы на чтение инструкций: после сохранения «сервер» отдаёт обновлённый текст блока «Принципы». */
  function promptsServer() {
    let view: SettingsPromptsView = buildSettingsPrompts();
    return {
      get: () => json(view),
      setBlock(patch: Partial<PromptBlock>) {
        view = {
          ...view,
          agents: view.agents.map((a) => ({ ...a, blocks: a.blocks.map((b) => (b.key === 'principles' ? { ...b, ...patch } : b)) })),
        };
      },
    };
  }

  test('у агента показана модель, а у блока — заголовок, назначение и пометка «по умолчанию»', async () => {
    openSettings('prompts');
    expect(await screen.findByText(/Модель: Claude Sonnet/)).toBeInTheDocument();
    const role = await screen.findByRole('region', { name: 'Роль' });
    expect(within(role).getByText('Кто такой агент и чем он занимается.')).toBeInTheDocument();
    expect(within(role).getByText('по умолчанию')).toBeInTheDocument();
    const block = await principles();
    expect(within(block).queryByText('по умолчанию')).not.toBeInTheDocument();
    expect(textboxOf(block).value).toMatch(/^Бережно относись к людям/);
  });

  test('у служебного блока нет поля ввода: он только для чтения, и сказано почему', async () => {
    openSettings('prompts');
    const service = await screen.findByRole('region', { name: 'Служебные правила' });
    expect(within(service).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(service).queryByRole('button', { name: /Сохранить/ })).not.toBeInTheDocument();
    expect(within(service).getByText('Задаётся кодом и здесь не меняется')).toBeInTheDocument();
    expect(within(service).getByText(/Отвечай только JSON по схеме proposal/)).toBeInTheDocument();
  });

  test('список версий: номер, автор, комментарий, пометка «действует», кнопка отката только у недействующих', async () => {
    openSettings('prompts');
    const block = await principles();
    const versions = within(within(block).getByRole('list', { name: 'Версии' })).getAllByRole('listitem');
    expect(versions).toHaveLength(3);
    expect(within(versions[0]!).getByText('Версия 3')).toBeInTheDocument();
    expect(within(versions[0]!).getByText('действует')).toBeInTheDocument();
    expect(within(versions[0]!).getByText(/super_mbv_admin/)).toBeInTheDocument();
    expect(within(versions[0]!).getByText(/Добавил про возраст/)).toBeInTheDocument();
    expect(within(versions[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(versions[1]!).getByRole('button', { name: 'Сделать действующей версию 2' })).toBeInTheDocument();
    expect(within(versions[1]!).queryByText('действует')).not.toBeInTheDocument();
  });

  test('«Сохранить новой версией» отключена, пока текст не менялся или стал пустым', async () => {
    openSettings('prompts');
    const user = userEvent.setup();
    const block = await principles();
    const save = within(block).getByRole('button', { name: 'Сохранить новой версией' });
    expect(save).toBeDisabled();
    await user.type(textboxOf(block), ' Ещё.');
    expect(save).toBeEnabled();
    await user.clear(textboxOf(block));
    expect(save).toBeDisabled();
    // Вернули ровно прежний текст — менять нечего.
    const original = buildSettingsPrompts().agents[0]!.blocks[1]!.text;
    await user.click(textboxOf(block));
    await user.paste(original);
    expect(save).toBeDisabled();
  });

  test('счётчик знаков следит за текстом, а поле ограничено 20 000 знаков и комментарий 200', async () => {
    openSettings('prompts');
    const user = userEvent.setup();
    const block = await principles();
    const box = textboxOf(block);
    expect(box).toHaveAttribute('maxlength', '20000');
    expect(within(block).getByRole('textbox', { name: /Комментарий к версии/ })).toHaveAttribute('maxlength', '200');
    await user.clear(box);
    await user.type(box, 'Три');
    expect(within(block).getByText('Знаков: 3 из 20 000')).toBeInTheDocument();
  });

  test('сохранение шлёт POST с агентом, блоком, текстом и комментарием, перечитывает инструкции и пишет подтверждение', async () => {
    const server = promptsServer();
    const { fetchMock } = openSettings('prompts', {
      'settings/prompts': server.get,
      'settings/prompts/save': () => {
        server.setBlock({ text: 'Новый текст принципов' });
        return json({ ok: true });
      },
    });
    const user = userEvent.setup();
    const block = await principles();
    await user.clear(textboxOf(block));
    await user.type(textboxOf(block), 'Новый текст принципов');
    await user.type(within(block).getByRole('textbox', { name: /Комментарий к версии/ }), '  Упростил ');
    expect(getsOf(fetchMock, 'settings/prompts')).toBe(1);
    await user.click(within(block).getByRole('button', { name: 'Сохранить новой версией' }));

    expect(await within(block).findByText('Сохранено новой версией. Она уже действует.')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([
      {
        path: 'settings/prompts/save',
        body: { agent: 'coordinator', block: 'principles', text: 'Новый текст принципов', note: 'Упростил' },
      },
    ]);
    expect(getsOf(fetchMock, 'settings/prompts')).toBe(2);
    // Правка принята: поле показывает уже серверный текст, а кнопка снова отключена.
    expect(textboxOf(block).value).toBe('Новый текст принципов');
    expect(within(block).getByRole('button', { name: 'Сохранить новой версией' })).toBeDisabled();
    expect(within(block).getByRole('textbox', { name: /Комментарий к версии/ })).toHaveValue('');
  });

  test('пустой комментарий в тело запроса не попадает', async () => {
    const { fetchMock } = openSettings('prompts', { 'settings/prompts/save': () => json({ ok: true }) });
    const user = userEvent.setup();
    const block = await principles();
    await user.type(textboxOf(block), ' Ещё.');
    await user.click(within(block).getByRole('button', { name: 'Сохранить новой версией' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(Object.keys(posts(fetchMock)[0]!.body as object).sort()).toEqual(['agent', 'block', 'text']);
  });

  test('правка в поле не теряется, когда список инструкций перечитывается по таймеру', async () => {
    const server = promptsServer();
    const { fetchMock, client } = openSettings('prompts', { 'settings/prompts': server.get });
    const user = userEvent.setup();
    const block = await principles();
    await user.clear(textboxOf(block));
    await user.type(textboxOf(block), 'Моя недописанная правка');
    await user.type(within(block).getByRole('textbox', { name: /Комментарий к версии/ }), 'черновик');

    // Фоновое чтение приносит другой текст блока: кто-то сохранил версию с другого устройства.
    server.setBlock({ text: 'Чужой текст с сервера' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.prompts });
    });
    await waitFor(() => expect(getsOf(fetchMock, 'settings/prompts')).toBe(2));

    expect(textboxOf(block).value).toBe('Моя недописанная правка');
    expect(within(block).getByRole('textbox', { name: /Комментарий к версии/ })).toHaveValue('черновик');
    expect(within(block).getByText(/текст на сервере изменился/)).toBeInTheDocument();
  });

  test('а пока человек ничего не правил, свежий текст с сервера подставляется', async () => {
    const server = promptsServer();
    const { client } = openSettings('prompts', { 'settings/prompts': server.get });
    const block = await principles();
    server.setBlock({ text: 'Свежий текст' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKeys.prompts });
    });
    await waitFor(() => expect(textboxOf(block).value).toBe('Свежий текст'));
  });

  test('откат: «Сделать действующей» спрашивает подтверждение, а после него шлёт activate и перечитывает инструкции', async () => {
    const server = promptsServer();
    const { fetchMock } = openSettings('prompts', {
      'settings/prompts': server.get,
      'settings/prompts/activate': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    const block = await principles();
    await user.click(within(block).getByRole('button', { name: 'Сделать действующей версию 2' }));

    const dialog = await screen.findByRole('dialog', { name: 'Сделать версию 2 действующей?' });
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Сделать действующей' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts(fetchMock)).toEqual([
      { path: 'settings/prompts/activate', body: { agent: 'coordinator', block: 'principles', version: 2 } },
    ]);
    expect(getsOf(fetchMock, 'settings/prompts')).toBe(2);
    expect(within(block).getByText('Версия 2 теперь действует.')).toBeInTheDocument();
  });

  test('если в окне отката нажать «Отмена», ничего не отправляется', async () => {
    const { fetchMock } = openSettings('prompts');
    const user = userEvent.setup();
    const block = await principles();
    await user.click(within(block).getByRole('button', { name: 'Сделать действующей версию 1' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
  });

  test('ошибка сохранения показывается понятным текстом по коду ответа', async () => {
    const cases: [string, () => Response | Promise<Response>, RegExp][] = [
      ['текст не принят', () => json({ error: 'bad_request', message: 'text too long' }, 400), /Сервер не принял текст/],
      ['нет прав', () => new Response('{}', { status: 403 }), /инструкции меняет только полный вход/],
      ['нет связи', () => Promise.reject(new TypeError('failed')), /Нет связи с сервером. Ничего не сохранено/],
    ];
    for (const [, respond, expected] of cases) {
      const { fetchMock } = openSettings('prompts', { 'settings/prompts/save': respond });
      const user = userEvent.setup();
      const block = await principles();
      await user.type(textboxOf(block), ' Ещё.');
      await user.click(within(block).getByRole('button', { name: 'Сохранить новой версией' }));
      const alert = await within(block).findByRole('alert');
      expect(alert).toHaveTextContent(expected);
      // Ошибка не стирает набранное: человек может исправить и повторить.
      expect(textboxOf(block).value).toMatch(/Ещё\.$/);
      expect(within(block).getByRole('button', { name: 'Сохранить новой версией' })).toBeEnabled();
      expect(posts(fetchMock)).toHaveLength(1);
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  test('ошибка отката показывается в самом окне, и окно остаётся открытым', async () => {
    openSettings('prompts', { 'settings/prompts/activate': () => json({ error: 'not_found', message: 'нет версии' }, 404) });
    const user = userEvent.setup();
    const block = await principles();
    await user.click(within(block).getByRole('button', { name: 'Сделать действующей версию 2' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Сделать действующей' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Версия не найдена/);
  });
});
