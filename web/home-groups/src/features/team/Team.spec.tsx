import type { Me, TeamView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { buildTeam } from '../../fixtures/team';
import { openCount } from '../../entities/buckets';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Сводка с разными числами в каждом поле: перепутанное поле плитки не пройдёт незамеченным. */
const view = (patch: Partial<TeamView> = {}): TeamView => ({
  generatedAt: '2026-10-09T09:00:00+03:00',
  totals: { open: 41, all: 120, done: 64, unassigned: 7, callback: 5, over7: 9, approvedWeek: 13, otherOpen: 4 },
  aging: [
    { label: '0–2 дня', count: 20 },
    { label: '3–7 дней', count: 12 },
    { label: '8–14 дней', count: 6 },
    { label: '15 дней и больше', count: 3 },
    { label: 'Дата неизвестна', count: 0 },
  ],
  workload: [
    { name: null, open: 7, callback: 0, over7: 2, oldestDays: 11 },
    { name: 'Анна Смирнова', open: 20, callback: 4, over7: 5, oldestDays: 16 },
    { name: 'Пётр Г.', open: 14, callback: 1, over7: 2, oldestDays: null },
  ],
  stuck: [
    { id: 5, fio: 'Наталья Белова', waitingDays: 16, responsible: 'Анна Смирнова', bucket: 'ready' },
    { id: 7, fio: 'Ольга Рябова', waitingDays: 9, responsible: null, bucket: 'human' },
  ],
  activity: [{ actor: 'mbv_admin', calls: 14, approved: 13, rejected: 2, edits: 9, assigned: 11 }],
  ...patch,
});

const meAs = (role: Me['role']) => () => json({ role });

function open(team: TeamView | (() => Response) = view(), role: Me['role'] = 'super') {
  const fetchMock = stubFetchWithFixtures({
    team: typeof team === 'function' ? team : () => json(team),
    me: meAs(role),
  });
  const utils = renderAt(<App />, '/?tab=team');
  return { fetchMock, ...utils };
}

const section = (name: string) => screen.getByRole('region', { name });

describe('«Команда»: вкладка', () => {
  test('вкладка «Команда» стоит после «Заявок» и «Групп» и открывается обоим входам', async () => {
    open(view(), 'admin');
    const tabs = screen.getByRole('tablist', { name: 'Разделы' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names[3]).toBe('Команда');
    expect(within(tabs).getByRole('tab', { name: 'Команда' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: 'Итоги по заявкам' })).toBeInTheDocument();
  });
});

describe('«Команда»: плитки и сроки ожидания', () => {
  test('плитки показывают итоги из сводки, каждая своё число', async () => {
    open();
    const tiles = await screen.findByRole('region', { name: 'Итоги по заявкам' });
    const numberOf = (label: string) => within(tiles).getByText(label).parentElement!;
    // Общее число, а не открытые: исполненные не вычтены, их число стоит рядом мелким шрифтом.
    expect(numberOf('Всего заявок')).toHaveTextContent('120');
    expect(numberOf('Всего заявок')).toHaveTextContent('исполнено 64');
    expect(numberOf('Никто не взял')).toHaveTextContent('7');
    expect(numberOf('Ждут звонка')).toHaveTextContent('5');
    expect(numberOf('Ждут больше недели')).toHaveTextContent('9');
    expect(numberOf('Утверждено за неделю')).toHaveTextContent('13');
  });

  test('сроки ожидания: у каждой полосы подпись и число текстом', async () => {
    open();
    const aging = await screen.findByRole('list', { name: 'Открытые заявки по сроку ожидания' });
    const rows = within(aging).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '0–2 дня20',
      '3–7 дней12',
      '8–14 дней6',
      '15 дней и больше3',
      'Дата неизвестна0',
    ]);
  });
});

describe('«Команда»: нагрузка', () => {
  test('таблица: имя, открыто, ждут звонка, дольше недели, самая старая; без имени — «Никто не взял», без даты — пометка', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Нагрузка по координаторам' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Координатор', 'Открыто', 'Ждут звонка', 'Дольше недели', 'Самая старая, дн.']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Никто не взял');
    expect(rows[0]).toHaveTextContent(/Никто не взял\s*7\s*0\s*2\s*11/);
    expect(rows[1]).toHaveTextContent(/Анна Смирнова\s*20\s*4\s*5\s*16/);
    expect(rows[2]).toHaveTextContent(/Пётр Г\.\s*14\s*1\s*2\s*—\s*нет данных/);
  });

  test('нажатие на имя открывает «Заявки» с отбором «В работе у» этого человека', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Анна Смирнова' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('resp')).toBe('Анна Смирнова');
  });

  test('«Никто не взял» в таблице открывает «Заявки» с отбором «Никто не взял»', async () => {
    const user = userEvent.setup();
    open();
    const table = await screen.findByRole('table', { name: 'Нагрузка по координаторам' });
    await user.click(within(table).getByRole('button', { name: 'Никто не взял' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('resp')).toBe('-');
  });

  test('без заявок вместо таблицы пояснение', async () => {
    open(view({ workload: [] }));
    expect(await screen.findByText('Открытых заявок нет.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Нагрузка по координаторам' })).toBeNull();
  });
});

describe('«Команда»: без движения', () => {
  test('список: ФИО, сколько ждёт и у кого; без ответственного — «Никто не взял»', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Заявки без движения' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Наталья Белова');
    expect(items[0]).toHaveTextContent('Ждёт 16 дней');
    expect(items[0]).toHaveTextContent('В работе: Анна Смирнова');
    expect(items[1]).toHaveTextContent('Ждёт 9 дней');
    expect(items[1]).toHaveTextContent('Никто не взял');
  });

  test('нажатие на заявку открывает её на вкладке «Заявки»', async () => {
    const user = userEvent.setup();
    open();
    const list = await screen.findByRole('list', { name: 'Заявки без движения' });
    await user.click(within(list).getByRole('button', { name: /Ольга Рябова/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('7');
  });

  test('если таких заявок нет, так и написано', async () => {
    open(view({ stuck: [] }));
    expect(await screen.findByText('Таких заявок нет.')).toBeInTheDocument();
  });
});

describe('«Команда»: что сделано за неделю', () => {
  test('таблица по логинам и пояснение про общий вход', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Действия за 7 дней по логинам' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Логин',
      'Звонков',
      'Утверждено',
      'Отказов',
      'Правок',
      'Передач',
    ]);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(/mbv_admin\s*14\s*13\s*2\s*9\s*11/);
    expect(
      screen.getByText(
        'Пока вход общий, все действия записываются под одним именем. Когда включатся личные входы, здесь будет видно, кто что делал.',
      ),
    ).toBeInTheDocument();
  });

  test('без действий таблицы нет, пояснение остаётся', async () => {
    open(view({ activity: [] }));
    expect(await screen.findByText('За 7 дней действий не было.')).toBeInTheDocument();
    expect(screen.getByText(/Пока вход общий/)).toBeInTheDocument();
  });
});

describe('«Команда»: выгрузка', () => {
  test('полный вход видит две ссылки на скачивание и предупреждение про телефоны', async () => {
    open();
    const box = await screen.findByRole('region', { name: 'Выгрузка' });
    const requests = within(box).getByRole('link', { name: 'Скачать заявки (CSV)' });
    const people = within(box).getByRole('link', { name: 'Скачать людей (CSV)' });
    expect(requests.getAttribute('href')).toMatch(/\/api\/v1\/export\/requests\.csv$/);
    expect(people.getAttribute('href')).toMatch(/\/api\/v1\/export\/people\.csv$/);
    expect(requests).toHaveAttribute('download');
    expect(people).toHaveAttribute('download');
    expect(within(box).getByText('В файле телефоны. Не пересылайте его в мессенджерах и не оставляйте в общих папках.')).toBeInTheDocument();
  });

  test('обычному входу блока «Выгрузка» нет', async () => {
    const { fetchMock } = open(view(), 'admin');
    await screen.findByRole('region', { name: 'Итоги по заявкам' });
    // Роль приходит отдельным запросом: ждём именно его, иначе «нет блока» было бы просто «ещё не пришло».
    await waitFor(() => expect(getsOf(fetchMock, 'me')).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Выгрузка' })).toBeNull());
    expect(screen.queryByRole('link', { name: /CSV/ })).toBeNull();
    expect(screen.queryByText(/В файле телефоны/)).toBeNull();
  });
});

describe('«Команда»: загрузка и обновление', () => {
  test('при сбое видна ошибка с «Повторить», повтор перечитывает сводку', async () => {
    const user = userEvent.setup();
    let failing = true;
    open(() => (failing ? json({ error: 'x' }, 500) : json(view())));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Не удалось загрузить.')).toBeInTheDocument();
    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('region', { name: 'Итоги по заявкам' })).toBeInTheDocument();
  });

  test('сводка запрашивается с сервера, а не берётся из «Заявок»', async () => {
    const { fetchMock } = open();
    await screen.findByRole('region', { name: 'Итоги по заявкам' });
    expect(getsOf(fetchMock, 'team')).toBe(1);
  });
});

describe('«Команда»: демо-данные', () => {
  test('сводка в фикстурах сходится с заявками: открытых столько же, сколько в «Заявках»', () => {
    const team = buildTeam();
    expect(team.totals.open).toBe(openCount(buildRequests().counters));
    expect(team.workload.reduce((sum, w) => sum + w.open, 0)).toBe(team.totals.open);
    expect(team.aging.reduce((sum, a) => sum + a.count, 0)).toBe(team.totals.open);
  });
});
