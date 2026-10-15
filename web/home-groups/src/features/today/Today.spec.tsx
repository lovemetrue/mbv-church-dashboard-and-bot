import type { MatrixCell, MatrixRow, TodayView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { App } from '../../app/App';
import { buildGroups, buildRequests, buildToday } from '../../fixtures/build';
import { TodayContent } from './TodayScreen';
import { cellSummary, hiddenNote, inDistrict, urgentDistricts } from './model';

const NOW = new Date(2026, 9, 9, 9, 0);

beforeEach(() => {
  // Состояние матрицы живёт в sessionStorage; setup.ts чистит только localStorage.
  window.sessionStorage.clear();
  stubFetchWithFixtures();
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Кнопка-клетка таблицы: имя начинается с «Район, возраст:». */
const cellBtn = (district: string, age: string) =>
  screen.getByRole('button', { name: (n) => n.startsWith(`${district}, ${age}:`) });

const cellOf = (district: string, age: string): MatrixCell =>
  buildToday().matrix.find((r) => r.district === district)!.cells.find((c) => c.age === age)!;

const knownCells = () =>
  buildToday()
    .matrix.filter((r) => r.district !== 'Район не определён')
    .flatMap((r) => r.cells.filter((c) => c.age !== 'Возраст не указан').map((cell) => ({ district: r.district, cell })));

/** Клетка, где есть и новая, и обычная группа: на ней проверяется порядок и значок. */
function mixedCell() {
  const groups = new Map(buildGroups().items.map((g) => [g.id, g]));
  return knownCells().find(({ cell }) => {
    const flags = cell.groupIds.map((id) => groups.get(id)!.isNew);
    return flags.includes(true) && flags.includes(false);
  })!;
}

/** Строки в тестах задаются без итога мест: по умолчанию он равен сумме по ячейкам (когда групп с несколькими возрастами нет). */
type RowInput = Omit<MatrixRow, 'supplyTotal'> & { supplyTotal?: number };
const matrixData = (rows: RowInput[], ageColumns: string[]): TodayView => ({
  ...buildToday(),
  matrix: rows.map((r) => ({ ...r, supplyTotal: r.supplyTotal ?? r.cells.reduce((s, c) => s + c.supply, 0) })),
  ageColumns,
});
const mkCell = (age: string, demand: number, supply: number, extra: Partial<MatrixCell> = {}): MatrixCell => ({
  age,
  demand,
  supply,
  net: supply - demand,
  level: demand > 0 && supply === 0 ? 'crit' : supply - demand < 0 ? 'warn' : supply === 0 ? 'zero' : 'ok',
  requestIds: Array.from({ length: demand }, (_, i) => 900 + i),
  groupIds: supply > 0 ? [1] : [],
  ...extra,
});

describe('«Сегодня»: счётчики и обзвон', () => {
  test('показывает два счётчика, и «Перезвонить» без звонков честно равно 0', async () => {
    renderAt(<App />);
    const group = await screen.findByRole('group', { name: 'Что ждёт вас сегодня' });
    const ready = within(group).getByRole('button', { name: /Готово к утверждению/ });
    const callback = within(group).getByRole('button', { name: /Перезвонить/ });
    expect(ready).toHaveTextContent(String(buildRequests().counters.ready));
    expect(callback).toHaveTextContent(/^0/);
  });

  test('счётчик «Готово к утверждению» ведёт на «Заявки» с этим фильтром', async () => {
    const user = userEvent.setup();
    renderAt(<App />);
    await user.click(await screen.findByRole('button', { name: /Готово к утверждению/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('bucket')).toBe('ready');
  });

  test('приветствие зависит от времени суток и обходится без имени', () => {
    const data = buildToday();
    const { unmount } = renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 20, 0)} />);
    expect(screen.getByRole('heading', { name: 'Добрый вечер.' })).toBeInTheDocument();
    unmount();
    renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 7, 0)} />);
    expect(screen.getByRole('heading', { name: 'Доброе утро.' })).toBeInTheDocument();
  });

  test('«Начать обзвон» ведёт в «Заявки» с отбором «К обзвону» и открывает первую заявку очереди', async () => {
    const view = buildRequests();
    const first = view.items.find((i) => i.bucket === 'callback' || i.bucket === 'ready')!;
    stubFetchWithFixtures({ requests: () => json({ ...view, matching: { ...view.matching, saved: 3 } }) });
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    await screen.findByText(/Предложено автоматически/); // заявки загружены
    await user.click(screen.getByRole('button', { name: /Начать обзвон \(\d+\)/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('bucket')).toBe('queue');
    expect(currentSearch().get('req')).toBe(String(first.id));
  });

  test('если очередь пуста, кнопка отключена и подписана «Очередь пуста»', () => {
    const base = buildToday();
    const data = { ...base, counters: { ...base.counters, ready: 0, callback: 0 } };
    renderAt(<TodayContent data={data} now={NOW} />);
    expect(screen.getByText('Звонить сегодня некому.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Очередь пуста/ })).toBeDisabled();
  });
});

describe('«Сегодня»: виджеты верхнего ряда', () => {
  test('виджет «Нужна помощь» показывает число заявок и ведёт на фильтр «нужна помощь»', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const widget = screen.getByRole('region', { name: 'Нужна помощь в сопоставлении' });
    expect(within(widget).getByText(String(buildToday().counters.human))).toBeInTheDocument();
    await user.click(within(widget).getByRole('button', { name: 'Открыть список' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('bucket')).toBe('human');
  });

  test('в виджете «Нужна помощь» не больше трёх ситуаций, остальные — в списке', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ requestId: 100 + i, fio: `Человек ${i + 1}`, place: null, reason: 'Место не распознано' }));
    renderAt(<TodayContent data={{ ...buildToday(), clusters: [], singles: many }} now={NOW} />);
    const widget = screen.getByRole('region', { name: 'Нужна помощь в сопоставлении' });
    expect(within(widget).getAllByRole('listitem')).toHaveLength(3);
  });

  test('ситуация из виджета «Нужна помощь» открывает свою заявку', async () => {
    const user = userEvent.setup();
    const singles = [{ requestId: 8, fio: 'Станислав Ким', place: null, reason: 'Место не распознано' }];
    renderAt(<TodayContent data={{ ...buildToday(), clusters: [], singles }} now={NOW} />);
    await user.click(screen.getByRole('button', { name: /Станислав Ким/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('8');
  });

  test('если помощь не нужна, вместо ситуаций — спокойное сообщение', () => {
    const data = { ...buildToday(), clusters: [], singles: [] };
    renderAt(<TodayContent data={data} now={NOW} />);
    expect(screen.getByText('Таких заявок нет: система справилась со всеми.')).toBeInTheDocument();
  });

  test('виджет «Утверждено» показывает число, прирост за сегодня и ведёт на «Утверждено»', async () => {
    const user = userEvent.setup();
    const data = { ...buildToday(), approvedToday: 2 };
    renderAt(<TodayContent data={data} now={NOW} />);
    const widget = screen.getByRole('region', { name: 'Утверждено' });
    expect(within(widget).getByText(String(data.counters.done))).toBeInTheDocument();
    expect(within(widget).getByText('сегодня: +2')).toBeInTheDocument();
    await user.click(within(widget).getByRole('button', { name: 'Открыть список' }));
    expect(currentSearch().get('bucket')).toBe('done');
  });

  test('«Срочно нужна группа»: назван район, где не хватает больше всего мест, и сколько людей остаётся без места', () => {
    const data = matrixData(
      [
        { district: 'Приморский', cells: [mkCell('26–35', 3, 1), mkCell('36–45', 1, 0)] },
        { district: 'Невский', cells: [mkCell('26–35', 6, 0)] },
        { district: 'Выборгский', cells: [mkCell('26–35', 1, 5)] },
        { district: 'Район не определён', cells: [mkCell('26–35', 9, 0)] },
      ],
      ['26–35', '36–45'],
    );
    renderAt(<TodayContent data={data} now={NOW} />);
    const widget = screen.getByRole('region', { name: 'Срочно нужна группа' });
    expect(within(widget).getByText('в Невском районе')).toBeInTheDocument();
    expect(within(widget).getByText('ждут 6 человек, свободных мест 0: не хватает 6 человек')).toBeInTheDocument();
    // Приморский — следующий (ждут 4, мест 1); Выборгский, где мест больше, чем людей, и неопределённый район в список не попадают.
    const more = within(widget).getByRole('list', { name: 'Другие районы, где не хватает групп' });
    expect(within(more).getByText('Приморский')).toBeInTheDocument();
    expect(within(more).queryByText('Выборгский')).not.toBeInTheDocument();
    expect(within(widget).queryByText('Район не определён')).not.toBeInTheDocument();
  });

  test('«Срочно нужна группа»: если мест хватает везде, так и сказано, а кнопки нет', () => {
    const data = matrixData([{ district: 'Невский', cells: [mkCell('26–35', 1, 4)] }], ['26–35']);
    renderAt(<TodayContent data={data} now={NOW} />);
    const widget = screen.getByRole('region', { name: 'Срочно нужна группа' });
    expect(within(widget).getByText(/хватает мест/)).toBeInTheDocument();
    expect(within(widget).queryByRole('button')).not.toBeInTheDocument();
  });

  test('«Открыть группы» из виджета ведёт на вкладку «Группы»', async () => {
    const user = userEvent.setup();
    const data = matrixData([{ district: 'Невский', cells: [mkCell('26–35', 2, 0)] }], ['26–35']);
    renderAt(<TodayContent data={data} now={NOW} />);
    await user.click(within(screen.getByRole('region', { name: 'Срочно нужна группа' })).getByRole('button', { name: 'Открыть группы' }));
    expect(currentSearch().get('tab')).toBe('groups');
  });

  test('если сегодня никого не утвердили, так и написано', () => {
    renderAt(<TodayContent data={{ ...buildToday(), approvedToday: 0 }} now={NOW} />);
    expect(screen.getByText('сегодня пока никого')).toBeInTheDocument();
  });

  test('показатель «Предложено автоматически» берёт данные из «Заявок», а пока они не пришли — не рисуется', async () => {
    const view = buildRequests();
    stubFetchWithFixtures({ requests: () => json({ ...view, matching: { ...view.matching, saved: 7 } }) });
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    expect(screen.queryByText(/Предложено автоматически/)).not.toBeInTheDocument();
    const c = view.counters;
    expect(await screen.findByText(`Предложено автоматически: 7 из ${c.ready + c.callback + c.human}`)).toBeInTheDocument();
  });

  test('показатель «Предложено автоматически» объясняет себя подсказкой при фокусе с клавиатуры', async () => {
    const view = buildRequests();
    stubFetchWithFixtures({ requests: () => json({ ...view, matching: { ...view.matching, saved: 7 } }) });
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const saved = await screen.findByText(/Предложено автоматически/);
    await user.tab(); // доходим до первой фокусируемой кнопки; показатель — после неё
    saved.closest<HTMLElement>('[tabindex]')!.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Предложенная группа не меняется сама, пока подходит');
  });
});

describe('«Сегодня»: таблица спроса и предложения', () => {
  test('таблица рисуется по данным: заголовки возрастов, названия районов и особые строка с колонкой', () => {
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const matrix = within(screen.getByRole('region', { name: /Таблица: районы и возрастные группы/ })).getByRole('table');
    const today = buildToday();
    for (const age of today.ageColumns) expect(within(matrix).getByRole('columnheader', { name: new RegExp(`^${age.replace('+', '\\+')}`) })).toBeInTheDocument();
    for (const row of today.matrix) expect(within(matrix).getByRole('rowheader', { name: new RegExp(`^${row.district}`) })).toBeInTheDocument();
    expect(within(matrix).getByRole('rowheader', { name: /Район не определён/ })).toBeInTheDocument();
    expect(within(matrix).getByRole('columnheader', { name: /Возраст не указан/ })).toBeInTheDocument();
  });

  test('подпись клетки в режиме «Баланс»: знак и слова «не хватает», мелко — сколько ждут и сколько мест', () => {
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = knownCells().find(({ cell }) => cell.level === 'crit')!;
    const btn = cellBtn(district, cell.age);
    expect(btn).toHaveTextContent(`−${cell.demand}`);
    expect(btn).toHaveTextContent('не хватает');
    expect(btn).toHaveTextContent(`ждут ${cell.demand} · мест ${cell.supply}`);
    // Минус — настоящий знак минус, а не дефис: иначе «-2» читается как тире.
    expect(btn.textContent).not.toContain('-');
    const ok = knownCells().find(({ cell }) => cell.net > 0)!;
    expect(cellBtn(ok.district, ok.cell.age)).toHaveTextContent(`+${ok.cell.net}`);
    expect(cellBtn(ok.district, ok.cell.age)).toHaveTextContent('хватает');
  });

  test('режим «Ждут» показывает число желающих, а «Места» — число свободных мест', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = knownCells().find(({ cell }) => cell.demand > 0 && cell.supply > 0)!;
    await user.click(screen.getByRole('button', { name: 'Ждут' }));
    expect(screen.getByRole('button', { name: 'Ждут' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cellBtn(district, cell.age)).getByText(String(cell.demand))).toBeInTheDocument();
    expect(cellBtn(district, cell.age)).not.toHaveTextContent('хватает');
    await user.click(screen.getByRole('button', { name: 'Места' }));
    expect(within(cellBtn(district, cell.age)).getByText(String(cell.supply))).toBeInTheDocument();
    expect(cellBtn(district, cell.age)).toHaveTextContent(/мест/);
  });

  test('выбранный режим запоминается при перезагрузке страницы', async () => {
    const user = userEvent.setup();
    const first = renderAt(<TodayContent data={buildToday()} now={NOW} />);
    await user.click(screen.getByRole('button', { name: 'Места' }));
    await user.click(screen.getByRole('button', { name: 'По алфавиту' }));
    first.unmount();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Места' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'По алфавиту' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('подсказка при наведении объясняет клетку фразой со склонениями', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = knownCells().find(({ cell }) => cell.level === 'crit')!;
    const btn = cellBtn(district, cell.age);
    await user.hover(btn);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(cellSummary(district, cell.age, cell));
    expect(tip).toHaveTextContent(/ждут \d+ человек/);
    expect(tip).toHaveTextContent(/Не хватает \d+ мест/);
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    await user.unhover(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('подсказка появляется и при фокусе с клавиатуры, а Esc её убирает', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = knownCells().find(({ cell }) => cell.net > 0)!;
    const btn = cellBtn(district, cell.age);
    btn.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Мест хватает с запасом \d+\./);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('итог по строке берёт места без двойного счёта (supplyTotal), а по столбцу — сумму клеток', () => {
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const today = buildToday();
    const table = within(screen.getByRole('region', { name: /Таблица: районы и возрастные группы/ })).getByRole('table');
    const row = today.matrix.find((r) => r.district === 'Приморский')!;
    const demand = row.cells.reduce((s, c) => s + c.demand, 0);
    // Группа с несколькими возрастами входит в несколько клеток, а в итоге района — один раз.
    const supply = row.supplyTotal;
    const tr = within(table).getByRole('rowheader', { name: /^Приморский/ }).closest('tr')!;
    const rowTotal = tr.lastElementChild!;
    expect(rowTotal).toHaveTextContent(`ждут ${demand}`);
    expect(rowTotal).toHaveTextContent(`мест ${supply}`);
    expect(supply).toBeLessThanOrEqual(row.cells.reduce((s, c) => s + c.supply, 0));
    const col = today.matrix.flatMap((r) => r.cells).filter((c) => c.age === '26–35');
    const foot = within(table).getByRole('rowheader', { name: 'Всего' }).closest('tr')!;
    const idx = today.ageColumns.indexOf('26–35') + 1;
    const cellFoot = foot.children[idx]!;
    expect(cellFoot).toHaveTextContent(`ждут ${col.reduce((s, c) => s + c.demand, 0)}`);
    expect(cellFoot).toHaveTextContent(`мест ${col.reduce((s, c) => s + c.supply, 0)}`);
  });

  test('пустые районы и возраста скрыты по умолчанию, а переключатель возвращает их', async () => {
    const user = userEvent.setup();
    const base = buildToday();
    const data = matrixData(
      [
        ...base.matrix.map((r) => ({ ...r, cells: [...r.cells, mkCell('55+', 0, 0)] })),
        { district: 'Колпинский', cells: [...base.ageColumns, '55+'].map((a) => mkCell(a, 0, 0)) },
      ],
      [...base.ageColumns, '55+'],
    );
    renderAt(<TodayContent data={data} now={NOW} />);
    const toggle = screen.getByRole('checkbox', { name: 'Скрывать пустые районы и возраста' });
    expect(toggle).toBeChecked();
    expect(screen.queryByRole('rowheader', { name: 'Колпинский' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '55+' })).not.toBeInTheDocument();
    expect(screen.getByText('Скрыто: 1 пустой район, 1 пустой возраст.')).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('rowheader', { name: 'Колпинский' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '55+' })).toBeInTheDocument();
  });

  test('районы идут сначала где хуже, а «По алфавиту» меняет порядок; особая строка всегда последняя', async () => {
    const user = userEvent.setup();
    const ages = ['18–25'];
    const data = matrixData(
      [
        { district: 'Адмиралтейский', cells: [mkCell('18–25', 1, 5)] },
        { district: 'Невский', cells: [mkCell('18–25', 6, 1)] },
        { district: 'Район не определён', cells: [mkCell('18–25', 9, 0)] },
        { district: 'Кировский', cells: [mkCell('18–25', 3, 1)] },
      ],
      ages,
    );
    renderAt(<TodayContent data={data} now={NOW} />);
    const order = () =>
      within(screen.getByRole('region', { name: /Таблица: районы/ }))
        .getAllByRole('rowheader')
        .map((h) => h.textContent ?? '')
        .filter((t) => !t.startsWith('Всего'))
        .map((t) => t.replace(/заявки без района$/, ''));
    expect(order()).toEqual(['Невский', 'Кировский', 'Адмиралтейский', 'Район не определён']);
    await user.click(screen.getByRole('button', { name: 'По алфавиту' }));
    expect(order()).toEqual(['Адмиралтейский', 'Кировский', 'Невский', 'Район не определён']);
  });

  test('легенда цветов — одной строкой под таблицей', () => {
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    expect(screen.getByText('есть желающие, мест нет')).toBeInTheDocument();
    expect(screen.getByText('мест меньше, чем желающих')).toBeInTheDocument();
    expect(screen.getByText('мест хватает')).toBeInTheDocument();
  });
});

describe('«Сегодня»: панель клетки', () => {
  test('клик по клетке открывает правую панель с двумя вкладками и счётчиками', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = mixedCell();
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog', { name: `Клетка таблицы: ${district} · ${cell.age}` });
    expect(within(panel).getByRole('heading', { name: `${district} · ${cell.age}` })).toBeInTheDocument();
    expect(within(panel).getByText(cellSummary(district, cell.age, cell))).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: `Желающие (${cell.requestIds.length})` })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByRole('tab', { name: `Группы (${cell.groupIds.length})` })).toBeInTheDocument();
  });

  test('у новой группы в списке есть значок «Новая группа», у обычной нет, и новые идут первыми', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = mixedCell();
    const groups = new Map(buildGroups().items.map((g) => [g.id, g]));
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: /^Группы/ }));
    const rows = await within(panel).findAllByRole('button', { name: /ДГ-/ });
    expect(rows).toHaveLength(cell.groupIds.length);
    const flags = rows.map((row) => within(row).queryByRole('img', { name: 'Новая группа' }) !== null);
    // значок стоит ровно у новых групп
    expect(flags.filter(Boolean)).toHaveLength(cell.groupIds.filter((id) => groups.get(id)!.isNew).length);
    // и все такие строки — выше обычных
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(flags[0]).toBe(true);
    expect(flags.at(-1)).toBe(false);
  });

  test('новая группа стоит первой, даже когда в ней меньше всего свободных мест', async () => {
    const user = userEvent.setup();
    const { district, cell } = mixedCell();
    const view = buildGroups();
    const inCell = view.items.filter((g) => cell.groupIds.includes(g.id));
    const fewest = [...inCell].sort((a, b) => a.free - b.free)[0]!;
    const items = view.items.map((g) => ({ ...g, isNew: g.id === fewest.id }));
    stubFetchWithFixtures({ groups: () => json({ ...view, items }) });
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: /^Группы/ }));
    const rows = await within(panel).findAllByRole('button', { name: /ДГ-/ });
    expect(rows[0]).toHaveTextContent(fewest.code);
    expect(within(rows[0]!).getByRole('img', { name: 'Новая группа' })).toBeInTheDocument();
  });

  test('клик по группе открывает её карточку, «назад» возвращает к списку', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = mixedCell();
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: /^Группы/ }));
    const [row] = await within(panel).findAllByRole('button', { name: /ДГ-/ });
    const code = /ДГ-\d+/.exec(row!.textContent ?? '')![0];
    await user.click(row!);
    const card = await screen.findByRole('dialog', { name: `Карточка группы ${code}` });
    expect(within(card).getByText('Ведущий')).toBeInTheDocument();
    expect(within(card).getByText('Не направлять')).toBeInTheDocument();
    expect(within(card).getByText('Кого план направляет сюда')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Открыть в справочнике' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Назад к списку групп/ }));
    expect(await screen.findByRole('tab', { name: /^Группы/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('button', { name: /ДГ-/ }).length).toBe(cell.groupIds.length);
  });

  test('«Открыть в справочнике» ведёт на запись группы', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = mixedCell();
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: /^Группы/ }));
    const [row] = await within(panel).findAllByRole('button', { name: /ДГ-/ });
    await user.click(row!);
    await user.click(await screen.findByRole('button', { name: 'Открыть в справочнике' }));
    expect(currentSearch().get('tab')).toBe('reference');
    expect(cell.groupIds.map(String)).toContain(currentSearch().get('rec'));
  });

  test('клик по желающему ведёт на «Заявки» с этой заявкой', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = knownCells().find(({ cell }) => cell.demand > 0)!;
    const items = buildRequests().items;
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    const target = items.find((i) => i.id === cell.requestIds[0])!;
    const rows = await within(panel).findAllByRole('button', { name: /./ });
    const row = rows.find((b) => b.textContent?.includes(target.fio))!;
    expect(row).toBeDefined();
    await user.click(row);
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe(String(target.id));
  });

  test('строка «Район не определён» кликабельна: желающие есть, а на вкладке «Группы» — пояснение', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const row = buildToday().matrix.find((r) => r.district === 'Район не определён')!;
    const cell = row.cells.find((c) => c.demand > 0 && c.age !== 'Возраст не указан')!;
    await user.click(cellBtn('Район не определён', cell.age));
    const panel = await screen.findByRole('dialog', { name: `Клетка таблицы: Район не определён · ${cell.age}` });
    const target = buildRequests().items.find((i) => i.id === cell.requestIds[0])!;
    expect(await within(panel).findByText(target.fio)).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'Группы (0)' }));
    expect(within(within(panel).getByRole('tabpanel')).getByText('Для заявок без района группы не подбираются.')).toBeInTheDocument();
  });

  test('колонка «Возраст не указан» тоже открывает список желающих', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const found = buildToday()
      .matrix.flatMap((r) => r.cells.map((cell) => ({ district: r.district, cell })))
      .find(({ cell }) => cell.age === 'Возраст не указан' && cell.demand > 0)!;
    await user.click(cellBtn(found.district, 'Возраст не указан'));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: 'Группы (0)' }));
    expect(within(within(panel).getByRole('tabpanel')).getByText('Для заявок без возраста группы не подбираются.')).toBeInTheDocument();
  });

  test('Esc в карточке группы возвращает к списку, а не закрывает панель', async () => {
    const user = userEvent.setup();
    renderAt(<TodayContent data={buildToday()} now={NOW} />);
    const { district, cell } = mixedCell();
    await user.click(cellBtn(district, cell.age));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('tab', { name: /^Группы/ }));
    const [row] = await within(panel).findAllByRole('button', { name: /ДГ-/ });
    await user.click(row!);
    const back = await screen.findByRole('button', { name: /Назад к списку групп/ });
    back.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Назад к списку групп/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: `Клетка таблицы: ${district} · ${cell.age}` })).toBeInTheDocument();
  });
});

describe('«Сегодня»: чистые функции', () => {
  const mk = (demand: number, supply: number, groups: number): MatrixCell => ({
    age: '26–35',
    demand,
    supply,
    net: supply - demand,
    level: 'ok',
    requestIds: [],
    groupIds: Array.from({ length: groups }, (_, i) => i + 1),
  });

  test('фраза-итог: мест хватает с запасом, склонения «человек», «мест», «группах»', () => {
    expect(cellSummary('Выборгский', '26–35', mk(1, 10, 2))).toBe(
      'Выборгский район, 26–35 лет: ждут 1 человек, свободно 10 мест в 2 группах. Мест хватает с запасом 9.',
    );
    expect(cellSummary('Невский', '46+', mk(2, 1, 1))).toBe(
      'Невский район, 46+ лет: ждут 2 человека, свободно 1 место в 1 группе. Не хватает 1 места.',
    );
  });

  test('фраза-итог: не хватает нескольких мест и пустая клетка', () => {
    expect(cellSummary('Невский', '18–25', mk(5, 3, 1))).toContain('Не хватает 2 мест.');
    expect(cellSummary('Невский', '18–25', mk(7, 0, 0))).toContain('свободных мест нет. Не хватает 7 мест.');
    expect(cellSummary('Невский', '18–25', mk(0, 0, 0))).toBe('Невский район, 18–25 лет: нет ни желающих, ни мест.');
  });

  test('фраза-итог для особых строки и колонки говорит, что группы не подбираются', () => {
    expect(cellSummary('Район не определён', '26–35', mk(2, 0, 0))).toBe(
      'Район не определён, 26–35 лет: ждут 2 человека. Для заявок без района группы не подбираются.',
    );
  });

  test('«Скрыто: …» согласует числительные', () => {
    expect(hiddenNote(2, 0)).toBe('Скрыто: 2 пустых района.');
    expect(hiddenNote(5, 1)).toBe('Скрыто: 5 пустых районов, 1 пустой возраст.');
    expect(hiddenNote(0, 0)).toBe('');
  });
});

describe('«Сегодня» в приложении', () => {
  test('экран «Сегодня» целиком открывается из приложения и показывает таблицу', async () => {
    renderAt(<App />);
    expect(await screen.findByRole('region', { name: /Таблица: районы и возрастные группы/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Нужна помощь в сопоставлении' })).toBeInTheDocument());
  });
});

describe('«Срочно нужна группа»: расчёт', () => {
  const row = (district: string, cells: MatrixCell[], supplyTotal?: number): MatrixRow => ({ district, supplyTotal: supplyTotal ?? cells.reduce((s, c) => s + c.supply, 0), cells });

  test('нехватка — это спрос минус свободные места района; сначала где не хватает больше, при равенстве — где больше ждущих', () => {
    const list = urgentDistricts([
      row('А', [mkCell('26–35', 4, 2)]),
      row('Б', [mkCell('26–35', 5, 3)]),
      row('В', [mkCell('26–35', 2, 0)]),
      row('Г', [mkCell('26–35', 6, 6)]),
    ]);
    // Нехватка у всех троих по два человека, поэтому порядок решает число ждущих: Б (5), А (4), В (2).
    expect(list.map((d) => d.deficit)).toEqual([2, 2, 2]);
    expect(list.map((d) => d.district)).toEqual(['Б', 'А', 'В']);
  });

  test('места района считаются без двойного счёта: берётся supplyTotal, а не сумма по возрастным клеткам', () => {
    // Группа с двумя возрастами стоит в обеих клетках (supply 5 + 5), но мест в районе всего 5.
    const list = urgentDistricts([row('Невский', [mkCell('18–25', 4, 5), mkCell('26–35', 4, 5)], 5)]);
    expect(list).toEqual([{ district: 'Невский', demand: 8, supply: 5, deficit: 3 }]);
  });

  test('«Район не определён» не в счёте, как и районы, где мест хватает', () => {
    expect(urgentDistricts([row('Район не определён', [mkCell('26–35', 9, 0)]), row('Невский', [mkCell('26–35', 1, 1)])])).toEqual([]);
  });

  test.each([
    ['Приморский', 'в Приморском районе'],
    ['Центральный', 'в Центральном районе'],
    ['Петродворцовый', 'в Петродворцовом районе'],
    ['Ленинградская область', 'в Ленинградской области'],
    ['Онлайн', 'онлайн'],
  ])('«%s» → «%s»', (district, expected) => {
    expect(inDistrict(district)).toBe(expected);
  });
});

