import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildOthers } from '../../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import type { OtherItem } from '@contracts';
import { fixtureOther, getsOf, json, ok, posts, viewWithOthers } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const OTHERS = buildOthers();
const openCount = OTHERS.filter((o) => o.state === 'open').length;

const listEl = () => screen.getByRole('list', { name: 'Список обращений' });
const rowsOf = () => within(listEl()).getAllByRole('listitem');
const namesOf = () => rowsOf().map((r) => within(r).getAllByRole('button')[0]!.textContent);
const chips = () => screen.getByRole('group', { name: 'Фильтр по состоянию обращения' });
const switchEl = () => screen.getByRole('group', { name: 'Режим списка заявок' });
const toolsSelect = () =>
  within(screen.getByRole('group', { name: 'Отбор списка заявок' })).getByRole('combobox', { name: 'В работе у' });

async function openOthers(query = '', overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetchMock = stubFetchWithFixtures(overrides);
  const utils = renderAt(<App />, `/?tab=requests&view=others${query}`);
  await screen.findByRole('list', { name: 'Список обращений' });
  return { fetchMock, ...utils };
}

describe('«Заявки»: переключатель «Хотят в группу | Другие обращения»', () => {
  test('показывает число открытых обращений: закрытые в счёт не идут', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(OTHERS.length).toBeGreaterThan(openCount);
    expect(within(switchEl()).getByRole('button', { name: `Другие обращения (${openCount})` })).toBeInTheDocument();
    expect(within(switchEl()).getByRole('button', { name: 'Хотят в группу' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('число не зависит от поиска и отбора: оно про все открытые обращения', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&q=Громова');
    // по такому поиску среди заявок никого нет, но число обращений всё равно полное
    await screen.findByRole('group', { name: 'Режим списка заявок' });
    expect(within(switchEl()).getByRole('button', { name: `Другие обращения (${openCount})` })).toBeInTheDocument();
  });

  test('«Другие обращения» записывает view=others в адрес и сбрасывает открытую карточку и чип прежнего списка', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=ready&req=1&resp=Пётр Г.');
    await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.click(within(switchEl()).getByRole('button', { name: /^Другие обращения/ }));
    const params = currentSearch();
    expect(params.get('view')).toBe('others');
    expect(params.has('req')).toBe(false);
    expect(params.has('bucket')).toBe(false);
    // «В работе у» общий для обоих списков и остаётся
    expect(params.get('resp')).toBe('Пётр Г.');
    expect(await screen.findByRole('list', { name: 'Список обращений' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Список заявок' })).not.toBeInTheDocument();
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
    await openOthers();
    const row = within(listEl()).getByRole('button', { name: 'Юлия Громова' }).closest('li')!;
    expect(row).toHaveTextContent('Хочет открыть группу или дать дом');
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
    await user.type(screen.getByRole('searchbox'), 'громов');
    expect(currentSearch().get('q')).toBe('громов');
    expect(namesOf()).toEqual(['Юлия Громова']);
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
    await user.selectOptions(toolsSelect(), 'Пётр Г.');
    expect(currentSearch().get('resp')).toBe('Пётр Г.');
    expect(namesOf()).toEqual(['Юлия Громова']);
    await user.selectOptions(toolsSelect(), 'Никто не взял');
    expect(namesOf()).toEqual(['Игорь Седов']);
  });

  test('имена в «В работе у» берутся из обращений, а не из заявок', async () => {
    await openOthers('', { requests: () => json(viewWithOthers([{ ...fixtureOther(202), responsible: 'Только Здесь К.' }])) });
    const names = within(toolsSelect()).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Все', 'Никто не взял', 'Только Здесь К.']);
  });

  test('пустой отбор показывает «Ничего не найдено», а не пустую рамку', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWithOthers([])) });
    renderAt(<App />, '/?tab=requests&view=others');
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument();
    expect(within(switchEl()).getByRole('button', { name: 'Другие обращения (0)' })).toBeInTheDocument();
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
    await user.click(within(listEl()).getByRole('button', { name: 'Юлия Громова' }));
    expect(currentSearch().get('req')).toBe('202');
    expect(await screen.findByRole('dialog', { name: 'Карточка обращения: Юлия Громова' })).toBeInTheDocument();
  });

  test('заголовок с типом, контакты, «как пришла» и лента', async () => {
    const { card } = await openCard(202);
    expect(within(card).getByRole('heading', { level: 2, name: 'Юлия Громова' })).toBeInTheDocument();
    expect(within(card).getAllByText('Хочет открыть группу или дать дом').length).toBeGreaterThan(0);
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
    const work = within(card).getByRole('heading', { name: 'Работа с заявкой' }).closest('section')!;
    expect(within(work).getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79215550102');
    expect(within(work).getByRole('combobox', { name: 'В работе у' })).toBeInTheDocument();
    expect(within(work).getByRole('region', { name: 'Итог звонка' })).toBeInTheDocument();
    expect(within(work).getByRole('button', { name: 'Править данные' })).toBeInTheDocument();
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
    expect(within(card).queryByRole('button', { name: 'Править данные' })).not.toBeInTheDocument();
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
    await within(card).findByRole('button', { name: 'Править данные' });
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

type Overrides = Record<string, () => Response | Promise<Response>>;
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
  test('ready: текст сервера, единственная группа выбрана заранее с меткой «точно», кнопка активна', async () => {
    const { card } = await openOtherCard(206);
    const block = recBlock(card);
    expect(within(block).getByText(fixtureOther(206).reconcile!.text)).toBeInTheDocument();
    const group = within(block).getByRole('radiogroup', { name: 'В состав какой группы внести человека' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    const exact = within(block).getByRole('radio', { name: /ДГ-0012 · Ольга К\. · Приморский/ });
    expect(exact).toBeChecked();
    expect(within(block).getByText('точно')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeEnabled();
  });

  test('choose: ничего не выбрано, пока человек не выберет, и кнопка неактивна до выбора', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(207);
    const block = recBlock(card);
    const likely = within(block).getByRole('radio', { name: /ДГ-0040 · Павел Д\. · Невский/ });
    expect(likely).not.toBeChecked();
    expect(within(block).getByText('похоже')).toBeInTheDocument();
    expect(within(block).queryByText('точно')).not.toBeInTheDocument();
    expect(within(block).getByRole('radio', { name: 'Другая группа…' })).not.toBeChecked();
    const submit = within(block).getByRole('button', { name: 'Внести в состав и закрыть' });
    expect(submit).toBeDisabled();
    await user.click(likely);
    expect(submit).toBeEnabled();
  });

  test('choose у ведущего: две группы, метки «точно» и «похоже», кнопка «Связать с группой и закрыть»', async () => {
    const { card } = await openOtherCard(208);
    const block = recBlock(card);
    expect(within(block).getByRole('radio', { name: /ДГ-0019 · Дмитрий В\./ })).not.toBeChecked();
    expect(within(block).getByRole('radio', { name: /ДГ-0027 · Андрей М\./ })).not.toBeChecked();
    expect(within(block).getByText('точно')).toBeInTheDocument();
    expect(within(block).getByText('похоже')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeDisabled();
    expect(within(block).queryByRole('button', { name: 'Внести в состав и закрыть' })).not.toBeInTheDocument();
  });

  test('noleader: найденных групп нет, есть только «Другая группа…» со списком групп, кнопка ждёт выбора', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(203);
    const block = recBlock(card);
    const radios = within(block).getAllByRole('radio');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).textContent)).toEqual(['Другая группа…']);
    expect(radios[0]).toBeChecked();
    const submit = within(block).getByRole('button', { name: 'Внести в состав и закрыть' });
    expect(submit).toBeDisabled();
    const select = await within(block).findByRole('combobox', { name: 'Группа из справочника' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'ДГ-0027 · Андрей М. · Приморский' }));
    expect(submit).toBeEnabled();
  });

  test('none: то же, что noleader, и кнопка называется по виду обращения', async () => {
    const { card } = await openOtherCard(209);
    const block = recBlock(card);
    expect(within(block).getAllByRole('radio')).toHaveLength(1);
    expect(await within(block).findByRole('combobox', { name: 'Группа из справочника' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Связать с группой и закрыть' })).toBeDisabled();
  });

  test('nouser: только текст, без выбора группы и без кнопки', async () => {
    const { card } = await openOtherCard(211);
    const block = recBlock(card);
    expect(within(block).getByText(fixtureOther(211).reconcile!.text)).toBeInTheDocument();
    expect(within(block).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  test('«Другая группа…» ищет по коду, ведущему и району и не теряет уже выбранную группу', async () => {
    const user = userEvent.setup();
    const { card } = await openOtherCard(207);
    const block = recBlock(card);
    await user.click(within(block).getByRole('radio', { name: 'Другая группа…' }));
    const select = await within(block).findByRole('combobox', { name: 'Группа из справочника' });
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(10);
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0027/ }));
    await user.type(within(block).getByRole('searchbox', { name: 'Найти группу' }), 'невский');
    const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('ДГ-0027 · Андрей М. · Приморский');
    expect(names).toContain('ДГ-0040 · Павел Д. · Невский');
    expect(names).not.toContain('ДГ-0012 · Ольга К. · Приморский');
  });

  test('отправляется ровно найденная выбранная группа: запрос на requests/:id/reconcile с groupId', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([208]);
    const { card, fetchMock } = await openOtherCard(208, { ...overrides, 'requests/208/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    await user.click(within(block).getByRole('radio', { name: /ДГ-0027/ }));
    await user.click(within(block).getByRole('button', { name: 'Связать с группой и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/208/reconcile', body: { groupId: 2 } });
  });

  test('отправляется группа из «Другой группы…», а не прежняя выбранная из найденных', async () => {
    const user = userEvent.setup();
    const { overrides, reply } = serverAfterPost([207]);
    const { card, fetchMock } = await openOtherCard(207, { ...overrides, 'requests/207/reconcile': reply({ ok: true, already: false }) });
    const block = recBlock(card);
    await user.click(within(block).getByRole('radio', { name: /ДГ-0040/ }));
    await user.click(within(block).getByRole('radio', { name: 'Другая группа…' }));
    const select = await within(block).findByRole('combobox', { name: 'Группа из справочника' });
    // пока в списке ничего не выбрано, отправлять нечего
    expect(within(block).getByRole('button', { name: 'Внести в состав и закрыть' })).toBeDisabled();
    await user.selectOptions(select, within(select).getByRole('option', { name: /ДГ-0035/ }));
    await user.click(within(block).getByRole('button', { name: 'Внести в состав и закрыть' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ groupId: 9 });
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

  test('conflict: объясняем своими словами, что у группы уже есть другой ведущий; карточка остаётся, список не перечитывается', async () => {
    const user = userEvent.setup();
    const { card, fetchMock } = await openOtherCard(210, {
      'requests/210/reconcile': () => json({ error: 'conflict', message: 'служебный текст' }, 409),
    });
    await user.click(within(card).getByRole('button', { name: 'Связать с группой и закрыть' }));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('У этой группы уже связан другой ведущий.');
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
    expect(names).toEqual(['Все открытые9', 'Готово к разбору2', 'Нужен выбор2', 'Группа не найдена2', 'Остальные3']);
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
    expect(namesOf()).toEqual([nameOf(201), nameOf(202), nameOf(211)]);
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
