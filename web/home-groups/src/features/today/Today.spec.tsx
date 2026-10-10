import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { App } from '../../app/App';
import { buildToday } from '../../fixtures/build';
import { TodayContent } from './TodayScreen';

afterEach(() => vi.unstubAllGlobals());

describe('«Сегодня»', () => {
  test('показывает два счётчика, и «Перезвонить» без звонков честно равно 0', async () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const group = await screen.findByRole('group', { name: 'Что ждёт вас сегодня' });
    const ready = within(group).getByRole('button', { name: /Готово к утверждению/ });
    const callback = within(group).getByRole('button', { name: /Перезвонить/ });
    expect(ready).toHaveTextContent('11');
    expect(callback).toHaveTextContent(/^0/);
  });

  test('счётчик «Готово к утверждению» ведёт на «Заявки» с этим фильтром', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    await user.click(await screen.findByRole('button', { name: /Готово к утверждению/ }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('bucket')).toBe('ready');
    const chip = await screen.findByRole('button', { name: /^Готово к утверждению/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  test('матрица рисуется по данным: подписи «спрос N · мест M», уровни, заголовки возрастов', async () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const region = await screen.findByRole('region', { name: /Таблица: районы и возрастные группы/ });
    const matrix = within(region).getByRole('table');
    const today = buildToday();
    for (const age of today.ageColumns) expect(within(matrix).getByRole('columnheader', { name: age })).toBeInTheDocument();
    for (const row of today.matrix) expect(within(matrix).getByRole('rowheader', { name: row.district })).toBeInTheDocument();
    const crit = today.matrix.flatMap((r) => r.cells.map((c) => ({ r, c }))).find(({ c }) => c.level === 'crit')!;
    const cell = within(matrix).getAllByTitle(`${crit.r.district}, ${crit.c.age}: спрос ${crit.c.demand} · мест ${crit.c.supply}`)[0]!;
    expect(cell).toHaveTextContent(`спрос ${crit.c.demand} · мест ${crit.c.supply}`);
    expect(cell.textContent).toMatch(/^[−+]?\d/);
    // Минус — настоящий знак минус, а не дефис: иначе «-2» читается как тире.
    expect(cell.textContent).toContain('−');
    expect(screen.getByText('спрос есть, мест нет')).toBeInTheDocument();
  });

  test('«Нужна помощь»: кластер «Не хватает группы» и одиночные ситуации, «Уточнить» открывает заявку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    expect(await screen.findByText('Не хватает группы: Фрунзенский')).toBeInTheDocument();
    expect(screen.getByText(/3 человека \(Вера, Лариса, Игорь\), возраст 26–35 и 36–45, удобно Пт \/ Сб/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Предложить открыть группу' })).toBeDisabled();
    const single = screen.getByText('Станислав Ким').closest('li')!;
    await user.click(within(single).getByRole('button', { name: 'Уточнить' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('8');
    expect(await screen.findByRole('dialog', { name: 'Карточка заявки: Станислав Ким' })).toBeInTheDocument();
  });

  test('если помощь не нужна, вместо списка — спокойное сообщение', () => {
    const data = { ...buildToday(), clusters: [], singles: [] };
    renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 9, 0)} />);
    expect(screen.getByText('Таких заявок нет: система справилась со всеми.')).toBeInTheDocument();
  });

  test('приветствие зависит от времени суток и обходится без имени', () => {
    const data = buildToday();
    const { unmount } = renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 20, 0)} />);
    expect(screen.getByRole('heading', { name: 'Добрый вечер.' })).toBeInTheDocument();
    unmount();
    renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 7, 0)} />);
    expect(screen.getByRole('heading', { name: 'Доброе утро.' })).toBeInTheDocument();
  });

  test('когда звонить некому, так и написано, а кнопка «Начать обзвон (0)» остаётся отключённой', () => {
    const base = buildToday();
    const data = { ...base, counters: { ...base.counters, ready: 0, callback: 0 } };
    renderAt(<TodayContent data={data} now={new Date(2026, 9, 9, 9, 0)} />);
    expect(screen.getByText('Звонить сегодня некому.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Начать обзвон \(0\)/ })).toBeDisabled();
  });
});
