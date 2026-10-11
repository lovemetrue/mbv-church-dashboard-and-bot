import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { buildOthers } from '../../../fixtures/others';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
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
