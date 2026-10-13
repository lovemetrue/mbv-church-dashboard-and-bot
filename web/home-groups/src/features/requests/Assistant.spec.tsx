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

const RUN_OK = { ok: true, asked: 3, filled: 2, withQuestions: 1, proposals: 4 };
const runOk = () => json(RUN_OK);

const BUTTON = 'Попросить помощника разобрать заявки (3)';

/** Очередь заявок с заданным состоянием помощника: так тест «получает от сервера» нужное. */
const viewAssistant = (assistant: Partial<AssistantStatus>): RequestsView => {
  const view = buildRequests();
  return { ...view, assistant: { available: true, enabled: true, pending: 3, ...assistant } };
};

let client = makeClient();
beforeEach(() => {
  client = makeClient();
});

async function openRequests(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}, role: 'admin' | 'super' = 'admin') {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role }), ...overrides });
  renderAt(<App />, '/?tab=requests', client);
  const block = await screen.findByRole('region', { name: 'Подбор для новых заявок' });
  return { fetchMock, block };
}

const helperButton = (block: HTMLElement, name = BUTTON) => within(block).getByRole('button', { name });
const matchButton = (block: HTMLElement) => within(block).getByRole('button', { name: 'Предложить группы новым заявкам' });

describe('«Заявки»: помощник в блоке подбора', () => {
  test('когда помощник подключён и включён, есть вторичная кнопка с числом заявок, которые он может разобрать', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ pending: 7 })) });
    const btn = helperButton(block, 'Попросить помощника разобрать заявки (7)');
    expect(btn).toBeEnabled();
    // главная кнопка блока — подбор, помощник второго уровня
    expect(matchButton(block).className).not.toBe(btn.className);
  });

  test('если помощник выключен, кнопки нет; полный вход видит подсказку, как его включить, со ссылкой на «Настройки»', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ enabled: false })) }, 'super');
    expect(within(block).queryByRole('button', { name: /Попросить помощника/ })).not.toBeInTheDocument();
    const hint = await within(block).findByText(/Помощник выключен\./);
    expect(hint).toHaveTextContent('Помощник выключен. Включить: Настройки → Помощник.');
    expect(within(block).getByRole('button', { name: 'Настройки → Помощник' })).toBeInTheDocument();
  });

  test('ссылка «Настройки → Помощник» ведёт в раздел настроек помощника', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ enabled: false })) }, 'super');
    const user = userEvent.setup();
    await user.click(await within(block).findByRole('button', { name: 'Настройки → Помощник' }));
    await waitFor(() => expect(document.querySelector('[data-testid="location"]')!.textContent).toContain('tab=settings'));
    expect(document.querySelector('[data-testid="location"]')!.textContent).toContain('sec=assistant');
  });

  test('обычный вход при выключенном помощнике видит строку без ссылки на «Настройки»', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ enabled: false })) });
    expect(await within(block).findByText('Помощник выключен. Включить его может полный вход.')).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /Настройки/ })).not.toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /Попросить помощника/ })).not.toBeInTheDocument();
  });

  test('если ключ не задан, полный вход видит одну строку про это, а кнопки нет', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ available: false, enabled: false })) }, 'super');
    expect(await within(block).findByText('Помощник не подключён: ключ не задан на сервере.')).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /Попросить помощника/ })).not.toBeInTheDocument();
    expect(within(block).queryByText(/Помощник выключен/)).not.toBeInTheDocument();
  });

  test('обычному входу при незаданном ключе помощника в блоке не видно совсем', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ available: false, enabled: true })) });
    expect(within(block).queryByText(/Помощник/)).not.toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /Попросить помощника/ })).not.toBeInTheDocument();
  });

  test('если разбирать нечего, кнопка неактивна, а причина написана рядом и привязана к кнопке', async () => {
    const { block } = await openRequests({ requests: () => json(viewAssistant({ pending: 0 })) });
    const btn = helperButton(block, 'Попросить помощника разобрать заявки (0)');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription('Нет заявок, которые помощник может разобрать');
  });

  test('нажатие сначала спрашивает подтверждение и ничего не отправляет, пока человек не согласился', async () => {
    const { fetchMock, block } = await openRequests({ requests: () => json(viewAssistant({})), 'assistant/run': runOk });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Помощник прочитает записи 3 заявок (возраст, место, удобное время — без имён и телефонов), определит район и время и подскажет вопросы. Это займёт около минуты. Продолжить?',
    );
    expect(posts(fetchMock)).toEqual([]);
  });

  test('в окне подтверждения число склоняется: «записи 1 заявки», «записи 2 заявок»', async () => {
    const user = userEvent.setup();
    const { block } = await openRequests({ requests: () => json(viewAssistant({ pending: 1 })) });
    await user.click(helperButton(block, 'Попросить помощника разобрать заявки (1)'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Помощник прочитает записи 1 заявки (');
  });

  test('«Отмена» закрывает окно и ничего не отправляет', async () => {
    const { fetchMock, block } = await openRequests({ requests: () => json(viewAssistant({})), 'assistant/run': runOk });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
  });

  test('согласие шлёт POST assistant/run с пустым телом, пишет итог и перечитывает заявки, «Сегодня» и «Команду»', async () => {
    const { fetchMock, block } = await openRequests({ requests: () => json(viewAssistant({})), 'assistant/run': runOk });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' }));

    expect(
      await within(block).findByText('Готово: отправлено 3, определено по 2, вопросы по 1, новых предложений групп 4'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([{ path: 'assistant/run', body: {} }]);
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([['requests'], ['today'], ['team']]));
  });

  test('пока помощник работает, обе кнопки блока неактивны, а второй запуск невозможен', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, block } = await openRequests({
      requests: () => json(viewAssistant({})),
      'assistant/run': async () => {
        await gate;
        return runOk();
      },
    });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' }));

    const working = await within(block).findByRole('button', { name: 'Помощник разбирает заявки…' });
    expect(working).toBeDisabled();
    expect(matchButton(block)).toBeDisabled();
    expect(within(block).getByRole('button', { name: 'Пересчитать все предложения' })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await within(block).findByText(/^Готово: отправлено/);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(matchButton(block)).toBeEnabled();
  });

  test('два быстрых подтверждения подряд дают один запрос: окно ещё не успело закрыться', async () => {
    const { fetchMock, block } = await openRequests({ requests: () => json(viewAssistant({})), 'assistant/run': runOk });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' });
    await user.dblClick(confirm);
    await within(block).findByText(/^Готово: отправлено/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('два подтверждения до перерисовки тоже дают один запрос: окно и кнопка ещё не успели исчезнуть', async () => {
    const { fetchMock, block } = await openRequests({ requests: () => json(viewAssistant({})), 'assistant/run': runOk });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    await within(block).findByText(/^Готово: отправлено/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('пока идёт подбор, кнопка помощника неактивна', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { block } = await openRequests({
      requests: () => json(viewAssistant({})),
      'matching/run': async () => {
        await gate;
        return json({ ok: true, created: 0, replaced: 0, unchanged: 0 });
      },
    });
    const user = userEvent.setup();
    await user.click(matchButton(block));
    expect(helperButton(block)).toBeDisabled();
    release();
    await within(block).findByText(/^Готово: группы предложены/);
    expect(helperButton(block)).toBeEnabled();
  });

  test('ошибка показывается текстом сервера, а кнопка снова доступна', async () => {
    const { block } = await openRequests({
      requests: () => json(viewAssistant({})),
      'assistant/run': () => json({ error: 'unavailable', message: 'Помощник выключен или не задан ключ' }, 503),
    });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' }));
    expect(await within(block).findByRole('alert')).toHaveTextContent('Помощник выключен или не задан ключ');
    expect(helperButton(block)).toBeEnabled();
  });

  test('если разбор уже идёт (409), показывается текст сервера', async () => {
    const { block } = await openRequests({
      requests: () => json(viewAssistant({})),
      'assistant/run': () => json({ error: 'conflict', message: 'Разбор уже идёт, подождите минуту' }, 409),
    });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' }));
    expect(await within(block).findByRole('alert')).toHaveTextContent('Разбор уже идёт, подождите минуту');
  });

  test('если до сервера не достучались, сказано про связь, а не «Ошибка 0»', async () => {
    const { block } = await openRequests({
      requests: () => json(viewAssistant({})),
      'assistant/run': () => Promise.reject(new TypeError('fetch failed')),
    });
    const user = userEvent.setup();
    await user.click(helperButton(block));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Да, разобрать' }));
    expect(await within(block).findByRole('alert')).toHaveTextContent('Нет связи с сервером. Разбор не запущен, попробуйте ещё раз.');
  });
});

const NOTE_FULL: AssistantNote = { filled: ['район', 'время'], questions: ['Какая станция метро ближе всего?', 'В какие дни вам удобно?'] };
const NOTE_QUESTIONS: AssistantNote = { filled: [], questions: ['Сколько вам лет?', 'Где вы живёте?', 'Когда удобно?'] };

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
    const card = await cardBlock({ filled: ['время'], questions: [] });
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
    const card = await cardBlock({ filled: [], questions: [] });
    expect(within(card).queryByRole('region', { name: 'Помощник' })).not.toBeInTheDocument();
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
