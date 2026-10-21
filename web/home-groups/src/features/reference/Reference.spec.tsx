import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildGroups, buildPeople } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { groupsWith } from '../requests/requestsTestKit';
import { coordinatorsConfig, groupsConfig, peopleConfig, takesNew } from './config';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const SOON = 'Появится на следующем этапе';
/** Сколько людей в фикстурах: число растёт вместе с демо-заявками, поэтому берём его оттуда же. */
const PEOPLE = buildPeople().items.length;
/**
 * Групп в фикстурах всего и сколько видно сразу: закрытая (Борис Ширяев-Коваленко) по умолчанию скрыта, как и те,
 * что не принимают новых (группа Татьяны Ф. отмечена «Не направлять»).
 */
const GROUPS = buildGroups().items.length;
const GROUPS_SHOWN = buildGroups().items.filter((g) => g.status !== 'Закрыта' && g.status !== 'Аннулирована' && takesNew(g)).length;
/** Видно, когда снят только чип закрытых: остаётся отбор «Принимает новых». */
const GROUPS_TAKING = buildGroups().items.filter((g) => g.status !== 'Аннулирована' && takesNew(g)).length;
const NOT_TAKING_LEADER = 'Татьяна Ф.';
const CLOSED_LEADER = 'Борис Олегович Ширяев-Коваленко';

/** Строки данных (без шапки и заголовков групп). */
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));

describe('«Справочник»: конфигурация', () => {
  test('по умолчанию у групп девять столбцов: к макету добавлен «Данные проверены»', () => {
    expect(groupsConfig.defaultColumns).toEqual(['Код', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Данные проверены', 'Здоровье']);
  });

  test('каждый столбец и каждое поле быстрых отборов есть в описании сущности', () => {
    for (const cfg of [groupsConfig, peopleConfig, coordinatorsConfig]) {
      const keys = cfg.fields.map((f) => f.key);
      for (const c of cfg.columns) expect(keys).toContain(c);
      for (const c of cfg.defaultColumns) expect(cfg.columns).toContain(c);
      for (const p of cfg.presets) for (const f of p.filters) expect(keys).toContain(f.field);
    }
  });
});

describe('«Справочник»: экран', () => {
  test('переключатель сущностей со счётчиками, по умолчанию «Группы»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    const sw = await screen.findByRole('group', { name: 'Что показывать' });
    await waitFor(() =>
      expect(within(sw).getAllByRole('button').map((b) => b.textContent)).toEqual([`Группы${GROUPS}`, `Люди${PEOPLE}`, 'Координаторы4']),
    );
    expect(within(sw).getByRole('button', { name: /^Группы/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('таблица групп показывает девять столбцов по умолчанию; закрытая и не принимающая новых скрыты', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    const table = await screen.findByRole('table');
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(heads).toEqual(['Код', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Данные проверены', 'Здоровье']);
    expect(screen.getByText(`Показано ${GROUPS_SHOWN} из ${GROUPS}`)).toBeInTheDocument();
    expect(dataRows()).toHaveLength(GROUPS_SHOWN);
  });

  test('быстрый отбор сужает таблицу, ставит чип с «×» и записывает отбор в адрес', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтры' });
    await user.click(within(dlg).getByRole('button', { name: 'На паузе' }));
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText(`Показано 1 из ${GROUPS}`)).toBeInTheDocument();
    expect(currentSearch().getAll('f')).toEqual(['Статус:eq:На паузе']);
    // чип можно убрать
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Убрать отбор: Статус = На паузе' }));
    // Отбор пуст: это явный выбор «показать всё», поэтому закрытая группа тоже видна.
    expect(dataRows()).toHaveLength(GROUPS);
    expect(currentSearch().has('f')).toBe(false);
  });

  test('отбор из адреса применяется при загрузке страницы', async () => {
    stubFetchWithFixtures();
    // Адрес — полное описание отбора: умолчание («Закрыта» скрыта) в нём указано явно, иначе его бы не было.
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:ne:Закрыта') + '&f=' + encodeURIComponent('Район:eq:Приморский'));
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(3);
    expect(screen.getByRole('list', { name: 'Текущий отбор' })).toHaveTextContent('Район = Приморский');
  });

  test('конструктор: поле, условие и значение добавляют отбор; для чисел есть «≥»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтры' });
    await user.selectOptions(within(dlg).getByLabelText('Поле'), 'Мест свободно');
    const ops = within(within(dlg).getByLabelText('Условие')).getAllByRole('option').map((o) => o.textContent);
    expect(ops).toEqual(['≥', '≤', '=', '≠', 'пусто', 'заполнено']);
    await user.selectOptions(within(dlg).getByLabelText('Условие'), '≥');
    await user.type(within(dlg).getByLabelText('Значение'), '6');
    await user.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    // Отбор по умолчанию («Закрыта» скрыта) остаётся и записывается в адрес вместе с новым условием.
    expect(currentSearch().getAll('f')).toEqual(['Статус:ne:Закрыта', 'Статус:ne:Аннулирована', 'Принимает новых:eq:Да', 'Мест свободно:ge:6']);
    expect(dataRows().length).toBeGreaterThan(0);
    expect(dataRows().length).toBeLessThan(12);
  });

  test('«Добавить» недоступна, пока не выбрано поле и значение', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтры' });
    expect(within(dlg).getByRole('button', { name: 'Добавить' })).toBeDisabled();
    await user.selectOptions(within(dlg).getByLabelText('Поле'), 'Район');
    expect(within(dlg).getByRole('button', { name: 'Добавить' })).toBeDisabled();
    await user.selectOptions(within(dlg).getByLabelText('Условие'), 'пусто');
    expect(within(dlg).getByRole('button', { name: 'Добавить' })).toBeEnabled();
  });

  test('сохранённый вид запоминается в браузере и применяется по клику', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&f=Статус:eq:' + encodeURIComponent('На паузе'));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    const dlg = screen.getByRole('dialog', { name: 'Фильтры' });
    await user.type(within(dlg).getByLabelText('Название вида'), 'Паузные');
    await user.click(within(dlg).getByRole('button', { name: 'Сохранить как вид' }));
    expect(JSON.parse(window.localStorage.getItem('hg.views.groups') ?? '[]')[0].name).toBe('Паузные');
    await user.click(within(dlg).getByRole('button', { name: 'Сбросить всё' }));
    expect(dataRows()).toHaveLength(GROUPS);
    await user.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Паузные' }));
    expect(dataRows()).toHaveLength(1);
  });

  test('«Вид таблицы» включает дополнительные столбцы и группирует строки, не теряя их', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Вид таблицы/ }));
    const dlg = screen.getByRole('dialog', { name: 'Вид таблицы' });
    await user.click(within(dlg).getByRole('checkbox', { name: 'Координатор' }));
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: /Координатор/ })).toBeInTheDocument();
    expect(currentSearch().getAll('col')).toContain('Координатор');
    await user.selectOptions(within(dlg).getByLabelText('Группировать'), 'Район');
    const groupRows = within(screen.getByRole('table')).getAllByRole('rowheader');
    expect(groupRows.map((r) => r.textContent)).toContain('Приморский · 3');
    expect(dataRows()).toHaveLength(GROUPS_SHOWN);
    expect(currentSearch().get('gb')).toBe('Район');
  });

  test('нельзя убрать последний столбец: таблица без столбцов бессмысленна', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=coordinators&col=' + encodeURIComponent('Имя'));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Вид таблицы/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Вид таблицы' })).getByRole('checkbox', { name: 'Имя' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(1);
  });

  test('клик по заголовку сортирует по возрастанию, затем по убыванию, затем сбрасывает', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    const table = await screen.findByRole('table');
    // Подписи значков («Новая группа», «Группа не набрала людей») входят в текст ячейки (их читает скринридер), для сравнения имён их убираем.
    const firstCol = () => dataRows().map((r) => within(r).getAllByRole('cell')[1]!.textContent?.replace('Новая группа', '').replace('Группа не набрала людей', ''));
    await user.click(within(table).getByRole('button', { name: 'Сортировать по столбцу «Ведущий»' }));
    expect(firstCol()[0]).toBe('Андрей М.');
    expect(within(table).getByRole('columnheader', { name: /Ведущий/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(table).getByRole('button', { name: 'Сортировать по столбцу «Ведущий»' }));
    // Татьяна Ф. была бы первой, но её группа отмечена «Не направлять» и скрыта отбором по умолчанию.
    expect(firstCol()[0]).toBe('Светлана Р.');
    await user.click(within(table).getByRole('button', { name: 'Сортировать по столбцу «Ведущий»' }));
    expect(firstCol()[0]).toBe('Ольга К.');
    expect(currentSearch().has('sort')).toBe(false);
  });

  test('поиск по таблице сужает строки', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по таблице' }), 'невск');
    // Вторая невская группа (Татьяна Ф.) скрыта отбором «Принимает новых».
    expect(dataRows()).toHaveLength(1);
    expect(await screen.findByText(`Показано 1 из ${GROUPS}`)).toBeInTheDocument();
  });

  test('когда ничего не подошло, показывается подсказка убрать часть условий', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Район:eq:Приморский') + '&f=' + encodeURIComponent('Статус:eq:На паузе'));
    expect(await screen.findByText('Ничего не найдено. Уберите часть условий.')).toBeInTheDocument();
  });

  test('клик по строке открывает карточку поверх таблицы с адресом записи, таблица не сжимается', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Открыть карточку: Группа ДГ-0027, Андрей М.' }));
    expect(currentSearch().get('rec')).toBe('2');
    const card = await screen.findByRole('dialog', { name: 'Карточка группы ДГ-0027' });
    expect(within(card).getByText('Здоровье')).toBeInTheDocument();
    expect(within(card).getByRole('meter', { name: /Здоровье: 100 из 100/ })).toBeInTheDocument();
    expect(within(card).getAllByText(/Ведущий указан|Телефон ведущего|Вместимость указана/).length).toBe(3);
    expect(within(card).getByText('Данные группы')).toBeInTheDocument();
    expect(within(card).getByText('Направлено планом')).toBeInTheDocument();
    expect(within(card).getByText('Руслан Агеев')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Спросить ведущего в боте' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Спросить ведущего в боте' })).toHaveAttribute('aria-description', SOON);
    // таблица осталась на месте и со всеми строками
    expect(dataRows()).toHaveLength(GROUPS_SHOWN);
  });

  test('в карточке группы со слабым здоровьем непройденные проверки отмечены, а предупреждения «Не направлять» видны', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&rec=12');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(within(card).getAllByText(/^Нет:/).length).toBeGreaterThan(0);
    expect(within(card).getByText('Не направлять')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: /ДГ-/ })).toBeInTheDocument(); // у группы без номера — код
  });

  test('«Направлено планом»: «Открыть» ведёт на заявку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы ДГ-0012/ });
    await user.click(within(card).getByRole('button', { name: /Открыть заявку: Мария Соколова/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('1');
  });

  test('люди: карточка с полями и кнопкой «Открыть заявку», если заявка есть', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Открыть карточку: Мария Соколова' }));
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    expect(within(card).getByText('Малая группа')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Открыть заявку' }));
    expect(currentSearch().get('req')).toBe('1');
  });

  test('человек без заявки: кнопки «Открыть заявку» нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Дарья Ефимова/ });
    expect(within(card).queryByRole('button', { name: 'Открыть заявку' })).not.toBeInTheDocument();
  });

  test('у человека с номером регистрации в карточке есть ссылки на печатную карточку и QR в новой вкладке', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Дарья Ефимова/ });
    const cardLink = within(card).getByRole('link', { name: /Карточка регистрации/ });
    expect(cardLink.getAttribute('href')).toMatch(/\/api\/v1\/people\/1\/card$/);
    expect(cardLink).toHaveAttribute('target', '_blank');
    expect(cardLink.getAttribute('rel')).toContain('noopener');
    const qrLink = within(card).getByRole('link', { name: /QR/ });
    expect(qrLink.getAttribute('href')).toMatch(/\/api\/v1\/people\/1\/qr$/);
    expect(qrLink).toHaveAttribute('target', '_blank');
    expect(within(card).getByText('Номер регистрации')).toBeInTheDocument();
  });

  test('у человека без номера регистрации ссылок на карточку и QR нет', async () => {
    stubFetchWithFixtures();
    // Софья Титова — участник бота без номера; Мария Соколова — заявка из таблицы без участника.
    renderAt(<App />, '/?tab=reference&ent=people&rec=u3');
    const card = await screen.findByRole('dialog', { name: /Софья Титова/ });
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByText('Номер регистрации')).not.toBeInTheDocument();
  });

  test('у заявки из таблицы без участника ссылок на карточку регистрации тоже нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=r1');
    const card = await screen.findByRole('dialog', { name: /Мария Соколова/ });
    expect(within(card).queryByRole('link', { name: /Карточка регистрации/ })).not.toBeInTheDocument();
  });

  test('в таблице «Люди» есть столбец «№» с номером регистрации; у кого его нет, ячейка пустая', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: /№/ })).toBeInTheDocument();
    const rowOf = (name: string) => dataRows().find((r) => within(r).queryByText(name))!;
    const lastCell = (row: HTMLElement) => Array.from(row.querySelectorAll('td')).at(-1)!;
    expect(lastCell(rowOf('Дарья Ефимова')).textContent).toBe('1');
    expect(lastCell(rowOf('Софья Титова')).textContent).toBe('—');
  });

  test('координатор: карточка показывает его группы', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=coordinators&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка координатора/ });
    await waitFor(() => expect(within(card).getByText(/ДГ-0012 · Ольга К\./)).toBeInTheDocument());
    expect(within(card).getByText(/ДГ-0031 · Марина Л\./)).toBeInTheDocument();
  });

  test('быстрые отборы людей работают на реальных полях контракта', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Хотят вести группу' }));
    expect(dataRows()).toHaveLength(1);
    expect(within(dataRows()[0]!).getByText('Юлия Орлова')).toBeInTheDocument();
  });

  test('«Выгрузить CSV» скачивает видимые строки и столбцы с учётом отбора', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => (blobs.push(b as Blob), 'blob:test');
    URL.revokeObjectURL = () => {};
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    const shownRows = dataRows().length;
    await user.click(screen.getByRole('button', { name: 'Выгрузить CSV' }));
    expect(blobs).toHaveLength(1);
    const text = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(blobs[0]!);
    });
    const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^ФИО;Телефон;/);
    expect(lines).toHaveLength(shownRows + 1);
  });

  test('в карточке человека видны адрес (улица и дом) и «район, метро, ориентир», по которым идёт подбор', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=people&rec=r1');
    const card = await screen.findByRole('dialog', { name: /Карточка/ });
    await waitFor(() => expect(within(card).getByText('Адрес')).toBeInTheDocument());
    expect(within(card).getByText('Район, метро, ориентир')).toBeInTheDocument();
  });

  test('смена сущности сбрасывает отборы прежней: поля у людей другие', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:eq:На паузе'));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Люди/ }));
    expect(currentSearch().get('ent')).toBe('people');
    expect(currentSearch().has('f')).toBe(false);
    await waitFor(() => expect(dataRows()).toHaveLength(PEOPLE));
  });
});


const CLOSED_CHIP = 'Статус: не «Закрыта»';
const CANCELLED_CHIP = 'Статус: не «Аннулирована»';
const TAKES_NEW_CHIP = 'Принимает новых = Да';
const DEFAULT_CHIPS = [CLOSED_CHIP, CANCELLED_CHIP, TAKES_NEW_CHIP];
const activeChips = () => within(screen.getByRole('list', { name: 'Текущий отбор' })).getAllByRole('listitem');

describe('«Справочник»: закрытые группы по умолчанию скрыты', () => {
  test('при первом открытии «Закрыта» скрыта, а в отборах виден чип «Статус: не «Закрыта»»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(GROUPS_SHOWN);
    expect(screen.getByText(`Показано ${GROUPS_SHOWN} из ${GROUPS}`)).toBeInTheDocument();
    expect(screen.queryByText(CLOSED_LEADER)).not.toBeInTheDocument();
    expect(activeChips().map((li) => li.textContent?.replace('×', ''))).toEqual(DEFAULT_CHIPS);
    // Отбор по умолчанию в адрес не пишется: ссылка остаётся короткой.
    expect(currentSearch().has('f')).toBe(false);
  });

  test('одно нажатие на «×» снимает отбор, и закрытые группы возвращаются', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: `Убрать отбор: ${CLOSED_CHIP}` }));
    expect(dataRows()).toHaveLength(GROUPS_TAKING);
    expect(screen.getByText(CLOSED_LEADER)).toBeInTheDocument();
    expect(activeChips().map((li) => li.textContent?.replace('×', ''))).toEqual([CANCELLED_CHIP, TAKES_NEW_CHIP]);
  });

  test('«Принимает новых» по умолчанию прячет группы с «Не направлять», служения и закрытые; чип снимается', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(2, { format: 'Служение' })) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    expect(screen.queryByText(NOT_TAKING_LEADER)).not.toBeInTheDocument();
    expect(screen.queryByText('Андрей М.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Убрать отбор: ${TAKES_NEW_CHIP}` }));
    expect(screen.getByText(NOT_TAKING_LEADER)).toBeInTheDocument();
    expect(screen.getByText('Андрей М.')).toBeInTheDocument();
  });

  test('снятый отбор не возвращается сам при обновлении страницы по той же ссылке', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const { unmount } = renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: `Убрать отбор: ${CLOSED_CHIP}` }));
    const url = `/?${currentSearch().toString()}`;
    unmount();
    renderAt(<App />, url);
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(GROUPS_TAKING);
  });

  test('«Сбросить всё» очищает и отбор по умолчанию', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Фильтры' })).getByRole('button', { name: 'Сбросить всё' }));
    expect(dataRows()).toHaveLength(GROUPS);
  });

  test('поиск по таблице не теряет отбор по умолчанию', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    // Закрытая группа тоже в Приморском районе; с отбором по умолчанию она не появляется.
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по таблице' }), 'Приморский');
    expect(dataRows()).toHaveLength(3);
    expect(screen.queryByText(CLOSED_LEADER)).not.toBeInTheDocument();
    expect(activeChips().map((li) => li.textContent?.replace('×', ''))).toEqual(DEFAULT_CHIPS);
  });

  test('аннулированная группа по умолчанию скрыта, как закрытая, и возвращается снятием своего чипа', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(2, { status: 'Аннулирована' })) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    expect(screen.queryByText('Андрей М.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Убрать отбор: ${CANCELLED_CHIP}` }));
    expect(screen.getByText('Андрей М.')).toBeInTheDocument();
  });

  test('явный отбор по статусу из адреса заменяет умолчание: по «Закрыта» остаётся только закрытая группа', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:eq:Закрыта'));
    await screen.findByRole('table');
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText(CLOSED_LEADER)).toBeInTheDocument();
    expect(activeChips()).toHaveLength(1);
  });

  test('при повторном открытии справочника отбор по умолчанию применяется заново', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: `Убрать отбор: ${CLOSED_CHIP}` }));
    expect(dataRows()).toHaveLength(GROUPS_TAKING);
    await user.click(screen.getByRole('button', { name: /^Люди/ }));
    await waitFor(() => expect(dataRows()).toHaveLength(PEOPLE));
    await user.click(screen.getByRole('button', { name: /^Группы/ }));
    await waitFor(() => expect(dataRows()).toHaveLength(GROUPS_SHOWN));
    expect(activeChips()).toHaveLength(3);
  });
});

describe('«Справочник»: ведущий и новые группы', () => {
  test('длинное ФИО ведущего обрезается в ячейке, а полное лежит в подсказке', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:eq:Закрыта'));
    const table = await screen.findByRole('table');
    const name = within(table).getByText(CLOSED_LEADER);
    expect(name).toHaveAttribute('title', CLOSED_LEADER);
    expect(name.className).toMatch(/leaderName/);
  });

  test('короткому имени подсказка не нужна', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Андрей М.')).not.toHaveAttribute('title');
  });

  test('у новой группы в таблице и в карточке есть значок «Новая группа», у обычной нет', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference');
    const table = await screen.findByRole('table');
    const rowOf = (leader: string) => within(table).getByText(leader).closest('tr') as HTMLElement;
    // В фикстурах новые: Светлана Р. (ДГ-0015), Дмитрий В. (ДГ-0019) и Татьяна Ф. (без номера).
    expect(within(rowOf('Светлана Р.')).getByRole('img', { name: 'Новая группа' })).toBeInTheDocument();
    expect(within(rowOf('Андрей М.')).queryByRole('img', { name: 'Новая группа' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Открыть карточку: Группа ДГ-0015, Светлана Р.' }));
    const card = await screen.findByRole('dialog', { name: 'Карточка группы ДГ-0015' });
    expect(within(within(card).getByRole('heading', { level: 2 })).getByRole('img', { name: 'Новая группа' })).toBeInTheDocument();
  });

  test('в карточке обычной группы значка нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&rec=2');
    const card = await screen.findByRole('dialog', { name: 'Карточка группы ДГ-0027' });
    expect(within(card).queryByRole('img', { name: 'Новая группа' })).not.toBeInTheDocument();
  });
});
