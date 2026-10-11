import type { RequestItem } from '@contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { RESP_NOBODY } from '../../shared/nav';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { countBuckets, filterByBucket, filterByResponsible, responsibleNames } from './model';

afterEach(() => vi.unstubAllGlobals());

const rowsOf = () => within(screen.getByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');
// Открытая карточка тоже содержит поле «В работе у», поэтому ищем в панели отбора списка.
const selectEl = () =>
  within(screen.getByRole('group', { name: 'Отбор списка заявок' })).getByRole('combobox', { name: 'В работе у' });
const items = buildRequests().items;

describe('«Заявки»: отбор «В работе у» (чистые функции)', () => {
  test('имена в списке уникальны, без пустых и по алфавиту', () => {
    const list = [
      { responsible: 'Пётр Г.' },
      { responsible: 'Анна Л.' },
      { responsible: null },
      { responsible: 'Пётр Г.' },
      { responsible: '' },
      { responsible: 'Борис' },
    ] as RequestItem[];
    expect(responsibleNames(list)).toEqual(['Анна Л.', 'Борис', 'Пётр Г.']);
  });

  test('отбор по имени, «никто не взял» и «все»', () => {
    expect(filterByResponsible(items, '')).toHaveLength(items.length);
    const anna = filterByResponsible(items, 'Анна Л.');
    expect(anna.length).toBeGreaterThan(0);
    expect(anna.every((r) => r.responsible === 'Анна Л.')).toBe(true);
    const nobody = filterByResponsible(items, RESP_NOBODY);
    expect(nobody.length).toBeGreaterThan(0);
    expect(nobody.every((r) => !r.responsible)).toBe(true);
    expect(anna.length + nobody.length + filterByResponsible(items, 'Пётр Г.').length).toBe(items.length);
  });
});

describe('«Заявки»: отбор «В работе у» (экран)', () => {
  test('список выбора: «Все», «Никто не взял», затем имена по алфавиту', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const names = within(selectEl()).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Все', 'Никто не взял', ...responsibleNames(items)]);
    expect(selectEl()).toHaveValue('');
  });

  test('выбор имени записывается в адрес и оставляет в списке только его заявки', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&req=1');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.selectOptions(selectEl(), 'Пётр Г.');
    expect(currentSearch().get('resp')).toBe('Пётр Г.');
    // открытая карточка принадлежала прежнему списку и закрывается
    expect(currentSearch().has('req')).toBe(false);
    expect(rowsOf()).toHaveLength(filterByResponsible(items, 'Пётр Г.').length);
    await user.selectOptions(selectEl(), 'Все');
    expect(currentSearch().has('resp')).toBe(false);
    expect(rowsOf()).toHaveLength(items.length);
  });

  test('«Никто не взял» оставляет заявки без ответственного', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.selectOptions(selectEl(), 'Никто не взял');
    expect(currentSearch().get('resp')).toBe(RESP_NOBODY);
    expect(rowsOf()).toHaveLength(filterByResponsible(items, RESP_NOBODY).length);
    expect(screen.getByRole('button', { name: 'Артём Лебедев' })).toBeInTheDocument();
  });

  test('адрес с отбором сразу показывает его в списке выбора и в списке заявок', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&resp=' + encodeURIComponent('Анна Л.'));
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(selectEl()).toHaveValue('Анна Л.');
    expect(rowsOf()).toHaveLength(filterByResponsible(items, 'Анна Л.').length);
  });

  test('имя из старой ссылки, которого сейчас нет в очереди, остаётся в списке выбора, а список заявок пуст', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&resp=' + encodeURIComponent('Ушедший Коллега'));
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument();
    expect(selectEl()).toHaveValue('Ушедший Коллега');
  });

  test('счётчики чипов считаются по выбранному ответственному', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&resp=' + encodeURIComponent('Анна Л.'));
    await screen.findByRole('list', { name: 'Список заявок' });
    const c = countBuckets(filterByResponsible(items, 'Анна Л.'));
    const bar = screen.getByRole('group', { name: 'Фильтр по состоянию заявки' });
    expect(within(bar).getByRole('button', { name: /^Все/ })).toHaveTextContent(`Все${c.all}`);
    expect(within(bar).getByRole('button', { name: /^К обзвону/ })).toHaveTextContent(`К обзвону${c.queue}`);
    expect(within(bar).getByRole('button', { name: /^Нужна помощь/ })).toHaveTextContent(`${c.human}`);
  });

  test('отбор действует вместе с поиском и чипом', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&resp=' + encodeURIComponent('Пётр Г.'));
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(screen.getByRole('button', { name: /^Нужна помощь/ }));
    expect(currentSearch().get('resp')).toBe('Пётр Г.');
    const expected = filterByBucket(filterByResponsible(items, 'Пётр Г.'), 'human');
    expect(rowsOf()).toHaveLength(expected.length);
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по заявкам' }), expected[0]!.fio.split(' ')[1]!);
    expect(rowsOf()).toHaveLength(1);
  });

  test('«Следующая» в очереди обходит только заявки выбранного ответственного', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=queue&resp=' + encodeURIComponent('Анна Л.'));
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    const queue = filterByBucket(filterByResponsible(items, 'Анна Л.'), 'queue');
    const nav = within(card).getByRole('navigation', { name: 'Переход между заявками' });
    expect(within(nav).getByText(`1 из ${queue.length}`)).toBeInTheDocument();
    await user.click(within(nav).getByRole('button', { name: 'Следующая →' }));
    expect(await screen.findByRole('dialog', { name: `Карточка заявки: ${queue[1]!.fio}` })).toBeInTheDocument();
  });

  test('в строке списка видно, у кого заявка; без ответственного метки нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const orlov = screen.getByRole('button', { name: 'Алексей Орлов' }).closest('li')!;
    expect(orlov).toHaveTextContent('В работе: Пётр Г.');
    const lebedev = screen.getByRole('button', { name: 'Артём Лебедев' }).closest('li')!;
    expect(lebedev).not.toHaveTextContent('В работе');
  });

  test('поиск в шапке находит заявку по ответственному и по комментарию', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const box = screen.getByRole('searchbox', { name: 'Поиск по заявкам' });
    await user.type(box, 'звонить после');
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Наталья Белова' })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'пётр г');
    expect(rowsOf()).toHaveLength(filterByResponsible(items, 'Пётр Г.').length);
  });
});
