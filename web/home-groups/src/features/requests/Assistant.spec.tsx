import type { AssistantNote, AssistantStatus, RequestsView } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json, posts } from '../../test/calls';
import { openCard, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const RUN_OK = { ok: true, asked: 3, filled: 2, withQuestions: 1, proposals: 4, unanswered: 0 };
const runOk = () => json(RUN_OK);

/** В демо: три заявки ждут разбора, по одной (Станислав Ким) помощник не всё понял — на значке 4. */
const ICON = 'ИИ-разбор заявок — 4';

/** Очередь заявок с заданным состоянием помощника: так тест «получает от сервера» нужное. */
const viewAssistant = (assistant: Partial<AssistantStatus>): RequestsView => {
  const view = buildRequests();
  return { ...view, assistant: { ...view.assistant, ...assistant } };
};
const onlyWaiting = () => viewAssistant({ pending: 0, review: buildRequests().assistant.review.filter((i) => i.state === 'reviewed') });

let client = makeClient();
beforeEach(() => {
  client = makeClient();
});

async function openRequests(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, role: 'admin' | 'super' = 'admin') {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, '/?tab=requests', client);
  // ✦ живёт в строке инструментов «Заявок», рядом с кнопкой «Подбор».
  const block = await screen.findByRole('group', { name: 'Отбор списка заявок' });
  return { fetchMock, block };
}

/** Нажать значок ✦ в блоке подбора и дождаться окна помощника. */
async function openHelper(block: HTMLElement, name: string | RegExp = ICON) {
  const user = userEvent.setup();
  await user.click(await within(block).findByRole('button', { name }));
  const panel = await screen.findByRole('dialog', { name: 'Помощник' });
  return { user, panel };
}
/** Кнопки подбора — в окошке «Подбор»: открываем его, если ещё не открыто. */
async function matchBlock(): Promise<HTMLElement> {
  const open = screen.queryByRole('region', { name: 'Подбор для новых заявок' });
  if (open) return open;
  await userEvent.setup().click(screen.getByRole('button', { name: /^Подбор/ }));
  return screen.findByRole('region', { name: 'Подбор для новых заявок' });
}
const matchButton = async () => within(await matchBlock()).getByRole('button', { name: 'Предложить группы новым заявкам' });
const runButton = (panel: HTMLElement) => within(panel).getByRole('button', { name: /^Разобрать \(/ });

describe('«Заявки»: значок ✦ помощника в блоке подбора', () => {
  test('вместо широкой кнопки — значок с числом; подпись при наведении «ИИ-разбор заявок — 4»', async () => {
    const { block } = await openRequests();
    const icon = await within(block).findByRole('button', { name: ICON });
    expect(icon).toHaveAttribute('title', ICON);
    expect(icon).toHaveTextContent('4');
    expect(within(block).queryByRole('button', { name: /Попросить помощника/ })).not.toBeInTheDocument();
  });

  test('значок открывает окно помощника на вкладке «Разбор заявок»: сколько разберёт и что для этого прочитает', async () => {
    const { block } = await openRequests({ me: () => json({ role: 'admin', assistant: { available: true, enabled: true, chat: true } }) });
    const { panel } = await openHelper(block);
    expect(panel).toHaveTextContent('Нашёл 3 заявки, где скрипт не понял запись');
    expect(panel).toHaveTextContent('без имён и телефонов');
    expect(runButton(panel)).toHaveAccessibleName('Разобрать (3)');
    // Чат тоже доступен — переключиться можно вкладкой. Без чата вкладок нет совсем (как в остальных тестах здесь).
    expect(within(panel).getByRole('button', { name: 'Разбор заявок' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(within(panel).getByRole('button', { name: 'Вопрос по базе' }));
    const chat = await screen.findByRole('dialog', { name: 'Помощник' });
    expect(await within(chat).findByRole('textbox', { name: 'Вопрос помощнику' })).toBeInTheDocument();
  });

  test('где помощник не справился, он пишет, чего не понял и почему, показывает слова человека и вопросы', async () => {
    const { block } = await openRequests();
    const { panel } = await openHelper(block);
    const list = within(panel).getByRole('region', { name: 'Нужна ваша помощь · 1' });
    const card = within(list).getByRole('article', { name: 'Станислав Ким' });
    expect(card).toHaveTextContent('Не понял: район, время');
    expect(card).toHaveTextContent('Место: «где-то у Пионерской»');
    expect(card).toHaveTextContent('В записи «где-то у Пионерской» станция названа неуверенно, а дней и времени нет совсем.');
    expect(card).toHaveTextContent('Рядом с какой станцией метро вы живёте?');
  });

  test('без пояснения модели так и сказано, а не пусто', async () => {
    const [item] = buildRequests().assistant.review;
    const { block } = await openRequests({ requests: () => json(viewAssistant({ review: [{ ...item!, note: null }] })) });
    const { panel } = await openHelper(block, /^ИИ-разбор заявок/);
    expect(within(panel).getByRole('article', { name: 'Станислав Ким' })).toHaveTextContent('Пояснения нет: модель не объяснила');
  });

  test('ФИО в карточке разбора открывает заявку', async () => {
    const { block } = await openRequests();
    const { user, panel } = await openHelper(block);
    await user.click(within(panel).getByRole('button', { name: 'Открыть заявку: Станислав Ким' }));
    await waitFor(() => expect(document.querySelector('[data-testid="location"]')!.textContent).toContain('req=8'));
  });

  test('«Разобрать» шлёт POST assistant/run с пустым телом, пишет итог словами и перечитывает заявки, «Сегодня» и «Команду»', async () => {
    const { fetchMock, block } = await openRequests({ 'assistant/run': runOk });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { user, panel } = await openHelper(block);
    await user.click(runButton(panel));
    expect(
      await within(panel).findByText('Разобрал 3: определил данные по 2, вопросы для человека — по 1, после этого подбор предложил групп: 4. Где не справился, объяснил ниже почему.'),
    ).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'assistant/run', body: {} }]);
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([['requests'], ['today'], ['team']]));
  });

  test('если модель по части заявок не ответила, итог говорит, что они остались в очереди', async () => {
    const { block } = await openRequests({ 'assistant/run': () => json({ ...RUN_OK, unanswered: 2 }) });
    const { user, panel } = await openHelper(block);
    await user.click(runButton(panel));
    expect(await within(panel).findByText(/По 2 модель не ответила — они остались в очереди/)).toBeInTheDocument();
  });

  test('пока помощник работает, кнопки подбора неактивны, а второй запуск невозможен', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, block } = await openRequests({
      'assistant/run': async () => {
        await gate;
        return runOk();
      },
    });
    const { user, panel } = await openHelper(block);
    await user.dblClick(runButton(panel));
    expect(within(panel).getByRole('button', { name: 'Разбираю заявки…' })).toBeDisabled();
    expect(await matchButton()).toBeDisabled();
    expect(within(await matchBlock()).getByRole('button', { name: 'Пересчитать все предложения' })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await within(panel).findByText(/^Разобрал 3/);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(await matchButton()).toBeEnabled();
  });

  test('два нажатия до перерисовки тоже дают один запрос', async () => {
    const { fetchMock, block } = await openRequests({ 'assistant/run': runOk });
    const { panel } = await openHelper(block);
    const btn = runButton(panel);
    act(() => {
      btn.click();
      btn.click();
    });
    await within(panel).findByText(/^Разобрал 3/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('итог не теряется, если окно закрыли, пока шёл разбор', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { block } = await openRequests({ 'assistant/run': async () => { await gate; return runOk(); } });
    const { user, panel } = await openHelper(block);
    await user.click(runButton(panel));
    await user.click(within(panel).getByRole('button', { name: 'Закрыть помощника' }));
    release();
    await waitFor(async () => expect(await matchButton()).toBeEnabled());
    const again = await openHelper(block, /^ИИ-разбор заявок/);
    expect(await within(again.panel).findByText(/^Разобрал 3/)).toBeInTheDocument();
  });

  test('ошибка сервера показывается его словами, «Повторить» запускает снова', async () => {
    let calls = 0;
    const { fetchMock, block } = await openRequests({
      'assistant/run': () => {
        calls += 1;
        return calls === 1
          ? json({ error: 'unavailable', message: 'Помощник ответил не в том виде, который понимает сервис, поэтому разбор не записан.' }, 503)
          : runOk();
      },
    });
    const { user, panel } = await openHelper(block);
    await user.click(runButton(panel));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Помощник ответил не в том виде');
    await user.click(within(panel).getByRole('button', { name: 'Повторить' }));
    await within(panel).findByText(/^Разобрал 3/);
    expect(posts(fetchMock)).toHaveLength(2);
  });

  test('если до сервера не достучались, сказано про связь, а не «Ошибка 0»', async () => {
    const { block } = await openRequests({ 'assistant/run': () => Promise.reject(new TypeError('fetch failed')) });
    const { user, panel } = await openHelper(block);
    await user.click(runButton(panel));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Разбор не запущен, попробуйте ещё раз.');
  });

  test('новых непонятных записей нет — кнопки «Разобрать» нет, но заявки, где нужна помощь, видны', async () => {
    const { block } = await openRequests({ requests: () => json(onlyWaiting()) });
    const { panel } = await openHelper(block, 'ИИ-разбор заявок — 1');
    expect(panel).toHaveTextContent('Новых непонятных записей нет');
    expect(within(panel).queryByRole('button', { name: /^Разобрать/ })).not.toBeInTheDocument();
    expect(within(panel).getByRole('article', { name: 'Станислав Ким' })).toBeInTheDocument();
  });

  test('разбирать нечего — значок без числа, а окно объясняет почему', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ pending: 0, review: [] })) });
    const { panel } = await openHelper(block, 'ИИ-разбор заявок');
    expect(panel).toHaveTextContent('Сейчас разбирать нечего: у открытых заявок скрипт сам понял район, возраст и время.');
  });

  test('помощник выключен: полный вход читает в окне, как включить, и ссылка ведёт в «Настройки → Помощник»', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ enabled: false })) }, 'super');
    const { user, panel } = await openHelper(block, 'ИИ-разбор заявок');
    expect(panel).toHaveTextContent('Я выключен. Включить: Настройки → Помощник.');
    await user.click(within(panel).getByRole('button', { name: 'Настройки → Помощник' }));
    await waitFor(() => expect(document.querySelector('[data-testid="location"]')!.textContent).toContain('sec=assistant'));
  });

  test('помощник выключен: обычный вход читает, кто может включить, без ссылки в «Настройки»', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ enabled: false })) });
    const { panel } = await openHelper(block, 'ИИ-разбор заявок');
    expect(panel).toHaveTextContent('Я выключен. Включить меня может полный вход.');
    expect(within(panel).queryByRole('button', { name: /Настройки/ })).not.toBeInTheDocument();
  });

  test('ключ не задан: полный вход видит значок и объяснение в окне, обычному входу значка нет', async () => {
    const off = { requests: () => json(viewAssistant({ available: false, enabled: false })) };
    const { block } = await openRequests(off, 'super');
    const { panel } = await openHelper(block, 'ИИ-разбор заявок');
    expect(panel).toHaveTextContent('Я не подключён: на сервере не задан ключ модели.');
  });

  test('обычному входу при незаданном ключе значка нет: сделать с этим он ничего не может', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ available: false, enabled: true })) });
    await screen.findByRole('button', { name: /^Подбор/ });
    expect(within(block).queryByRole('button', { name: /ИИ-разбор/ })).not.toBeInTheDocument();
  });
});

describe('Окно помощника: ответ человека — сразу в заявку', () => {
  test('выбранный район и время уходят правкой заявки; слова человека остаются в скобках', async () => {
    const { fetchMock, block } = await openRequests({ [`requests/8/edit`]: () => json({ ok: true }) });
    const { user, panel } = await openHelper(block);
    const card = within(panel).getByRole('article', { name: 'Станислав Ким' });
    await user.selectOptions(await within(card).findByRole('combobox', { name: 'Район' }), 'Приморский');
    await user.type(within(card).getByRole('textbox', { name: 'Удобные дни и время' }), 'пн вечером');
    await user.click(within(card).getByRole('button', { name: 'Записать в заявку' }));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([{ path: 'requests/8/edit', body: { place: 'Приморский (где-то у Пионерской)', schedule: 'пн вечером' } }]),
    );
    expect(await within(panel).findByText('Записал в заявку: Станислав Ким. Подбор учтёт новые данные.')).toBeInTheDocument();
  });

  test('поля только для того, чего не хватает: возраст известен — его не спрашивают', async () => {
    const { block } = await openRequests();
    const { panel } = await openHelper(block);
    const card = within(panel).getByRole('article', { name: 'Станислав Ким' });
    expect(await within(card).findByRole('combobox', { name: 'Район' })).toBeInTheDocument();
    expect(within(card).queryByRole('combobox', { name: 'Возраст' })).not.toBeInTheDocument();
  });

  test('пустой ответ не отправляется: окно просит заполнить хотя бы одно поле', async () => {
    const { fetchMock, block } = await openRequests();
    const { user, panel } = await openHelper(block);
    const card = within(panel).getByRole('article', { name: 'Станислав Ким' });
    await user.click(within(card).getByRole('button', { name: 'Записать в заявку' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заполните хотя бы одно поле.');
    expect(posts(fetchMock)).toEqual([]);
  });

  test('отказ сервера показан его словами, введённое не стирается', async () => {
    const { block } = await openRequests({ [`requests/8/edit`]: () => json({ error: 'conflict', message: 'Заявка уже закрыта.' }, 409) });
    const { user, panel } = await openHelper(block);
    const card = within(panel).getByRole('article', { name: 'Станислав Ким' });
    const time = within(card).getByRole('textbox', { name: 'Удобные дни и время' });
    await user.type(time, 'пн вечером');
    await user.click(within(card).getByRole('button', { name: 'Записать в заявку' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заявка уже закрыта.');
    expect(time).toHaveValue('пн вечером');
  });
});

const NOTE_FULL: AssistantNote = { filled: ['район', 'время'], questions: ['Какая станция метро ближе всего?', 'В какие дни вам удобно?'], note: null };
const NOTE_QUESTIONS: AssistantNote = { filled: [], questions: ['Сколько вам лет?', 'Где вы живёте?', 'Когда удобно?'], note: null };

async function cardBlock(patch: AssistantNote | null, id = 1) {
  stubFetchWithFixtures({ requests: () => json(viewWith(id, { assistant: patch })) });
  const card = await openCard(id);
  await within(card).findByRole('heading', { name: 'Работа с заявкой' });
  return card;
}

describe('Карточка заявки: блок «Помощник»', () => {
  test('показывает, что определил помощник, с обязательной пометкой «проверьте»', async () => {
    const card = await cardBlock(NOTE_FULL);
    const block = within(card).getByRole('region', { name: 'Помощник' });
    expect(block).toHaveTextContent('Определил помощник: район, время — проверьте');
    expect(within(block).getByText('проверьте')).toBeInTheDocument();
  });

  test('вопросы для человека идут списком «Спросить у человека»', async () => {
    const card = await cardBlock(NOTE_FULL);
    const block = within(card).getByRole('region', { name: 'Помощник' });
    expect(within(block).getByText('Спросить у человека')).toBeInTheDocument();
    const items = within(within(block).getByRole('list', { name: 'Спросить у человека' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(NOTE_FULL.questions);
  });

  test('«Скопировать вопросы» кладёт вопросы в буфер по одному на строку и подтверждает', async () => {
    const user = userEvent.setup();
    const card = await cardBlock(NOTE_FULL);
    const block = within(card).getByRole('region', { name: 'Помощник' });
    await user.click(within(block).getByRole('button', { name: 'Скопировать вопросы' }));
    await within(block).findByText('Скопировано');
    expect(await navigator.clipboard.readText()).toBe(NOTE_FULL.questions.join('\n'));
  });

  test('если ничего не определено, но вопросы есть, строки «Определил помощник» нет', async () => {
    const card = await cardBlock(NOTE_QUESTIONS, 8);
    const block = within(card).getByRole('region', { name: 'Помощник' });
    expect(within(block).queryByText(/Определил помощник/)).not.toBeInTheDocument();
    expect(within(block).queryByText('проверьте')).not.toBeInTheDocument();
    expect(within(within(block).getByRole('list', { name: 'Спросить у человека' })).getAllByRole('listitem')).toHaveLength(3);
  });

  test('если определено, но вопросов нет, остаётся строка про определённое без списка и копирования', async () => {
    const card = await cardBlock({ filled: ['время'], questions: [], note: null });
    const block = within(card).getByRole('region', { name: 'Помощник' });
    expect(block).toHaveTextContent('Определил помощник: время — проверьте');
    expect(within(block).queryByRole('button', { name: 'Скопировать вопросы' })).not.toBeInTheDocument();
    expect(within(block).queryByText('Спросить у человека')).not.toBeInTheDocument();
  });

  test('если помощник заявку не трогал или ничего не нашёл, блока нет', async () => {
    const untouched = await cardBlock(null);
    expect(within(untouched).queryByRole('region', { name: 'Помощник' })).not.toBeInTheDocument();
  });

  test('пустой разбор (ни определённого, ни вопросов) блока тоже не рисует', async () => {
    const card = await cardBlock({ filled: [], questions: [], note: null });
    expect(within(card).queryByRole('region', { name: 'Помощник' })).not.toBeInTheDocument();
  });

  test('пояснение помощника видно в карточке, даже если ничего не определено и вопросов нет', async () => {
    const card = await cardBlock({ filled: [], questions: [], note: 'В записи «как получится» дней и времени не названо.' });
    expect(within(card).getByRole('region', { name: 'Помощник' })).toHaveTextContent('В записи «как получится» дней и времени не названо.');
  });

  test('блок стоит выше «Работы с заявкой»', async () => {
    const card = await cardBlock(NOTE_FULL);
    const helper = within(card).getByRole('region', { name: 'Помощник' });
    const work = within(card).getByRole('heading', { name: 'Работа с заявкой' });
    expect(helper.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('у закрытой заявки подсказки помощника не нужны, но не мешают: блок рисуется по данным', async () => {
    const card = await cardBlock(NOTE_FULL, 10);
    expect(within(card).getByRole('region', { name: 'Помощник' })).toBeInTheDocument();
  });
});

describe('«Заявки»: метка «Помощник» в списке', () => {
  test('метка есть у заявок, где помощник что-то определил, и нет у остальных', async () => {
    const view = buildRequests();
    const patched: RequestsView = {
      ...view,
      items: view.items.map((r) =>
        r.id === 1 ? { ...r, assistant: NOTE_FULL } : r.id === 2 ? { ...r, assistant: NOTE_QUESTIONS } : { ...r, assistant: null },
      ),
    };
    stubFetchWithFixtures({ requests: () => json(patched) });
    renderAt(<App />, '/?tab=requests', client);
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    const rows = within(list).getAllByRole('listitem');
    const rowOf = (fio: string) => rows.find((r) => r.textContent!.includes(fio))!;
    expect(within(rowOf('Мария Соколова')).getByText('Помощник')).toBeInTheDocument();
    // вопросы без определённого полей — не повод для метки в списке
    expect(within(rowOf('Алексей Орлов')).queryByText('Помощник')).not.toBeInTheDocument();
    expect(within(rowOf('Ирина Жукова')).queryByText('Помощник')).not.toBeInTheDocument();
  });

  test('у метки есть пояснение для скринридера и мыши', async () => {
    const view = buildRequests();
    stubFetchWithFixtures({
      requests: () => json({ ...view, items: view.items.map((r) => ({ ...r, assistant: r.id === 1 ? NOTE_FULL : null })) }),
    });
    renderAt(<App />, '/?tab=requests', client);
    const tag = await screen.findByTitle('Часть данных определил помощник: проверьте');
    expect(tag).toHaveTextContent('Помощник');
  });
});
