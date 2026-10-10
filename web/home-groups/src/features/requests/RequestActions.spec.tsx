import type { RequestItem, RequestsView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = () => json({ ok: true });
const fail = (status: number, error: string) => () => json({ error, message: 'служебный текст сервера' }, status);

const fixtureItem = (id: number): RequestItem => buildRequests().items.find((r) => r.id === id)!;
/** Группа главного предложения заявки: от неё зависят тела запросов и подписи. */
const mainGroup = (id: number) => fixtureItem(id).proposal!.main.group;

/** Копия очереди, в которой у заявки подменены поля: так тест «получает от сервера» другое состояние. */
function viewWith(id: number, patch: Partial<RequestItem>): RequestsView {
  const view = buildRequests();
  return { ...view, items: view.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
/** Вызовы fetch как тройки «адрес, параметры»: у подмены тип с одним аргументом, а передаём мы два. */
const callsOf = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit | undefined][]).map(([url, init]) => ({
    path: String(url).replace(/^.*\/api\/v1\//, ''),
    init,
  }));

/** Вызовы POST: путь без базы, параметры запроса и разобранное тело. */
function posts(fetchMock: FetchMock) {
  return callsOf(fetchMock)
    .filter((c) => c.init?.method === 'POST')
    .map((c) => ({ path: c.path, init: c.init!, body: JSON.parse(String(c.init!.body)) as Record<string, unknown> }));
}
const getsOf = (fetchMock: FetchMock, path: string) =>
  callsOf(fetchMock).filter((c) => c.path === path && !c.init?.method).length;

async function openCard(id: number, query = '') {
  // Тест мог уже подменить fetch своими ответами; иначе берём фикстуры.
  if (!vi.isMockFunction(globalThis.fetch)) stubFetchWithFixtures();
  renderAt(<App />, `/?tab=requests&req=${id}${query}`);
  return screen.findByRole('dialog', { name: /Карточка заявки/ });
}

describe('«Заявки»: утверждение', () => {
  test('«Утвердить» шлёт POST с группой предложения, подтверждает и обновляет список заявок', async () => {
    const group = mainGroup(1);
    let approved = false;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': () => {
        approved = true;
        return ok();
      },
      requests: () =>
        json(approved ? viewWith(1, { bucket: 'done', proposal: null, finalGroup: group }) : buildRequests()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));

    expect(await within(card).findByText(`Утверждено: ${group.code}`)).toBeInTheDocument();
    const [call] = posts(fetchMock);
    expect(call).toMatchObject({ path: 'requests/1/approve', body: { groupId: group.id } });
    expect(call!.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(call!.init.credentials).toBe('same-origin');
    // список и сводки перечитаны, а у закрытой заявки кнопок больше нет
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(1);
    expect(within(card).queryByRole('button', { name: /^Утвердить/ })).not.toBeInTheDocument();
    expect(within(card).getByText(/Утверждено: группа №12/)).toBeInTheDocument();
  });

  test('двойное нажатие «Утвердить» отправляет один запрос, пока первый не завершён', async () => {
    const group = mainGroup(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': async () => {
        await gate;
        return ok();
      },
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    const btn = within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` });
    await user.dblClick(btn);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(btn).toBeDisabled();
    expect(within(card).getByRole('button', { name: /Отклонить группу/ })).toBeDisabled();
    release();
    await within(card).findByText(`Утверждено: ${group.code}`);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('«group_full» спрашивает подтверждение и только после согласия повторяет запрос с force:true', async () => {
    const group = mainGroup(1);
    let calls = 0;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': () => (++calls === 1 ? json({ error: 'group_full', message: 'мест нет' }, 409) : ok()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));

    const confirm = await screen.findByRole('dialog', { name: 'Нет мест в группе' });
    expect(within(confirm).getByText('В группе нет мест. Утвердить всё равно?')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]!.body).toEqual({ groupId: group.id });

    await user.click(within(confirm).getByRole('button', { name: 'Утвердить всё равно' }));
    await within(card).findByText(`Утверждено: ${group.code}`);
    expect(posts(fetchMock).map((p) => p.body)).toEqual([{ groupId: group.id }, { groupId: group.id, force: true }]);
  });

  test('отказ от подтверждения «group_full» не отправляет повторный запрос', async () => {
    const group = mainGroup(1);
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': fail(409, 'group_full') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));
    const confirm = await screen.findByRole('dialog', { name: 'Нет мест в группе' });
    await user.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Нет мест в группе' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('«already_closed» показывает «Заявку уже обработали» и перечитывает список', async () => {
    const group = mainGroup(1);
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': fail(409, 'already_closed') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заявку уже обработали');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('«group_unavailable» и обрыв сети объясняются человеческим текстом, а не кодом', async () => {
    const group = mainGroup(1);
    stubFetchWithFixtures({ 'requests/1/approve': fail(409, 'group_unavailable') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent(/Группа сейчас не принимает людей/);
    expect(alert).not.toHaveTextContent('group_unavailable');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    // после ошибки кнопка снова доступна
    expect(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` })).toBeEnabled();
  });

  test('слабый план тоже можно утвердить вручную: кнопка «Всё равно утвердить» работает', async () => {
    const group = mainGroup(19);
    const fetchMock = stubFetchWithFixtures({ 'requests/19/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(19, '&bucket=human');
    await user.click(within(card).getByRole('button', { name: `Всё равно утвердить в группу ${group.code}` }));
    await within(card).findByText(`Утверждено: ${group.code}`);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/19/approve', body: { groupId: group.id } });
  });
});

describe('«Заявки»: другая группа', () => {
  test('выбор другой группы из списка утверждает именно её', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));

    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    const radio = await within(picker).findByRole('radio', { name: /ДГ-0019/ });
    expect(radio).toHaveAccessibleName(/Дмитрий В\./);
    expect(radio).toHaveAccessibleName(/Приморский/);
    expect(radio).toHaveAccessibleName(/мест: 8/);
    const submit = within(picker).getByRole('button', { name: /^Утвердить/ });
    expect(submit).toBeDisabled();
    await user.click(radio);
    await user.click(submit);

    await within(card).findByText('Утверждено: ДГ-0019');
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/approve', body: { groupId: 8 } });
    expect(screen.queryByRole('dialog', { name: 'Другая группа' })).not.toBeInTheDocument();
  });

  test('запасные варианты предложения стоят в списке выше остальных групп', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    const alternatives = fixtureItem(1).proposal!.alternatives.map((a) => a.group.code);
    expect(alternatives.length).toBeGreaterThan(0);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    await within(picker).findAllByRole('radio');
    const first = within(picker).getAllByRole('radio').slice(0, alternatives.length);
    first.forEach((radio, i) => expect(radio).toHaveAccessibleName(new RegExp(alternatives[i]!)));
    // главная группа предложения в «другие» не попадает: её утверждает основная кнопка
    expect(within(picker).queryByRole('radio', { name: new RegExp(mainGroup(1).code) })).not.toBeInTheDocument();
  });

  test('группа, в которую не направляют, в списке отключена', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    // группа 12 в фикстурах помечена «Не направлять»; своего номера в реестре у неё нет
    // (код строится как ДГ-0100 + id)
    expect(await within(picker).findByRole('radio', { name: /ДГ-0112/ })).toBeDisabled();
  });

  test('Escape закрывает окно выбора, но не саму карточку заявки', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    await screen.findByRole('dialog', { name: 'Другая группа' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Другая группа' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Карточка заявки/ })).toBeInTheDocument();
  });
});

describe('«Заявки»: отклонение', () => {
  test('причина «Другое» без комментария не отправляется, с комментарием — уходит', async () => {
    const group = mainGroup(1);
    const fetchMock = stubFetchWithFixtures({ 'requests/1/reject': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Отклонить группу ${group.code}` }));
    const dialog = await screen.findByRole('dialog', { name: `Отклонить ${group.code}` });

    await user.click(within(dialog).getByRole('radio', { name: 'Другое' }));
    await user.click(within(dialog).getByRole('button', { name: 'Отклонить' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Напишите комментарий');
    expect(posts(fetchMock)).toHaveLength(0);

    await user.type(within(dialog).getByRole('textbox', { name: /Комментарий/ }), '  Семья переезжает  ');
    await user.click(within(dialog).getByRole('button', { name: 'Отклонить' }));
    await within(card).findByText(`Отклонено: ${group.code}`);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({
      path: 'requests/1/reject',
      body: { groupId: group.id, reason: 'other', comment: 'Семья переезжает' },
    });
  });

  test('отклоняется именно предложенная группа, причина из списка, комментарий необязателен', async () => {
    const group = mainGroup(1);
    const fetchMock = stubFetchWithFixtures({ 'requests/1/reject': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Отклонить группу ${group.code}` }));
    const dialog = await screen.findByRole('dialog', { name: `Отклонить ${group.code}` });
    const reasons = within(dialog).getAllByRole('radio').map((r) => r.closest('label')?.textContent);
    expect(reasons).toEqual([
      'Не подошло время',
      'Далеко',
      'Не подходит возраст или состав',
      'Человек отказался',
      'Другое',
    ]);
    // пока причина не выбрана, отправить нельзя
    expect(within(dialog).getByRole('button', { name: 'Отклонить' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Далеко' }));
    await user.click(within(dialog).getByRole('button', { name: 'Отклонить' }));
    await within(card).findByText(`Отклонено: ${group.code}`);
    expect(posts(fetchMock)[0]!.body).toEqual({ groupId: group.id, reason: 'far' });
  });
});

describe('«Заявки»: «нужен звонок»', () => {
  test('кнопка переключает отметку: ставит value:true, затем снимает value:false', async () => {
    let callback = false;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/need-call': () => {
        callback = !callback;
        return ok();
      },
      requests: () => json(viewWith(1, { callback, bucket: callback ? 'callback' : 'ready' })),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    expect(within(card).queryByText(/Сначала позвоните человеку/)).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Нужен звонок: отметить заявку' }));
    expect(await within(card).findByRole('button', { name: 'Звонок не нужен: снять отметку' })).toBeInTheDocument();
    expect(within(card).getByText(/Сначала позвоните человеку/)).toBeInTheDocument();
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/need-call', body: { value: true } });

    await user.click(within(card).getByRole('button', { name: 'Звонок не нужен: снять отметку' }));
    expect(await within(card).findByRole('button', { name: 'Нужен звонок: отметить заявку' })).toBeInTheDocument();
    expect(posts(fetchMock)[1]).toMatchObject({ body: { value: false } });
    expect(within(card).queryByText(/Сначала позвоните человеку/)).not.toBeInTheDocument();
  });
});

describe('«Заявки»: какие кнопки у какой заявки', () => {
  test('у заявки без плана только «Другая группа» и «Нужен звонок»', async () => {
    const card = await openCard(11, '&bucket=human');
    const names = within(card)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
      .filter((n) => n !== 'Закрыть карточку');
    expect(names).toEqual(['Выбрать другую группу из списка', 'Нужен звонок: отметить заявку']);
    expect(within(card).queryByText(/Пока вы не утвердили/)).not.toBeInTheDocument();
  });

  test('у уже утверждённой заявки кнопок действий нет', async () => {
    const card = await openCard(10);
    const names = within(card).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Закрыть карточку']);
    expect(within(card).queryByText(/Пока вы не утвердили/)).not.toBeInTheDocument();
  });

  test('у заявки с планом есть все четыре действия, и все доступны сразу', async () => {
    const group = mainGroup(1);
    const card = await openCard(1);
    for (const name of [
      `Утвердить в группу ${group.code}`,
      'Выбрать другую группу из списка',
      `Отклонить группу ${group.code}`,
      'Нужен звонок: отметить заявку',
    ]) {
      expect(within(card).getByRole('button', { name })).toBeEnabled();
    }
  });
});

describe('«Заявки»: чьё это предложение', () => {
  test('предложение расчёта подписано, и напоминание говорит, что человек ещё не распределён', async () => {
    const card = await openCard(1);
    expect(within(card).getByText('Предложил расчёт')).toBeInTheDocument();
    expect(within(card).getByText('Пока вы не утвердили, человек не считается распределённым.')).toBeInTheDocument();
  });

  test('предложение языковой модели подписано «Предложил Claude»', async () => {
    const base = fixtureItem(1);
    stubFetchWithFixtures({
      requests: () => json(viewWith(1, { proposal: { ...base.proposal!, source: 'agent' } })),
    });
    const card = await openCard(1);
    expect(await within(card).findByText('Предложил Claude')).toBeInTheDocument();
    expect(within(card).queryByText('Предложил расчёт')).not.toBeInTheDocument();
  });
});
