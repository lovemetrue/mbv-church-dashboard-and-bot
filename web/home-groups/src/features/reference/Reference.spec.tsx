import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { coordinatorsConfig, groupsConfig, peopleConfig } from './config';

afterEach(() => vi.unstubAllGlobals());

const SOON = 'Появится на следующем этапе';

/** Строки данных (без шапки и заголовков групп). */
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.querySelector('td'));

describe('«Справочник»: конфигурация', () => {
  test('по умолчанию у групп восемь столбцов, как в макете', () => {
    expect(groupsConfig.defaultColumns).toEqual(['№', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Здоровье']);
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
      expect(within(sw).getAllByRole('button').map((b) => b.textContent)).toEqual(['Группы12', 'Люди23', 'Координаторы4']),
    );
    expect(within(sw).getByRole('button', { name: /^Группы/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('таблица групп показывает восемь столбцов по умолчанию и «Показано 12 из 12»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    const table = await screen.findByRole('table');
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(heads).toEqual(['№', 'Ведущий', 'Район', 'Возраст', 'Когда', 'Места', 'Статус', 'Здоровье']);
    expect(screen.getByText('Показано 12 из 12')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(12);
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
    expect(screen.getByText('Показано 1 из 12')).toBeInTheDocument();
    expect(currentSearch().getAll('f')).toEqual(['Статус:eq:На паузе']);
    // чип можно убрать
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Убрать отбор: Статус = На паузе' }));
    expect(dataRows()).toHaveLength(12);
    expect(currentSearch().has('f')).toBe(false);
  });

  test('отбор из адреса применяется при загрузке страницы', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Район:eq:Приморский'));
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
    expect(currentSearch().getAll('f')).toEqual(['Мест свободно:ge:6']);
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
    expect(dataRows()).toHaveLength(12);
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
    expect(dataRows()).toHaveLength(12);
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
    const firstCol = () => dataRows().map((r) => within(r).getAllByRole('cell')[1]!.textContent);
    await user.click(within(table).getByRole('button', { name: 'Сортировать по столбцу «Ведущий»' }));
    expect(firstCol()[0]).toBe('Андрей М.');
    expect(within(table).getByRole('columnheader', { name: /Ведущий/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(table).getByRole('button', { name: 'Сортировать по столбцу «Ведущий»' }));
    expect(firstCol()[0]).toBe('Татьяна Ф.');
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
    expect(dataRows()).toHaveLength(2);
    expect(await screen.findByText('Показано 2 из 12')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Открыть карточку: Группа №27, Андрей М.' }));
    expect(currentSearch().get('rec')).toBe('2');
    const card = await screen.findByRole('dialog', { name: 'Карточка группы №27' });
    expect(within(card).getByText('Здоровье')).toBeInTheDocument();
    expect(within(card).getByRole('meter', { name: /Здоровье: 100 из 100/ })).toBeInTheDocument();
    expect(within(card).getAllByText(/Ведущий указан|Телефон ведущего|Вместимость указана/).length).toBe(3);
    expect(within(card).getByText('Данные группы')).toBeInTheDocument();
    expect(within(card).getByText('Направлено планом')).toBeInTheDocument();
    expect(within(card).getByText('Руслан Агеев')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Спросить ведущего в боте' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Спросить ведущего в боте' })).toHaveAttribute('aria-description', SOON);
    // таблица осталась на месте и со всеми строками
    expect(dataRows()).toHaveLength(12);
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
    const card = await screen.findByRole('dialog', { name: /Карточка группы №12/ });
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

  test('координатор: карточка показывает его группы', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference&ent=coordinators&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка координатора/ });
    await waitFor(() => expect(within(card).getByText(/№12 · Ольга К\./)).toBeInTheDocument());
    expect(within(card).getByText(/№31 · Марина Л\./)).toBeInTheDocument();
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

  test('«Выгрузить CSV» показана, но отключена', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=reference');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Выгрузить CSV' })).toBeDisabled();
  });

  test('смена сущности сбрасывает отборы прежней: поля у людей другие', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&f=' + encodeURIComponent('Статус:eq:На паузе'));
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^Люди/ }));
    expect(currentSearch().get('ent')).toBe('people');
    expect(currentSearch().has('f')).toBe(false);
    await waitFor(() => expect(dataRows()).toHaveLength(23));
  });
});
