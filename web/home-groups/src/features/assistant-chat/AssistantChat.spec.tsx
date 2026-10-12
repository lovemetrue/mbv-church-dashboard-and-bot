import type { ChatOk } from '@contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { json, posts } from '../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const CHAT_ME = { role: 'super', assistant: { available: true, enabled: true, chat: true } };

const reply = (patch: Partial<ChatOk> = {}): ChatOk => ({
  ok: true,
  answer: 'В Приморском 7 групп при спросе на 4.',
  queries: [{ sql: 'select district, count(*) from groups group by 1', ok: true, rows: 2 }],
  tables: [
    {
      columns: ['Район', 'Групп', 'Ведущий'],
      rows: [
        ['Приморский', 7, 'Иванова А.'],
        ['Центр', 3, null],
      ],
      truncated: false,
    },
  ],
  ...patch,
});

type Overrides = Parameters<typeof stubFetchWithFixtures>[0];

const noHistory = () => json({ messages: [] });
const cleared = () => json({ ok: true });

/** По умолчанию история пуста, а очистка удаётся: тесты про другое не должны зависеть от демо-разговора. */
function open(overrides: Overrides = {}, me: unknown = CHAT_ME, url = '/') {
  const fetchMock = stubFetchWithFixtures({
    me: () => json(me),
    'assistant/chat/history': noHistory,
    'assistant/chat/clear': cleared,
    ...overrides,
  });
  renderAt(<App />, url);
  return fetchMock;
}

/** Ждём, пока «me» прочитан и применён: иначе проверка «кнопки нет» прошла бы, не дождавшись ответа сервера. */
async function meSettled(fetchMock: ReturnType<typeof stubFetchWithFixtures>) {
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/me'))).toBe(true));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

const fab = () => screen.findByRole('button', { name: 'Помощник' });
const dialog = () => screen.getByRole('dialog', { name: 'Помощник' });
const field = () => within(dialog()).getByRole('textbox', { name: 'Вопрос помощнику' });

async function openPanel(user = userEvent.setup()) {
  await user.click(await fab());
  return user;
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(field(), `${text}{Enter}`);
}

const sentChat = (fetchMock: ReturnType<typeof stubFetchWithFixtures>) => posts(fetchMock).filter((p) => p.path === 'assistant/chat');
const sentClear = (fetchMock: ReturnType<typeof stubFetchWithFixtures>) => posts(fetchMock).filter((p) => p.path === 'assistant/chat/clear');
const historyGets = (fetchMock: ReturnType<typeof stubFetchWithFixtures>) =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/assistant/chat/history')).length;

describe('кнопка «Помощник»', () => {
  test('показывается, когда сервер сказал, что чат доступен', async () => {
    open();
    expect(await fab()).toBeInTheDocument();
  });

  test('у кнопки видно «✦ Помощник», а доступное имя — просто «Помощник»', async () => {
    open();
    const button = await fab();
    expect(button).toHaveTextContent('✦ Помощник');
    expect(button).toHaveAccessibleName('Помощник');
  });

  test('не показывается, если чат недоступен (ключа нет или помощник выключен)', async () => {
    const fetchMock = open({}, { role: 'super', assistant: { available: true, enabled: false, chat: false } });
    await meSettled(fetchMock);
    expect(screen.queryByRole('button', { name: 'Помощник' })).not.toBeInTheDocument();
  });

  test('не показывается, если сервер не прислал сведений о помощнике', async () => {
    const fetchMock = open({}, { role: 'admin' });
    await meSettled(fetchMock);
    expect(screen.queryByRole('button', { name: 'Помощник' })).not.toBeInTheDocument();
  });

  test('не показывается на странице регистрации для волонтёров', async () => {
    // Страница регистрации самой «me» не читает; если бы кнопка там была, она читала бы её сама. Поэтому ждём ответа и там.
    const fetchMock = open({}, CHAT_ME, '/registration');
    await screen.findByRole('heading', { level: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/me'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Помощник' })).not.toBeInTheDocument();
  });

  test('остаётся на других вкладках', async () => {
    open({}, CHAT_ME, '/?tab=team');
    expect(await fab()).toBeInTheDocument();
  });
});

describe('окно помощника: открытие и закрытие', () => {
  test('по клику открывается окно «Помощник» с подписью, и фокус уходит в поле вопроса', async () => {
    open();
    await openPanel();
    const d = dialog();
    expect(within(d).getByRole('heading', { name: 'Помощник' })).toBeInTheDocument();
    expect(d).toHaveTextContent('Ищет в базе · только читает');
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute('placeholder', 'Спросите о группах, людях, заявках');
  });

  test('кнопка открывается и с клавиатуры: Enter и пробел', async () => {
    open();
    const user = userEvent.setup();
    const button = await fab();
    button.focus();
    await user.keyboard('{Enter}');
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Помощник' })).not.toBeInTheDocument();
    (await fab()).focus();
    await user.keyboard(' ');
    expect(dialog()).toBeInTheDocument();
  });

  test('Esc закрывает окно, а фокус возвращается на кнопку', async () => {
    open();
    const user = await openPanel();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Помощник' })).not.toBeInTheDocument();
    expect(await fab()).toHaveFocus();
  });

  test('«✕» закрывает окно, а фокус возвращается на кнопку', async () => {
    open();
    const user = await openPanel();
    await user.click(within(dialog()).getByRole('button', { name: 'Закрыть помощника' }));
    expect(screen.queryByRole('dialog', { name: 'Помощник' })).not.toBeInTheDocument();
    expect(await fab()).toHaveFocus();
  });

  test('Esc в окне помощника не закрывает открытую под ним карточку заявки', async () => {
    open({}, CHAT_ME, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    const user = userEvent.setup();
    await user.click(await fab());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Помощник' })).not.toBeInTheDocument();
    expect(card).toBeInTheDocument();
    expect(currentSearch().get('req')).toBe('1');
  });
});

describe('вопросы и подсказки', () => {
  test('первое сообщение без рода, под ним шесть подсказок', async () => {
    open();
    await openPanel();
    const d = dialog();
    expect(d).toHaveTextContent('Здравствуйте! Я ищу по базе и отвечаю на вопросы. Ничего не меняю: только читаю.');
    const chips = within(within(d).getByRole('group', { name: 'Примеры вопросов' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual([
      'В каком районе перебор групп?',
      'Где не хватает групп?',
      'Кто ведёт несколько групп?',
      'Группы без обратной связи больше 30 дней',
      'Сколько заявок ждёт больше недели?',
      'Какие группы без дня и времени?',
    ]);
  });

  test('нажатие на подсказку отправляет этот вопрос, и подсказки уходят', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Где не хватает групп?' }));
    expect(await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.')).toBeInTheDocument();
    expect(sentChat(fetchMock)).toEqual([
      { path: 'assistant/chat', body: { message: 'Где не хватает групп?' } },
    ]);
    expect(screen.queryByRole('group', { name: 'Примеры вопросов' })).not.toBeInTheDocument();
    // Вопрос остался в разговоре.
    expect(within(dialog()).getByText('Где не хватает групп?')).toBeInTheDocument();
  });

  test('Enter отправляет вопрос и очищает поле', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await ask(user, 'Сколько групп?');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    expect(sentChat(fetchMock)).toHaveLength(1);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
  });

  test('Shift+Enter переносит строку и ничего не отправляет', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await user.type(field(), 'первая{Shift>}{Enter}{/Shift}вторая');
    expect(field()).toHaveValue('первая\nвторая');
    expect(sentChat(fetchMock)).toHaveLength(0);
  });

  test('пустой и пробельный вопрос не отправляется, кнопка неактивна', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    const send = within(dialog()).getByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled();
    await user.type(field(), '   {Enter}');
    expect(sentChat(fetchMock)).toHaveLength(0);
    expect(send).toBeDisabled();
  });

  test('пока идёт запрос, видно «Ищу в базе…», поле и кнопка неактивны, а повторные отправки не уходят', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = open({ 'assistant/chat': () => new Promise<Response>((resolve) => (release = resolve)) });
    const user = await openPanel();
    await user.type(field(), 'Что с группами?');
    const send = within(dialog()).getByRole('button', { name: 'Отправить' });
    await user.click(send);
    await user.click(send);
    fireEvent.keyDown(field(), { key: 'Enter' });
    const status = within(dialog()).getByRole('status');
    expect(status).toHaveTextContent('Ищу в базе…');
    expect(field()).toBeDisabled();
    expect(send).toBeDisabled();
    expect(sentChat(fetchMock)).toHaveLength(1);
    await act(async () => release(json(reply())));
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    expect(within(dialog()).getByRole('status')).toBeEmptyDOMElement();
    expect(field()).toBeEnabled();
    expect(field()).toHaveFocus();
  });

  test('поле ограничено 2000 знаков, счётчик появляется при приближении к пределу', async () => {
    open();
    await openPanel();
    expect(field()).toHaveAttribute('maxlength', '2000');
    expect(within(dialog()).queryByText(/из 2000/)).not.toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'а'.repeat(1850) } });
    expect(within(dialog()).getByText('1850 из 2000')).toBeInTheDocument();
  });
});

describe('ответ помощника', () => {
  test('под текстом ответа стоит таблица с точными строками, пустое значение показано тире', async () => {
    const user = await (async () => {
      open({ 'assistant/chat': () => json(reply()) });
      return openPanel();
    })();
    await ask(user, 'перебор');
    const region = await within(dialog()).findByRole('region', { name: 'Таблица' });
    const table = within(region).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Район', 'Групп', 'Ведущий']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Приморский', '7', 'Иванова А.'],
      ['Центр', '3', '—'],
    ]);
    // Прокручивается блок таблицы, а не страница.
    expect(region).toHaveAttribute('tabindex', '0');
  });

  test('если строк в базе больше, чем показано, под таблицей подпись про первые 100', async () => {
    open({ 'assistant/chat': () => json(reply({ tables: [{ columns: ['a'], rows: [[1]], truncated: true }] })) });
    const user = await openPanel();
    await ask(user, 'много');
    expect(await within(dialog()).findByText('Показаны первые 100 строк')).toBeInTheDocument();
  });

  test('без таблиц блока таблицы нет, и подписи про 100 строк тоже', async () => {
    open({ 'assistant/chat': () => json(reply({ tables: [] })) });
    const user = await openPanel();
    await ask(user, 'текстом');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    expect(within(dialog()).queryByRole('table')).not.toBeInTheDocument();
    expect(within(dialog()).queryByText('Показаны первые 100 строк')).not.toBeInTheDocument();
  });

  test('две таблицы подписаны по номерам', async () => {
    const t = { columns: ['a'], rows: [[1]], truncated: false };
    open({ 'assistant/chat': () => json(reply({ tables: [t, t] })) });
    const user = await openPanel();
    await ask(user, 'две');
    expect(await within(dialog()).findByRole('region', { name: 'Таблица 1 из 2' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('region', { name: 'Таблица 2 из 2' })).toBeInTheDocument();
  });

  test('блок «Как посмотрел» свёрнут и перечисляет запросы: sql, число строк, ошибки неудачных', async () => {
    open({
      'assistant/chat': () =>
        json(
          reply({
            queries: [
              { sql: 'select 1', ok: true, rows: 1 },
              { sql: 'select oops', ok: false, rows: 0, error: 'нет такого столбца' },
              { sql: 'select 22', ok: true, rows: 22 },
            ],
          }),
        ),
    });
    const user = await openPanel();
    await ask(user, 'как');
    const summary = await within(dialog()).findByText('Как посмотрел');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    const items = within(details).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('code')).toHaveTextContent('select 1');
    expect(items[0]).toHaveTextContent('1 строка');
    expect(items[1]).toHaveTextContent('не получилось: нет такого столбца');
    expect(items[1]).not.toHaveTextContent('0 строк');
    expect(items[2]).toHaveTextContent('22 строки');
  });

  test('«Скопировать ответ» кладёт в буфер текст и таблицу и подтверждает это', async () => {
    open({ 'assistant/chat': () => json(reply()) });
    // userEvent.setup() подставляет свой буфер обмена, из которого его же и читаем.
    const user = await openPanel();
    await ask(user, 'копия');
    await user.click(await within(dialog()).findByRole('button', { name: 'Скопировать ответ' }));
    expect(await navigator.clipboard.readText()).toBe(
      'В Приморском 7 групп при спросе на 4.\n\nРайон\tГрупп\tВедущий\nПриморский\t7\tИванова А.\nЦентр\t3\t—',
    );
    expect(await within(dialog()).findByText('Скопировано')).toBeInTheDocument();
  });
});

describe('ошибки', () => {
  const fail = (status: number, error: string, message: string) => () => json({ ok: false, error, message }, status);

  test('текст ошибки сервера виден в ответе с отметкой, вопрос остаётся в разговоре', async () => {
    open({ 'assistant/chat': fail(503, 'unavailable', 'Служба модели сейчас недоступна.') });
    const user = await openPanel();
    await ask(user, 'Что с группами?');
    expect(await within(dialog()).findByText('Служба модели сейчас недоступна.')).toBeInTheDocument();
    expect(within(dialog()).getByText('Ошибка')).toBeInTheDocument();
    expect(within(dialog()).getByText('Что с группами?')).toBeInTheDocument();
  });

  test('«Повторить» отправляет тот же вопрос ещё раз, не дублируя его, и ответ заменяет ошибку', async () => {
    let calls = 0;
    const fetchMock = open({
      'assistant/chat': () => (++calls === 1 ? fail(409, 'conflict', 'Слишком много вопросов, подождите минуту.')() : json(reply())),
    });
    const user = await openPanel();
    await ask(user, 'Что с группами?');
    await within(dialog()).findByText('Слишком много вопросов, подождите минуту.');
    await user.click(within(dialog()).getByRole('button', { name: 'Повторить' }));
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    expect(sentChat(fetchMock).map((p) => p.body)).toEqual([{ message: 'Что с группами?' }, { message: 'Что с группами?' }]);
    expect(within(dialog()).queryByText('Слишком много вопросов, подождите минуту.')).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    expect(within(dialog()).getAllByText('Что с группами?')).toHaveLength(1);
  });

  test('если сервера не достать, говорится про связь, а вопрос остаётся для повтора', async () => {
    open({ 'assistant/chat': () => Promise.reject(new TypeError('fail')) });
    const user = await openPanel();
    await ask(user, 'Что с группами?');
    expect(await within(dialog()).findByText('Нет связи с сервером. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Повторить' })).toBeEnabled();
  });

  test('«выключен»: полному входу даётся ссылка «Настройки → Помощник», она открывает этот раздел', async () => {
    open({ 'assistant/chat': fail(503, 'unavailable', 'Помощник выключен в настройках.') });
    const user = await openPanel();
    await ask(user, 'Привет');
    await within(dialog()).findByText('Помощник выключен в настройках.');
    await user.click(within(dialog()).getByRole('button', { name: 'Настройки → Помощник' }));
    expect(currentSearch().get('tab')).toBe('settings');
    expect(currentSearch().get('sec')).toBe('assistant');
  });

  test('«выключен»: обычному входу ссылки на «Настройки» не даётся, туда ему нельзя', async () => {
    open({ 'assistant/chat': fail(503, 'unavailable', 'Помощник выключен в настройках.') }, { role: 'admin', assistant: CHAT_ME.assistant });
    const user = await openPanel();
    await ask(user, 'Привет');
    await within(dialog()).findByText('Помощник выключен в настройках.');
    expect(within(dialog()).queryByRole('button', { name: 'Настройки → Помощник' })).not.toBeInTheDocument();
  });

  test('другая ошибка 503 ссылки на настройки не показывает', async () => {
    open({ 'assistant/chat': fail(503, 'unavailable', 'Служба модели сейчас недоступна.') });
    const user = await openPanel();
    await ask(user, 'Привет');
    await within(dialog()).findByText('Служба модели сейчас недоступна.');
    expect(within(dialog()).queryByRole('button', { name: 'Настройки → Помощник' })).not.toBeInTheDocument();
  });
});

describe('разговор', () => {
  test('каждый вопрос уходит один, без прошлых ходов: историю сервер знает сам', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await ask(user, 'Первый');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await ask(user, 'Второй');
    await waitFor(() => expect(sentChat(fetchMock)).toHaveLength(2));
    expect(sentChat(fetchMock).map((p) => p.body)).toEqual([{ message: 'Первый' }, { message: 'Второй' }]);
  });

  test('разговор живёт в памяти страницы: закрыли и открыли окно — он на месте', async () => {
    open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await ask(user, 'Запомни');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await user.keyboard('{Escape}');
    await user.click(await fab());
    expect(within(dialog()).getByText('Запомни')).toBeInTheDocument();
    expect(within(dialog()).getByText('В Приморском 7 групп при спросе на 4.')).toBeInTheDocument();
  });

  test('ни вопросы, ни ответы не записываются в хранилище браузера: в них настоящие имена', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    await ask(user, 'Секретный вопрос про Иванову');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    const written = setLocal.mock.calls.map((c) => `${c[0]} ${c[1]}`).join('\n');
    expect(written).not.toMatch(/Секретный вопрос|Иванов|Приморск/);
    for (const store of [window.localStorage, window.sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toMatch(/Секретный вопрос|Иванов|Приморск/);
    }
    setLocal.mockRestore();
  });

  test('«Очистить разговор» шлёт clear с пустым телом, убирает ходы и возвращает подсказки', async () => {
    const fetchMock = open({ 'assistant/chat': () => json(reply()) });
    const user = await openPanel();
    expect(within(dialog()).queryByRole('button', { name: 'Очистить разговор' })).not.toBeInTheDocument();
    await ask(user, 'Старое');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await user.click(within(dialog()).getByRole('button', { name: 'Очистить разговор' }));
    await waitFor(() => expect(within(dialog()).queryByText('Старое')).not.toBeInTheDocument());
    expect(sentClear(fetchMock)).toEqual([{ path: 'assistant/chat/clear', body: {} }]);
    expect(within(dialog()).getByRole('group', { name: 'Примеры вопросов' })).toBeInTheDocument();
    await ask(user, 'Новое');
    await waitFor(() => expect(sentChat(fetchMock)).toHaveLength(2));
    expect(sentChat(fetchMock)[1]!.body).toEqual({ message: 'Новое' });
  });

  test('пока clear в пути, разговор на экране остаётся, а второй клик ничего не шлёт', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = open({
      'assistant/chat': () => json(reply()),
      'assistant/chat/clear': () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const user = await openPanel();
    await ask(user, 'Старое');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    const clear = within(dialog()).getByRole('button', { name: 'Очистить разговор' });
    await user.click(clear);
    await user.click(clear);
    expect(within(dialog()).getByText('Старое')).toBeInTheDocument();
    expect(sentClear(fetchMock)).toHaveLength(1);
    await act(async () => release(json({ ok: true })));
    await waitFor(() => expect(within(dialog()).queryByText('Старое')).not.toBeInTheDocument());
  });

  test('если очистка не удалась, пишется ошибка, а разговор на экране остаётся нетронутым', async () => {
    const fetchMock = open({
      'assistant/chat': () => json(reply()),
      'assistant/chat/clear': () => json({ ok: false, error: 'unavailable', message: 'служебный текст' }, 503),
    });
    const user = await openPanel();
    await ask(user, 'Остаётся');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await user.click(within(dialog()).getByRole('button', { name: 'Очистить разговор' }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert).toHaveTextContent('Не получилось очистить разговор');
    expect(within(dialog()).getByText('Остаётся')).toBeInTheDocument();
    expect(within(dialog()).getByText('В Приморском 7 групп при спросе на 4.')).toBeInTheDocument();
    expect(within(dialog()).queryByRole('group', { name: 'Примеры вопросов' })).not.toBeInTheDocument();
    // можно повторить, и тогда ошибка уходит
    expect(within(dialog()).getByRole('button', { name: 'Очистить разговор' })).toBeEnabled();
    expect(sentClear(fetchMock)).toHaveLength(1);
  });

  test('при обрыве связи на очистке говорится про связь, разговор остаётся', async () => {
    open({ 'assistant/chat': () => json(reply()), 'assistant/chat/clear': () => Promise.reject(new TypeError('fail')) });
    const user = await openPanel();
    await ask(user, 'Остаётся');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await user.click(within(dialog()).getByRole('button', { name: 'Очистить разговор' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Нет связи с сервером');
    expect(within(dialog()).getByText('Остаётся')).toBeInTheDocument();
  });

  test('ответ, пришедший после «Очистить разговор», в пустой разговор не попадает', async () => {
    let release: (r: Response) => void = () => {};
    open({ 'assistant/chat': () => new Promise<Response>((resolve) => (release = resolve)) });
    const user = await openPanel();
    await ask(user, 'Долгий');
    await user.click(within(dialog()).getByRole('button', { name: 'Очистить разговор' }));
    await waitFor(() => expect(within(dialog()).queryByText('Долгий')).not.toBeInTheDocument());
    await act(async () => release(json(reply())));
    expect(within(dialog()).queryByText('В Приморском 7 групп при спросе на 4.')).not.toBeInTheDocument();
    expect(field()).toBeEnabled();
  });
});

describe('история разговора с сервера', () => {
  const HISTORY = {
    messages: [
      { role: 'user', content: 'Сколько групп у Ивановой?' },
      { role: 'assistant', content: 'У Ивановой А. две группы: №12 и №27.' },
    ],
  };

  test('при открытии окна читается история и показывается: вопросы справа, ответы слева, без таблиц и запросов', async () => {
    const fetchMock = open({ 'assistant/chat/history': () => json(HISTORY) });
    expect(historyGets(fetchMock)).toBe(0);
    await openPanel();
    expect(await within(dialog()).findByText('Сколько групп у Ивановой?')).toBeInTheDocument();
    expect(within(dialog()).getByText('У Ивановой А. две группы: №12 и №27.')).toBeInTheDocument();
    expect(historyGets(fetchMock)).toBe(1);
    expect(within(dialog()).queryByRole('table')).not.toBeInTheDocument();
    expect(within(dialog()).queryByText('Как посмотрел')).not.toBeInTheDocument();
    // разговор уже идёт: подсказки не нужны
    expect(within(dialog()).queryByRole('group', { name: 'Примеры вопросов' })).not.toBeInTheDocument();
  });

  test('пока история грузится, видно «Загружаю прошлый разговор…», подсказок ещё нет', async () => {
    let release: (r: Response) => void = () => {};
    open({ 'assistant/chat/history': () => new Promise<Response>((resolve) => (release = resolve)) });
    await openPanel();
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Загружаю прошлый разговор…');
    expect(within(dialog()).queryByRole('group', { name: 'Примеры вопросов' })).not.toBeInTheDocument();
    await act(async () => release(json(HISTORY)));
    await within(dialog()).findByText('Сколько групп у Ивановой?');
    expect(within(dialog()).getByRole('status')).toBeEmptyDOMElement();
  });

  test('пустая история: обычное приветствие с подсказками', async () => {
    open();
    await openPanel();
    expect(await within(dialog()).findByRole('group', { name: 'Примеры вопросов' })).toBeInTheDocument();
  });

  test('история читается один раз за сеанс: закрыли и открыли окно — повторного запроса нет, разговор на месте', async () => {
    const fetchMock = open({ 'assistant/chat/history': () => json(HISTORY) });
    const user = await openPanel();
    await within(dialog()).findByText('Сколько групп у Ивановой?');
    await user.keyboard('{Escape}');
    await user.click(await fab());
    expect(within(dialog()).getByText('Сколько групп у Ивановой?')).toBeInTheDocument();
    expect(historyGets(fetchMock)).toBe(1);
  });

  test('ошибка истории: сказано словами, подсказки на месте, вопрос задать можно', async () => {
    const fetchMock = open({
      'assistant/chat/history': () => json({ ok: false, error: 'unavailable', message: 'служебный текст' }, 500),
      'assistant/chat': () => json(reply()),
    });
    const user = await openPanel();
    const alert = await within(dialog()).findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить прошлый разговор');
    expect(alert).not.toHaveTextContent('служебный текст');
    expect(within(dialog()).getByRole('group', { name: 'Примеры вопросов' })).toBeInTheDocument();
    await ask(user, 'Всё равно спрошу');
    expect(await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.')).toBeInTheDocument();
    expect(sentChat(fetchMock)).toHaveLength(1);
    // вопрос уже в разговоре: предложение загрузить старое больше не нужно
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('«Загрузить ещё раз» повторяет чтение истории и показывает её', async () => {
    let calls = 0;
    const fetchMock = open({
      'assistant/chat/history': () => (++calls === 1 ? json({ error: 'unavailable' }, 500) : json(HISTORY)),
    });
    const user = await openPanel();
    await user.click(await within(dialog()).findByRole('button', { name: 'Загрузить ещё раз' }));
    expect(await within(dialog()).findByText('Сколько групп у Ивановой?')).toBeInTheDocument();
    expect(historyGets(fetchMock)).toBe(2);
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('если вопрос задан раньше, чем пришла история, запоздавшая история разговор не дублирует', async () => {
    let release: (r: Response) => void = () => {};
    open({
      'assistant/chat/history': () => new Promise<Response>((resolve) => (release = resolve)),
      'assistant/chat': () => json(reply()),
    });
    const user = await openPanel();
    await ask(user, 'Не стал ждать');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await act(async () => release(json({ messages: [{ role: 'user', content: 'Не стал ждать' }, { role: 'assistant', content: 'старый ответ' }] })));
    expect(within(dialog()).getAllByText('Не стал ждать')).toHaveLength(1);
    expect(within(dialog()).queryByText('старый ответ')).not.toBeInTheDocument();
  });

  test('история, пришедшая после «Очистить разговор», разговор не оживляет', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = open({
      'assistant/chat/history': () => new Promise<Response>((resolve) => (release = resolve)),
      'assistant/chat': () => json(reply()),
    });
    const user = await openPanel();
    await ask(user, 'Вопрос');
    await within(dialog()).findByText('В Приморском 7 групп при спросе на 4.');
    await user.click(within(dialog()).getByRole('button', { name: 'Очистить разговор' }));
    await waitFor(() => expect(sentClear(fetchMock)).toHaveLength(1));
    await act(async () => release(json(HISTORY)));
    expect(within(dialog()).queryByText('Сколько групп у Ивановой?')).not.toBeInTheDocument();
  });

  test('подпись «Помощник помнит последние 6 сообщений» привязана к полю вопроса', async () => {
    open();
    await openPanel();
    const note = within(dialog()).getByText('Помощник помнит последние 6 сообщений');
    expect(field().getAttribute('aria-describedby')).toContain(note.id);
  });

  test('история с настоящими именами не записывается в хранилище браузера', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    open({ 'assistant/chat/history': () => json(HISTORY) });
    await openPanel();
    await within(dialog()).findByText('Сколько групп у Ивановой?');
    const written = setLocal.mock.calls.map((c) => `${c[0]} ${c[1]}`).join('\n');
    expect(written).not.toMatch(/Иванов/);
    setLocal.mockRestore();
  });
});
