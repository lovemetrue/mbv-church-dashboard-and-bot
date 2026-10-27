import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildRequests } from '../../../fixtures/build';
import { buildOthers } from '../../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import type { OtherItem } from '@contracts';
import { fixtureOther, getsOf, json, ok, posts, viewWithOthers } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

// «Хочу открыть группу» и «дают дом» живут в своих вкладках (см. Leads.spec.tsx): здесь — все остальные обращения.
const OTHERS = buildOthers().filter((o) => o.type !== 'lead_group');
type Overrides = Record<string, () => Response | Promise<Response>>;

/**
 * Механика списка (чипы состояния, поиск, «В работе у», разбор, массовый разбор, карточка) у всех вкладок обращений
 * одна. Проверяем её на вкладке «Уже состоят», сложив туда все обращения фикстур, кроме «открыть группу» и «дать дом»:
 * так в одном списке есть и все состояния, и все виды разбора. Подпись вида приходит с сервера и не меняется.
 * Раскладка по вкладкам — в «вкладки по виду обращения» ниже, на настоящих типах.
 */
const inOneTab = (o: OtherItem): OtherItem => (o.type === 'lead_group' ? o : { ...o, type: 'already_member' });
const oneTab = (make: () => Response | Promise<Response>) => async () => {
  const view = (await (await make()).json()) as ReturnType<typeof buildRequests>;
  return json({ ...view, others: view.others.map(inOneTab) });
};
const openCount = OTHERS.filter((o) => o.state === 'open').length;

const listEl = () => screen.getByRole('list', { name: 'Список обращений' });
const rowsOf = () => within(listEl()).getAllByRole('listitem');
const namesOf = () => rowsOf().map((r) => within(r).getAllByRole('button')[0]!.textContent);
const chips = () => screen.getByRole('group', { name: 'Фильтр по состоянию обращения' });
const switchEl = () => screen.getByRole('group', { name: 'Режим списка заявок' });
const toolsSelect = () =>
  within(screen.getByRole('group', { name: 'Отбор списка заявок' })).getByRole('combobox', { name: 'В работе у' });

async function openOthers(query = '', overrides: Overrides = {}) {
  const fetchMock = stubFetchWithFixtures({ ...overrides, requests: oneTab(overrides.requests ?? (() => json(buildRequests()))) });
  const utils = renderAt(<App />, `/?tab=requests&view=members${query}`);
  // Не список: при пустом отборе на его месте «Ничего не найдено».
  await screen.findByRole('group', { name: 'Фильтр по состоянию обращения' });
  return { fetchMock, ...utils };
}

describe('«Заявки»: вкладки по виду обращения', () => {
  // Настоящие типы фикстур: «открыть группу» 202 (и закрытое 204), «дать дом» 213, вопрос 201, «уже состоят» 203, 206,
  // 207, 211, «уже ведут» 208–210 (и закрытое 212), аннулированная «хочу в группу» 205.
  const tabs = () => within(switchEl()).getAllByRole('button').map((b) => b.textContent);

  test('у каждого вида своя вкладка с числом открытых; закрытые в счёт не идут, у аннулированных — сколько их всего', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(tabs()).toEqual([
      'Хотят в группу',
      'Хотят открыть группу (1)',
      'Дают дом (1)',
      'Вопросы (1)',
      'Уже состоят (4)',
      'Уже ведут (3)',
      'Аннулированные заявки (1)',
    ]);
    expect(within(switchEl()).getByRole('button', { name: 'Хотят в группу' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('в каждой вкладке только обращения её вида', async () => {
    const user = userEvent.setup();
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&ostate=all');
    await screen.findByRole('list', { name: 'Список заявок' });
    const shown: Record<string, string[]> = {};
    for (const [tab, label] of [['leads', /^Хотят открыть/], ['homes', /^Дают дом/], ['questions', /^Вопросы/], ['members', /^Уже состоят/], ['leaders', /^Уже ведут/], ['cancelled', /^Аннулированные заявки/]] as const) {
      await user.click(within(switchEl()).getByRole('button', { name: label }));
      expect(currentSearch().get('view')).toBe(tab);
      await user.click(within(chips()).getByRole('button', { name: /^Все/ }));
      shown[tab] = namesOf();
    }
    expect(shown).toEqual({
      leads: ['Юлия Громова', 'Виктор Лебедев'],
      homes: ['Татьяна Фёдорова'],
      questions: ['Игорь Седов'],
      members: ['Анастасия Орлова', 'Мария Кузнецова', 'Сергей Волков', 'Олег Фомин'],
      leaders: ['Дмитрий Воронин', 'Роман Белов', 'Татьяна Фёдорова', 'Нина Кравец'],
      cancelled: ['Тимур Ахметов'],
    });
  });

  test('числа не зависят от поиска: найденное дописано отдельно у каждой вкладки', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&q=Седов');
    await screen.findByRole('group', { name: 'Режим списка заявок' });
    expect(within(switchEl()).getByRole('button', { name: 'Вопросы (1) · найдено 1' })).toBeInTheDocument();
    expect(within(switchEl()).getByRole('button', { name: 'Уже состоят (4) · найдено 0' })).toBeInTheDocument();
  });

  test('вкладки аннулированных нет, пока их нет', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWithOthers(OTHERS.filter((o) => o.type !== 'join_group'))) });
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('group', { name: 'Режим списка заявок' });
    expect(within(switchEl()).queryByRole('button', { name: /^Аннулированные заявки/ })).not.toBeInTheDocument();
  });

  test('вкладка пишет view в адрес и сбрасывает открытую карточку и чип прежнего списка; «В работе у» остаётся', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=ready&req=1&resp=Анна Л.');
    await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.click(within(switchEl()).getByRole('button', { name: /^Уже состоят/ }));
    const params = currentSearch();
    expect(params.get('view')).toBe('members');
    expect(params.has('req')).toBe(false);
    expect(params.has('bucket')).toBe(false);
    expect(params.get('resp')).toBe('Анна Л.');
    expect(await screen.findByRole('list', { name: 'Список обращений' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Список заявок' })).not.toBeInTheDocument();
  });

  test('старая ссылка view=others ведёт во «Вопросы»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=others');
    await screen.findByRole('group', { name: 'Фильтр по состоянию обращения' });
    expect(within(switchEl()).getByRole('button', { name: /^Вопросы/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('обращение, открытое по ссылке из чужой вкладки, переносит в свою: дом и «открыть группу» — одна заявка', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=leads&ostate=all&req=213');
    await screen.findByRole('dialog', { name: /Карточка обращения/ });
    await waitFor(() => expect(currentSearch().get('view')).toBe('homes'));
    expect(currentSearch().get('req')).toBe('213');
    expect(namesOf()).toEqual(['Татьяна Фёдорова']);
  });

  test('разбор по справочникам есть только у «Уже состоят» и «Уже ведут»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=questions');
    await screen.findByRole('group', { name: 'Фильтр по состоянию обращения' });
    expect(screen.queryByRole('group', { name: 'Фильтр открытых обращений по разбору' })).not.toBeInTheDocument();
  });

  test('«Хотят в группу» убирает view из адреса и возвращает список заявок', async () => {
    const user = userEvent.setup();
    await openOthers('&ostate=cancelled');
    await user.click(within(switchEl()).getByRole('button', { name: 'Хотят в группу' }));
    expect(currentSearch().has('view')).toBe(false);
    expect(currentSearch().has('ostate')).toBe(false);
    expect(await screen.findByRole('list', { name: 'Список заявок' })).toBeInTheDocument();
  });

  test('в режиме обращений нет подбора, массового выбора и «Моих видов»', async () => {
    await openOthers();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Запустить подбор|Подобрать/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Массовые действия' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Мои виды/ })).not.toBeInTheDocument();
  });
});

describe('«Другие обращения»: список и чипы', () => {
  test('по умолчанию показаны только открытые, чип «Открытые» нажат, в адресе параметра нет', async () => {
    await openOthers();
    expect(namesOf()).toEqual(OTHERS.filter((o) => o.state === 'open').map((o) => o.fio));
    expect(within(chips()).getByRole('button', { name: /^Открытые/ })).toHaveAttribute('aria-pressed', 'true');
    expect(currentSearch().has('ostate')).toBe(false);
  });

  test('чипы со счётчиками: открытые, обработанные, аннулированные, все', async () => {
    await openOthers();
    const names = within(chips()).getAllByRole('button').map((b) => b.textContent);
    const n = (s: string) => OTHERS.filter((o) => o.state === s).length;
    expect(names).toEqual([`Открытые${n('open')}`, `Обработанные${n('done')}`, `Аннулированные${n('cancelled')}`, `Все${OTHERS.length}`]);
  });

  test('чип «Аннулированные» показывает только аннулированные и пишет ostate в адрес', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.click(within(chips()).getByRole('button', { name: /^Аннулированные/ }));
    expect(currentSearch().get('ostate')).toBe('cancelled');
    expect(namesOf()).toEqual(OTHERS.filter((o) => o.state === 'cancelled').map((o) => o.fio));
    expect(within(rowsOf()[0]!).getByText('Аннулировано')).toBeInTheDocument();
  });

  test('чип «Обработанные» и чип «Все»', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.click(within(chips()).getByRole('button', { name: /^Обработанные/ }));
    expect(namesOf()).toEqual(OTHERS.filter((o) => o.state === 'done').map((o) => o.fio));
    await user.click(within(chips()).getByRole('button', { name: /^Все/ }));
    expect(currentSearch().get('ostate')).toBe('all');
    expect(namesOf()).toEqual(OTHERS.map((o) => o.fio));
    await user.click(within(chips()).getByRole('button', { name: /^Открытые/ }));
    expect(currentSearch().has('ostate')).toBe(false);
  });

  test('строка: тип, ФИО, телефон, «ждёт N дн.», «В работе: имя» и метка состояния', async () => {
    // Строка общая для обеих подвкладок: проверяем на «хочу открыть группу».
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&view=leads');
    const row = within(await screen.findByRole('list', { name: 'Список обращений' })).getByRole('button', { name: 'Юлия Громова' }).closest('li')!;
    expect(row).toHaveTextContent('Хочет открыть группу');
    expect(row).toHaveTextContent('+7 921 555 01 02');
    expect(row).toHaveTextContent('Ждёт 4 дн.');
    expect(row).toHaveTextContent('В работе: Пётр Г.');
    expect(within(row).getByText('Открыто')).toBeInTheDocument();
  });

  test('обращение без телефона и без ответственного не ломает строку', async () => {
    await openOthers();
    const row = within(listEl()).getByRole('button', { name: 'Анастасия Орлова' }).closest('li')!;
    expect(row).not.toHaveTextContent('null');
    expect(row).toHaveTextContent('Телефона нет');
  });

  test('«Нужен звонок» отмечено прямо в строке', async () => {
    await openOthers();
    const row = within(listEl()).getByRole('button', { name: 'Игорь Седов' }).closest('li')!;
    expect(row).toHaveTextContent('Перезвонить');
  });

  test('поиск шапки работает и в этом списке, а счётчики чипов считаются по найденному', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.type(screen.getByRole('searchbox'), 'седов');
    expect(currentSearch().get('q')).toBe('седов');
    expect(namesOf()).toEqual(['Игорь Седов']);
    expect(within(chips()).getByRole('button', { name: /^Открытые/ })).toHaveTextContent('1');
    expect(within(chips()).getByRole('button', { name: /^Все/ })).toHaveTextContent('1');
  });

  test('поиск находит и по типу обращения', async () => {
    await openOthers('&q=вопрос');
    expect(namesOf()).toEqual(['Игорь Седов']);
  });

  test('отбор «В работе у» работает и здесь: остаются обращения выбранного человека', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.selectOptions(toolsSelect(), 'Анна Л.');
    expect(currentSearch().get('resp')).toBe('Анна Л.');
    expect(namesOf()).toEqual(OTHERS.filter((o) => o.state === 'open' && o.responsible === 'Анна Л.').map((o) => o.fio));
    await user.selectOptions(toolsSelect(), 'Никто не взял');
    expect(namesOf()).toEqual(['Игорь Седов']);
  });

  test('имена в «В работе у» берутся из обращений, а не из заявок', async () => {
    await openOthers('', { requests: () => json(viewWithOthers([{ ...fixtureOther(201), responsible: 'Только Здесь К.' }])) });
    const names = within(toolsSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Все', 'Никто не взял', 'Только Здесь К.']);
  });

  test('пустой отбор показывает «Ничего не найдено», а не пустую рамку', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWithOthers([])) });
    renderAt(<App />, '/?tab=requests&view=questions');
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument();
    expect(within(switchEl()).getByRole('button', { name: 'Вопросы (0)' })).toBeInTheDocument();
  });

  test('неизвестное значение чипа в адресе заменяется на «Открытые»', async () => {
    await openOthers('&ostate=что-то');
    expect(within(chips()).getByRole('button', { name: /^Открытые/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('«Другие обращения»: карточка', () => {
  async function openCard(id: number, query = '', overrides: Record<string, () => Response | Promise<Response>> = {}) {
    const ctx = await openOthers(`&req=${id}${query}`, overrides);
    const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    return { ...ctx, card };
  }

  test('клик по строке открывает карточку и пишет req в адрес', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.click(within(listEl()).getByRole('button', { name: 'Игорь Седов' }));
    expect(currentSearch().get('req')).toBe('201');
    expect(await screen.findByRole('dialog', { name: 'Карточка обращения: Игорь Седов' })).toBeInTheDocument();
  });

  test('заголовок с типом, контакты, «как пришла» и лента', async () => {
    const { card } = await openCard(202);
    expect(within(card).getByRole('heading', { level: 2, name: 'Юлия Громова' })).toBeInTheDocument();
    expect(within(card).getAllByText('Хочет открыть группу').length).toBeGreaterThan(0);
    expect(within(card).getByText('Как пришла')).toBeInTheDocument();
    expect(within(card).getByText('Малая группа')).toBeInTheDocument();
    expect(within(card).getByText('Хочет открыть свою группу')).toBeInTheDocument();
    expect(within(card).getByText('Лента')).toBeInTheDocument();
    expect(within(card).getByText(/Заявка создана: хочет открыть группу/)).toBeInTheDocument();
    expect(within(card).getByText(/В работе у: Пётр Г\./)).toBeInTheDocument();
  });

  test('у аннулированного показана причина аннулирования', async () => {
    const { card } = await openCard(205);
    expect(within(card).getByText('Причина аннулирования: Нашли группу сами')).toBeInTheDocument();
  });

  test('у обращения с отметкой «нужен звонок» карточка напоминает позвонить', async () => {
    const { card } = await openCard(201);
    expect(within(card).getByText('Нужен звонок: позвоните и запишите итог.')).toBeInTheDocument();
  });

  test('у открытого причины аннулирования нет', async () => {
    const { card } = await openCard(202);
    expect(within(card).queryByText(/Причина аннулирования/)).not.toBeInTheDocument();
  });

  test('блок «Работа с заявкой» есть: связаться, «В работе у», итог звонка, правка, закрытие', async () => {
    const { card } = await openCard(202);
    const head = within(card).getByRole('banner');
    // Связь и правка — значки в шапке, рядом с фамилией.
    expect(within(head).getByRole('link', { name: /^Позвонить: / })).toHaveAttribute('href', 'tel:+79215550102');
    expect(within(head).getByRole('button', { name: /^Править данные: / })).toBeInTheDocument();
    const work = within(card).getByRole('heading', { name: 'Работа с заявкой' }).closest('section')!;
    expect(within(work).getByRole('combobox', { name: 'В работе у' })).toBeInTheDocument();
    expect(within(work).getByRole('region', { name: 'Итог звонка' })).toBeInTheDocument();
    expect(within(work).getByRole('button', { name: 'Закрыть заявку…' })).toBeInTheDocument();
  });

  test('кнопок подбора и утверждения у обращения нет', async () => {
    const { card } = await openCard(202);
    for (const name of [/Утвердить/, /Подобрать заново/, /Выбрать другую группу/, /Отклонить группу/, /Нужен звонок: отметить/]) {
      expect(within(card).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(card).queryByText('Предложение системы')).not.toBeInTheDocument();
  });

  test('у закрытого вместо «Закрыть» стоит «Вернуть в работу», а звонок и правка скрыты', async () => {
    const { card } = await openCard(204, '&ostate=done');
    expect(within(card).getByRole('button', { name: 'Вернуть в работу' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Закрыть заявку…' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'Итог звонка' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Править данные/ })).not.toBeInTheDocument();
  });

  test('карточка, открытая по ссылке, остаётся, даже если обращения нет под выбранным чипом', async () => {
    const { card } = await openCard(205);
    expect(namesOf()).not.toContain('Тимур Ахметов');
    expect(within(card).getByRole('heading', { level: 2, name: 'Тимур Ахметов' })).toBeInTheDocument();
  });

  test('обращения с таким номером нет: понятное сообщение вместо пустой панели', async () => {
    await openOthers('&req=999');
    expect(await screen.findByText(/Обращения нет в этом списке/)).toBeInTheDocument();
  });

  test('без выбранного обращения справа подсказка', async () => {
    await openOthers();
    expect(screen.getByText('Выберите обращение в списке.')).toBeInTheDocument();
  });

  test('кнопка «Удалить заявку» видна полному входу', async () => {
    await openCard(202);
    expect(await screen.findByRole('button', { name: 'Удалить заявку: Юлия Громова' })).toBeInTheDocument();
  });

  test('обычному входу кнопки удаления нет', async () => {
    const { card } = await openCard(202, '', { me: () => json({ role: 'admin' }) });
    await within(card).findByRole('button', { name: /^Править данные: / });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Удалить заявку/ })).not.toBeInTheDocument());
  });

  test('аннулированное: «Вернуть в работу» просит подтверждение и без него ничего не шлёт', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openCard(205, '', { 'requests/205/reopen': ok });
    await user.click(within(card).getByRole('button', { name: 'Вернуть в работу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    expect(within(dialog).getByText('Обращение снова станет открытым.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Вернуть в работу?' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждённый возврат шлёт reopen с пустым телом и перечитывает заявки, «Сегодня» и «Команду»', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openCard(205, '', { 'requests/205/reopen': ok });
    await user.click(within(card).getByRole('button', { name: 'Вернуть в работу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    await user.click(within(dialog).getByRole('button', { name: 'Вернуть в работу' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/205/reopen', body: {} });
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Вернуть в работу?' })).not.toBeInTheDocument());
  });
});

// ── Суть обращения, разбор по справочникам и массовый разбор ─────────────────────────────────────────

const openOf = () => OTHERS.filter((o) => o.state === 'open');
const nameOf = (id: number) => OTHERS.find((o) => o.id === id)!.fio;
const recChips = () => screen.getByRole('group', { name: 'Фильтр открытых обращений по разбору' });
const closedVersion = (o: OtherItem): OtherItem => ({ ...o, state: 'done', reconcile: null, status: 'Исполнена' });

/** Сервер, который после POST отдаёт указанные обращения закрытыми, а до него — как в фикстурах. */
function serverAfterPost(closedIds: number[], extra: Overrides = {}) {
  let posted = false;
  const overrides: Overrides = {
    requests: () => json(viewWithOthers(OTHERS.map((o) => (posted && closedIds.includes(o.id) ? closedVersion(o) : o)))),
    ...extra,
  };
  const reply = (body: unknown, status = 200) => () => {
    posted = true;
    return json(body, status);
  };
  return { overrides, reply };
}

async function openOtherCard(id: number, overrides: Overrides = {}, query = '') {
  const ctx = await openOthers(`&req=${id}${query}`, overrides);
  const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
  return { ...ctx, card };
}
const recBlock = (card: HTMLElement) => within(card).getByRole('heading', { name: 'Разбор' }).closest('section')!;

describe('«Другие обращения»: суть в списке', () => {
  test('второй строкой стоит суть обращения, а подпись вида остаётся', async () => {
    await openOthers();
    const row = within(listEl()).getByRole('button', { name: 'Дмитрий Воронин' }).closest('li')!;
    const gist = fixtureOther(208).gist;
    expect(gist).toBe('Ведёт группу в Приморском районе, встречи по средам.');
    expect(within(row).getByText(gist)).toBeInTheDocument();
    expect(row).toHaveTextContent('Уже ведёт группу');
    // суть идёт после блока контактов, то есть второй строкой строки
    const contact = within(row).getByText('+7 921 555 01 08');
    expect(contact.compareDocumentPosition(within(row).getByText(gist)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('длинная суть не выпирает: обрезается двумя строками с многоточием', () => {
    const css = readFileSync(join(__dirname, 'Others.module.css'), 'utf8');
    const gist = css.slice(css.indexOf('.gist {'), css.indexOf('}', css.indexOf('.gist {')));
    expect(gist).toContain('-webkit-line-clamp: 2');
    expect(gist).toContain('overflow: hidden');
    expect(gist).toContain('grid-column: 1 / -1');
  });

  test('поиск шапки находит обращение по сути', async () => {
    await openOthers('&q=по средам');
    expect(namesOf()).toEqual(['Дмитрий Воронин']);
  });
});

describe('«Другие обращения»: суть в карточке', () => {
  test('блок «Суть обращения» стоит сразу под заголовком, выше «Контактов», с полным текстом', async () => {
    const { card } = await openOtherCard(211);
    const gistHeading = within(card).getByRole('heading', { name: 'Суть обращения' });
    const contacts = within(card).getByRole('heading', { name: 'Контакты' });
    expect(within(gistHeading.closest('section')!).getByText(fixtureOther(211).gist)).toBeInTheDocument();
    expect(gistHeading.compareDocumentPosition(contacts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // и выше «Разбора»: сначала прочесть, о чём речь
    const rec = within(card).getByRole('heading', { name: 'Разбор' });
    expect(gistHeading.compareDocumentPosition(rec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('суть есть и у обращения без разбора, а «Разбора» там нет', async () => {
    const { card } = await openOtherCard(201);
    expect(within(card).getByText('Спрашивает, можно ли прийти на встречу группы с детьми.')).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'Разбор' })).not.toBeInTheDocument();
  });

  test('суть в карточке крупнее остального текста', () => {
    const css = readFileSync(join(__dirname, 'Others.module.css'), 'utf8');
    const big = css.slice(css.indexOf('.gistBig {'), css.indexOf('}', css.indexOf('.gistBig {')));
    expect(parseInt(/font-size: (\d+)px/.exec(big)![1]!, 10)).toBeGreaterThan(14);
  });
});

describe('«Другие обращения»: блок «Разбор»', () => {
  // Раньше у «Разбора» и «Работы с заявкой» стоял один и тот же key={item.id}: React при смене карточки оставлял старые блоки,
  // и кнопка «Внести в состав и закрыть» в чужом блоке разбирала прежнее обращение, а не открытое.
  test('при переходе к другому обращению в карточке один «Разбор», а кнопка относится к открытому обращению', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchMock } = await openOthers('&req=206');
    await screen.findByRole('dialog', { name: /Карточка обращения/ });
    for (const name of ['Сергей Волков', 'Анастасия Орлова', 'Дмитрий Воронин']) {
      await user.click(within(listEl()).getByRole('button', { name }));
    }
    const card = screen.getByRole('dialog', { name: /Карточка обращения/ });
    expect(within(card).getAllByRole('heading', { name: 'Разбор' })).toHaveLength(1);
    expect(within(card).getAllByRole('heading', { name: 'Работа с заявкой' })).toHaveLength(1);
    expect(within(recBlock(card)).getByText(fixtureOther(208).reconcile!.text)).toBeInTheDocument();
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('same key'))).toEqual([]);
    errors.mockRestore();

    await user.click(within(recBlock(card)).getAllByRole('checkbox')[0]!);
    await user.click(within(recBlock(card)).getByRole('button', { name: /Связать с группой и закрыть/ }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    // запрос ушёл по открытому обращению (208), а не по тем, что открывали до него
    expect(posts(fetchMock)[0]!.path).toBe('requests/208/reconcile');
  });

  test('ready: текст сервера, единственная группа выбрана заранее с меткой «точно», кнопка активна', async () => {
    const { card } = await openOtherCard(206);
    const block = recBlock(card);
    expect(within(block).getByText(fixtureOther(206).reconcile!.text)).toBeInTheDocument();
    const group = within(block).getByRole('group', { name: /^В состав каких групп внести человека/ });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    const exact = within(block).getByRole('checkbox', { name: /ДГ-0012 · Ольга К\. · Приморский/ });
    expect(exact).toBeChecked();
    expect(within(block).getByText('точно')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeEnabled();
  });

  test('choose: ничего не выбрано, пока человек не выберет, и кнопка неактивна до выбора', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(207);
    const block = recBlock(card);
    const likely = within(block).getByRole('checkbox', { name: /ДГ-0040 · Павел Д\. · Невский/ });
    expect(likely).not.toBeChecked();
    expect(within(block).getByText('похоже')).toBeInTheDocument();
    expect(within(block).queryByText('точно')).not.toBeInTheDocument();
    expect(within(block).getByRole('checkbox', { name: 'Другие группы…' })).not.toBeChecked();
    const submit = within(block).getByRole('button', { name: 'Внести в состав и закрыть' });
    expect(submit).toBeDisabled();
    await user.click(likely);
    expect(submit).toBeEnabled();
  });

  test('choose у ведущего: две группы, метки «точно» и «похоже», кнопка «Связать с группой и закрыть»', async () => {
    const { card } = await openOtherCard(208);
    const block = recBlock(card);
    expect(within(block).getByRole('checkbox', { name: /ДГ-0019 · Дмитрий В\./ })).not.toBeChecked();
    expect(within(block).getByRole('checkbox', { name: /ДГ-0027 · Андрей М\./ })).not.toBeChecked();
    expect(within(block).getByText('точно')).toBeInTheDocument();
    expect(within(block).getByText('похоже')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeDisabled();
    expect(within(block).queryByRole('button', { name: 'Внести в состав и закрыть' })).not.toBeInTheDocument();
  });

  test('noleader: найденных групп нет, есть только «Другие группы…» со списком групп, кнопка ждёт выбора', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(203);
    const block = recBlock(card);
    const radios = within(block).getAllByRole('checkbox');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).textContent)).toEqual(['Другие группы…']);
    expect(radios[0]).toBeChecked();
    const submit = within(block).getByRole('button', { name: 'Внести в состав и закрыть' });
    expect(submit).toBeDisabled();
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'ДГ-0027 · Андрей М. · Приморский' }));
    expect(submit).toBeEnabled();
  });

  test('none: то же, что noleader, и кнопка называется по виду обращения', async () => {
    const { card } = await openOtherCard(209);
    const block = recBlock(card);
    expect(within(block).getAllByRole('checkbox')).toHaveLength(1);
    expect(await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeDisabled();
  });

  test('nouser: только текст, без выбора группы и без кнопки', async () => {
    const { card } = await openOtherCard(211);
    const block = recBlock(card);
    expect(within(block).getByText(fixtureOther(211).reconcile!.text)).toBeInTheDocument();
    expect(within(block).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  test('«Другие группы…» ищет по коду, ведущему и району; добавленная группа уходит из списка в «Добавленные группы», и её можно убрать', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(207);
    const block = recBlock(card);
    await user.click(within(block).getByRole('checkbox', { name: 'Другие группы…' }));
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(10);
    await user.type(within(block).getByRole('searchbox', { name: 'Найти группу' }), 'невский');
    const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('ДГ-0040 · Павел Д. · Невский');
    expect(names).not.toContain('ДГ-0012 · Ольга К. · Приморский');

    await user.clear(within(block).getByRole('searchbox', { name: 'Найти группу' }));

    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0035/ }));
    const chosen = within(block).getByRole('list', { name: 'Добавленные группы' });
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(1);
    expect(within(select).queryByRole('option', { name: /ДГ-0035/ })).not.toBeInTheDocument();
    await user.click(within(chosen).getByRole('button', { name: 'Убрать группу ДГ-0035' }));
    expect(within(block).queryByRole('list', { name: 'Добавленные группы' })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /ДГ-0035/ })).toBeInTheDocument();
  });

  test('отправляется ровно найденная выбранная группа: запрос на requests/:id/reconcile с groupIds', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([208]);
    const { card, fetchMock } = await openOtherCard(208, { ...overrides, 'requests/208/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    await user.click(within(block).getByRole('checkbox', { name: /ДГ-0027/ }));
    await user.click(within(block).getByRole('button', { name: 'Связать с группой и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/208/reconcile', body: { groupIds: [2] } });
  });

  test('отправляется группа только из «Других групп…», когда из найденных ничего не отмечено', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([207]);
    const { card, fetchMock } = await openOtherCard(207, { ...overrides, 'requests/207/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    await user.click(within(block).getByRole('checkbox', { name: 'Другие группы…' }));
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    // пока в списке ничего не добавлено, отправлять нечего
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeDisabled();
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0035/ }));
    await user.click(within(block).getByRole('button', { name: 'Внести в состав и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ groupIds: [9] });
  });

  test('можно отметить несколько найденных групп: кнопка называет число, уходят все номера, итог перечисляет коды', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([208]);
    const { card, fetchMock } = await openOtherCard(208, { ...overrides, 'requests/208/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    await user.click(within(block).getByRole('checkbox', { name: /ДГ-0019/ }));
    expect(within(block).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeEnabled();
    await user.click(within(block).getByRole('checkbox', { name: /ДГ-0027/ }));
    await user.click(within(block).getByRole('button', { name: 'Связать с группами (2) и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/208/reconcile', body: { groupIds: [8, 2] } });
    expect(await screen.findByText('Обращение разобрано: группы ДГ-0019, ДГ-0027 связаны с этим ведущим.')).toBeInTheDocument();
  });

  test('найденная группа и добавленная из справочника уходят вместе; снятая галочка группу из запроса убирает', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([207]);
    const { card, fetchMock } = await openOtherCard(207, { ...overrides, 'requests/207/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    const likely = within(block).getByRole('checkbox', { name: /ДГ-0040/ });
    await user.click(likely);
    await user.click(within(block).getByRole('checkbox', { name: 'Другие группы…' }));
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0035/ }));
    expect(within(block).getByRole('button', { name: 'Внести в состав групп (2) и закрыть' })).toBeEnabled();
    // снятая и вновь поставленная галочка: группа в запросе один раз
    await user.click(likely);
    await user.click(likely);
    await user.click(within(block).getByRole('button', { name: 'Внести в состав групп (2) и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ groupIds: [expect.any(Number), 9] });
    expect(await screen.findByText(/Обращение разобрано: человек внесён в состав групп ДГ-0040, ДГ-0035\./)).toBeInTheDocument();
  });

  test('группа, добавленная из справочника, но уже найденная, просто отмечается среди найденных, а не дублируется', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(207);
    const block = recBlock(card);
    await user.click(within(block).getByRole('checkbox', { name: 'Другие группы…' }));
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0040/ }));
    expect(within(block).getByRole('checkbox', { name: /ДГ-0040/ })).toBeChecked();
    expect(within(block).queryByRole('list', { name: 'Добавленные группы' })).not.toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeEnabled();
  });

  test('сняли «Другие группы…»: добавленные ранее в запрос не попадают, а кнопка снова ждёт выбора', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(203);
    const block = recBlock(card);
    const select = await within(block).findByRole('listbox', { name: 'Добавить группу из справочника' });
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0027/ }));
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeEnabled();
    await user.click(within(block).getByRole('checkbox', { name: 'Другие группы…' }));
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeDisabled();
  });

  test('подтверждения перед отправкой нет: запрос уходит сразу, и список перечитывается', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([206]);
    const { card, fetchMock } = await openOtherCard(206, { ...overrides, 'requests/206/reconcile': reply({ ok: true, already: false }) });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: /Разобрать|Подтвер/ })).not.toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
  });

  test('успех: карточка закрывается, наверху нейтральный итог без пола, обращение ушло из открытых', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([206]);
    const { card } = await openOtherCard(206, { ...overrides, 'requests/206/reconcile': reply({ ok: true, already: false }) });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    expect(await screen.findByText('Обращение разобрано: человек внесён в состав группы ДГ-0012.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Карточка обращения/ })).not.toBeInTheDocument());
    expect(currentSearch().has('req')).toBe(false);
    expect(namesOf()).not.toContain(nameOf(206));
  });

  test('успех у ведущего: «группа … связана с этим ведущим»; «уже было так» добавляется, когда сервер сказал already', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([210]);
    const { card } = await openOtherCard(210, { ...overrides, 'requests/210/reconcile': reply({ ok: true, already: true }) });
    await user.click(within(card).getByRole('button', { name: 'Связать с группой и закрыть' }));
    expect(await screen.findByText('Обращение разобрано: группа ДГ-0112 связана с этим ведущим (уже было так).')).toBeInTheDocument();
  });

  test('двойное нажатие даёт один запрос, пока первый не закончился', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const { overrides, reply } = serverAfterPost([206]);
    const { card, fetchMock } = await openOtherCard(206, {
      ...overrides,
      'requests/206/reconcile': async () => {
        await gate;
        return reply({ ok: true, already: false })();
      },
    });
    const form = within(card).getByRole('button', { name: 'Внести в состав и закрыть' }).closest('form')!;
    // обе отправки приходят до перерисовки: от повтора защищает флаг в ref, а не только отключённая кнопка
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    release();
    await screen.findByText(/Обращение разобрано/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('пока запрос идёт, кнопка занята и подписана «Сохраняем…»', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([206]);
    const { card } = await openOtherCard(206, {
      ...overrides,
      'requests/206/reconcile': async () => {
        await gate;
        return reply({ ok: true, already: false })();
      },
    });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    expect(await within(card).findByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    release();
    await screen.findByText(/Обращение разобрано/);
  });

  test('conflict: объясняем своими словами, что у одной из групп уже есть другой ведущий и ничего не записано; карточка остаётся, список не перечитывается', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openOtherCard(210, {
      'requests/210/reconcile': () => json({ error: 'conflict', message: 'служебный текст' }, 409),
    });
    await user.click(within(card).getByRole('button', { name: 'Связать с группой и закрыть' }));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('У одной из групп уже связан другой ведущий. Ничего не записано');
    expect(alert).not.toHaveTextContent('служебный текст');
    expect(getsOf(fetchMock, 'requests')).toBe(1);
    expect(currentSearch().get('req')).toBe('210');
    expect(within(card).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeEnabled();
  });

  test.each([
    ['group_unavailable', 409, 'Группа закрыта и не принимает людей.'],
    ['bad_request', 400, 'Обращение не разбирается по справочникам.'],
  ])('%s: показываем слова сервера', async (code, status, message) => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(206, { 'requests/206/reconcile': () => json({ error: code, message }, status) });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(message);
  });

  test('already_closed: слова сервера, и список перечитывается, чтобы показать актуальное', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openOtherCard(206, {
      'requests/206/reconcile': () => json({ error: 'already_closed', message: 'Обращение уже закрыто.' }, 409),
    });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Обращение уже закрыто.');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('обрыв связи: честно говорим, что неизвестно, записалось ли, и не повторяем запрос сами', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openOtherCard(206, {
      'requests/206/reconcile': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await user.click(within(card).getByRole('button', { name: 'Внести в состав и закрыть' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Нет связи с сервером. Неизвестно, записалось ли: обновите список и проверьте',
    );
    expect(posts(fetchMock)).toHaveLength(1);
    expect(getsOf(fetchMock, 'requests')).toBe(1);
  });
});

describe('«Другие обращения»: чипы по разбору', () => {
  const count = (pred: (o: OtherItem) => boolean) => openOf().filter(pred).length;

  test('вторая строка чипов под «Открытыми»: «Все открытые» и четыре группы с числами', async () => {
    await openOthers();
    const names = within(recChips()).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual([
      `Все открытые${openOf().length}`,
      `Готово к разбору${count((o) => o.reconcile?.status === 'ready')}`,
      `Нужен выбор${count((o) => o.reconcile?.status === 'choose')}`,
      `Группа не найдена${count((o) => o.reconcile?.status === 'none' || o.reconcile?.status === 'noleader')}`,
      `Остальные${count((o) => !o.reconcile || o.reconcile.status === 'nouser')}`,
    ]);
    expect(names).toEqual(['Все открытые8', 'Готово к разбору2', 'Нужен выбор2', 'Группа не найдена2', 'Остальные2']);
    expect(within(recChips()).getByRole('button', { name: /^Все открытые/ })).toHaveAttribute('aria-pressed', 'true');
    expect(currentSearch().has('orec')).toBe(false);
  });

  test('«Готово к разбору» оставляет готовые и пишет orec в адрес', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.click(within(recChips()).getByRole('button', { name: /^Готово к разбору/ }));
    expect(currentSearch().get('orec')).toBe('ready');
    expect(namesOf()).toEqual([nameOf(206), nameOf(210)]);
    expect(within(recChips()).getByRole('button', { name: /^Готово к разбору/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('«Нужен выбор», «Группа не найдена» (none и noleader) и «Остальные» (вопросы, «хочу открыть», nouser)', async () => {
    const user = userEvent.setup();
    await openOthers();
    await user.click(within(recChips()).getByRole('button', { name: /^Нужен выбор/ }));
    expect(namesOf()).toEqual([nameOf(207), nameOf(208)]);
    await user.click(within(recChips()).getByRole('button', { name: /^Группа не найдена/ }));
    expect(currentSearch().get('orec')).toBe('missing');
    expect(namesOf()).toEqual([nameOf(203), nameOf(209)]);
    await user.click(within(recChips()).getByRole('button', { name: /^Остальные/ }));
    expect(namesOf()).toEqual([nameOf(201), nameOf(211)]);
    await user.click(within(recChips()).getByRole('button', { name: /^Все открытые/ }));
    expect(currentSearch().has('orec')).toBe(false);
    expect(namesOf()).toHaveLength(openOf().length);
  });

  test('ссылка с orec сразу показывает отбор; неизвестное значение — все открытые', async () => {
    await openOthers('&orec=choose');
    expect(namesOf()).toEqual([nameOf(207), nameOf(208)]);
    expect(within(recChips()).getByRole('button', { name: /^Нужен выбор/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('неизвестное orec не прячет обращения', async () => {
    await openOthers('&orec=что-то');
    expect(namesOf()).toHaveLength(openOf().length);
  });

  test('числа считаются по найденному: поиск шапки и «В работе у» сужают и их', async () => {
    await openOthers('&q=Татьяна');
    const names = within(recChips()).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Все открытые1', 'Готово к разбору1', 'Нужен выбор0', 'Группа не найдена0', 'Остальные0']);
  });

  test('строки по разбору нет у «Обработанных», «Аннулированных» и «Всех»; отбор из адреса при них не действует', async () => {
    await openOthers('&ostate=done&orec=ready');
    expect(screen.queryByRole('group', { name: 'Фильтр открытых обращений по разбору' })).not.toBeInTheDocument();
    expect(namesOf()).toEqual(OTHERS.filter((o) => o.state === 'done').map((o) => o.fio));
  });

  test('переход на другой чип состояния убирает orec из адреса, возврат на «Открытые» начинается со всех', async () => {
    const user = userEvent.setup();
    await openOthers('&orec=ready');
    await user.click(within(chips()).getByRole('button', { name: /^Обработанные/ }));
    expect(currentSearch().has('orec')).toBe(false);
    await user.click(within(chips()).getByRole('button', { name: /^Открытые/ }));
    expect(namesOf()).toHaveLength(openOf().length);
  });

  test('смена отбора закрывает открытую карточку: она могла выпасть из списка', async () => {
    const user = userEvent.setup();
    await openOtherCard(206);
    await user.click(within(recChips()).getByRole('button', { name: /^Нужен выбор/ }));
    expect(currentSearch().has('req')).toBe(false);
  });

  test('переключатель режима сбрасывает orec вместе с остальными отборами', async () => {
    const user = userEvent.setup();
    await openOthers('&orec=ready');
    await user.click(within(switchEl()).getByRole('button', { name: 'Хотят в группу' }));
    expect(currentSearch().has('orec')).toBe(false);
  });
});

describe('«Другие обращения»: «Разобрать все готовые»', () => {
  const bulkButton = (n: number) => screen.queryByRole('button', { name: `Разобрать все готовые (${n})` });
  const readyOf = (o: OtherItem[]) => o.filter((x) => x.state === 'open' && x.reconcile?.status === 'ready');
  const readyItem = (id: number): OtherItem => ({ ...fixtureOther(206), id, fio: `Готовый ${id}` });

  test('кнопка с числом готовых из показанного списка', async () => {
    await openOthers();
    expect(bulkButton(2)).toBeInTheDocument();
  });

  test('число следует за списком: поиск и отбор сужают его, а без готовых кнопки нет вовсе', async () => {
    await openOthers('&q=Татьяна');
    expect(bulkButton(1)).toBeInTheDocument();
    expect(bulkButton(2)).not.toBeInTheDocument();
  });

  test('при отборе «Нужен выбор» в списке нет готовых, и кнопки нет', async () => {
    await openOthers('&orec=choose');
    expect(screen.queryByRole('button', { name: /Разобрать все готовые/ })).not.toBeInTheDocument();
  });

  test('на «Обработанных» кнопки нет', async () => {
    await openOthers('&ostate=done');
    expect(screen.queryByRole('button', { name: /Разобрать все готовые/ })).not.toBeInTheDocument();
  });

  test('нажатие открывает окно подтверждения с пояснением и ничего не отправляет', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openOthers();
    await user.click(bulkButton(2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    expect(within(dialog).getByText(
      'Сервер разберёт 2 обращения: человек будет внесён в состав найденной группы или группа будет связана с ведущим, обращения закроются. Группа определяется по имени ведущего или телефону, точное совпадение, одна группа. Продолжить?',
    )).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Разобрать все готовые обращения?' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Да, разобрать» отправляет номера готовых из показанного списка и показывает итог сервера', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([206]);
    const { fetchMock } = await openOthers('', { ...overrides, 'requests/reconcile-ready': reply({ ok: true, applied: 1, skipped: 1 }) });
    await user.click(bulkButton(2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    await user.click(within(dialog).getByRole('button', { name: 'Да, разобрать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/reconcile-ready', body: { ids: [206, 210] } });
    expect(await screen.findByText('Разобрано 1, пропущено 1 (изменились, закрыты или группа уже не одна).')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Разобрать все готовые обращения?' })).not.toBeInTheDocument());
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('номера берутся из показанного списка, а не из всех обращений: при поиске уходит один', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openOthers('&q=Татьяна', { 'requests/reconcile-ready': () => json({ ok: true, applied: 1, skipped: 0 }) });
    await user.click(bulkButton(1)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    expect(within(dialog).getByText(/^Сервер разберёт 1 обращение:/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Да, разобрать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ ids: [210] });
  });

  test('больше пятисот: уходят первые 500, и в окне об этом сказано', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 507 }, (_, i) => readyItem(1000 + i));
    const { fetchMock } = await openOthers('', {
      requests: () => json(viewWithOthers(many)),
      'requests/reconcile-ready': () => json({ ok: true, applied: 500, skipped: 0 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Разобрать все готовые (507)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    expect(within(dialog).getByText(/^Сервер разберёт 500 обращений:/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Готовых обращений 507, за один раз можно разобрать 500/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Да, разобрать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const ids = posts(fetchMock)[0]!.body['ids'] as number[];
    expect(ids).toHaveLength(500);
    expect(ids[0]).toBe(1000);
    expect(ids[499]).toBe(1499);
    expect(readyOf(many)).toHaveLength(507);
  });

  test('двойное нажатие «Да, разобрать» даёт один запрос', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const user = userEvent.setup();
    const { fetchMock } = await openOthers('', {
      'requests/reconcile-ready': async () => {
        await gate;
        return json({ ok: true, applied: 2, skipped: 0 });
      },
    });
    await user.click(bulkButton(2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    const yes = within(dialog).getByRole('button', { name: 'Да, разобрать' });
    act(() => {
      yes.click();
      yes.click();
    });
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(await within(dialog).findByRole('button', { name: 'Разбираем…' })).toBeDisabled();
    release();
    await screen.findByText(/^Разобрано 2, пропущено 0/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('обрыв связи: без совета повторить вслепую, запрос один, окно закрыто', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await openOthers('', { 'requests/reconcile-ready': () => Promise.reject(new TypeError('Failed to fetch')) });
    await user.click(bulkButton(2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    await user.click(within(dialog).getByRole('button', { name: 'Да, разобрать' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Нет связи с сервером. Неизвестно, что успело записаться: обновите список и проверьте.');
    expect(alert).not.toHaveTextContent(/повторите|попробуйте ещё/i);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Разобрать все готовые обращения?' })).not.toBeInTheDocument();
    // кнопка осталась: список не менялся
    expect(bulkButton(2)).toBeInTheDocument();
  });

  test('ошибка сервера: показываем его слова', async () => {
    const user = userEvent.setup();
    await openOthers('', {
      'requests/reconcile-ready': () => json({ error: 'bad_request', message: 'За раз можно разобрать не больше 500 обращений.' }, 400),
    });
    await user.click(bulkButton(2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Разобрать все готовые обращения?' });
    await user.click(within(dialog).getByRole('button', { name: 'Да, разобрать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('За раз можно разобрать не больше 500 обращений.');
  });
});
