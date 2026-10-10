import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { countBuckets, matchesSearch, searchRequests } from './model';

afterEach(() => vi.unstubAllGlobals());

const SOON = 'Появится на следующем этапе';
const rowsOf = () => within(screen.getByRole('list', { name: 'Список заявок' })).getAllByRole('listitem');

describe('«Заявки»: поиск и счётчики (чистые функции)', () => {
  const { items } = buildRequests();

  test('поиск находит по ФИО и месту без учёта регистра', () => {
    expect(searchRequests(items, 'ОРЛОВ').map((r) => r.fio)).toEqual(['Алексей Орлов']);
    expect(searchRequests(items, 'беговая').length).toBeGreaterThanOrEqual(2);
  });

  test('телефон ищется по цифрам независимо от записи, но короткий запрос по цифрам не срабатывает', () => {
    const r = items.find((i) => i.fio === 'Мария Соколова')!;
    expect(matchesSearch(r, '911 124')).toBe(true);
    expect(matchesSearch(r, '+7 (911) 124-24')).toBe(true);
    expect(matchesSearch(r, '11')).toBe(false);
  });

  test('счётчики чипов считаются по найденному и без отказов', () => {
    const all = countBuckets(items);
    expect(all.all).toBe(items.length);
    expect(all.ready + all.callback + all.human + all.done).toBe(all.all);
    expect(countBuckets(searchRequests(items, 'Соколова')).all).toBe(1);
  });
});

describe('«Заявки»: экран', () => {
  test('чипы-корзины со счётчиками, «Все» выбран по умолчанию, а отказов в списке нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    const bar = await screen.findByRole('group', { name: 'Фильтр по состоянию заявки' });
    const names = within(bar).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Все18', 'Готово к утверждению11', 'Перезвонить0', 'Нужна помощь в сопоставлении6', 'Утверждено1']);
    expect(within(bar).getByRole('button', { name: /^Все/ })).toHaveAttribute('aria-pressed', 'true');
    expect(rowsOf()).toHaveLength(18);
    expect(screen.queryByText('Тимур Ахметов')).not.toBeInTheDocument();
  });

  test('чип фильтрует список и записывает корзину в адрес', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(screen.getByRole('button', { name: /^Нужна помощь в сопоставлении/ }));
    expect(rowsOf()).toHaveLength(6);
    expect(currentSearch().get('bucket')).toBe('human');
    await user.click(screen.getByRole('button', { name: /^Утверждено/ }));
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByText('→ №12 (Ольга К.)')).toBeInTheDocument();
  });

  test('корзина «Перезвонить» без заявок показывает пустое состояние, а не ломается', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(screen.getByRole('button', { name: /^Перезвонить/ }));
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument();
  });

  test('строка в списке показывает предложение системы, уверенность и квадратики данных', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const row = screen.getByRole('button', { name: 'Алексей Орлов' }).closest('li')!;
    expect(row).toHaveTextContent('№19 · Дмитрий В.');
    expect(row).toHaveTextContent('Готово к утверждению');
    expect(row).toHaveTextContent('78');
    expect(within(row).getByRole('img', { name: /Район: есть · Возраст: есть · День и время: нет · Улица: нет/ })).toBeInTheDocument();
  });

  test('клик по строке открывает карточку с предложением, причинами, контактами и журналом', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(screen.getByRole('button', { name: 'Мария Соколова' }));
    expect(currentSearch().get('req')).toBe('1');
    const card = await screen.findByRole('dialog', { name: 'Карточка заявки: Мария Соколова' });
    expect(within(card).getByText('Группа №12')).toBeInTheDocument();
    expect(within(card).getByRole('meter', { name: /уверенность: 100 из 100/ })).toBeInTheDocument();
    expect(within(card).getAllByText('тот же район').length).toBeGreaterThan(0);
    expect(within(card).getByText(/План опирается на 4 из 4 параметров/)).toBeInTheDocument();
    expect(within(card).getByText('+7 911 124 24 18')).toBeInTheDocument();
    expect(within(card).getByText('Журнал')).toBeInTheDocument();
    expect(within(card).getByText(/Заявка создана ботом/)).toBeInTheDocument();
    expect(within(card).getByText('Другие варианты')).toBeInTheDocument();
  });

  test('у заявки с планом показаны действия решения, и они доступны (не заглушки)', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    for (const name of ['Утвердить в группу ДГ-0012', 'Выбрать другую группу из списка', 'Отклонить группу ДГ-0012', 'Нужен звонок: отметить заявку']) {
      const btn = within(card).getByRole('button', { name });
      expect(btn).toBeEnabled();
      expect(btn).not.toHaveAttribute('title', SOON);
    }
  });

  test('у заявки с вытесненным вариантом объясняется, кому отдано место', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=17');
    const card = await screen.findByRole('dialog', { name: /Эльвира Волкова/ });
    expect(within(card).getByText(/Лучший вариант — №27 \(Чт, вечер\), но место в ней отдано другой заявке: Руслан Агеев/)).toBeInTheDocument();
  });

  test('заявка без плана показывает красный блок с причиной и подсказкой, без кнопки «Утвердить»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=8');
    const card = await screen.findByRole('dialog', { name: /Станислав Ким/ });
    expect(within(card).getByText('План не составлен.')).toBeInTheDocument();
    expect(within(card).getByText(/Место не распознано/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Утвердить' })).not.toBeInTheDocument();
    // параметры подбора раскрыты, район отмечен как неизвестный
    expect(within(card).getByText(/Параметры подбора \(1 из 4\)/)).toBeInTheDocument();
    expect(within(card).getAllByText(/не определён/).length).toBeGreaterThan(0);
  });

  test('слабый план показан с предупреждением, а не как готовое решение', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=19');
    const card = await screen.findByRole('dialog', { name: /Виталий Егоров/ });
    expect(within(card).getByText(/Лучший найденный вариант слабый \(уверенность 47\)/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Всё равно утвердить/ })).toBeEnabled();
    expect(within(card).getByText('Пока вы не утвердили, человек не считается распределённым.')).toBeInTheDocument();
  });

  test('утверждённая заявка показывает, куда определён человек', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=10');
    const card = await screen.findByRole('dialog', { name: /Артём Лебедев/ });
    expect(within(card).getByText(/Утверждено: группа №12, Ольга К\./)).toBeInTheDocument();
  });

  test('свёрнутый блок параметров подбора показывает «N из 4» и отметки известно/не указано', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=2');
    const card = await screen.findByRole('dialog', { name: /Алексей Орлов/ });
    const summary = within(card).getByText(/Параметры подбора \(2 из 4\)/);
    expect(summary.closest('details')).toHaveAttribute('open');
    const items = within(card).getAllByText(/\((известно|не указано)\)/).map((e) => e.textContent?.trim());
    expect(items).toEqual(['(известно)', '(известно)', '(не указано)', '(не указано)']);
  });

  test('Escape и кнопка «✕» закрывают карточку и убирают заявку из адреса', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&req=1');
    await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Карточка заявки/ })).not.toBeInTheDocument();
    expect(currentSearch().has('req')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Мария Соколова' }));
    await user.click(await screen.findByRole('button', { name: 'Закрыть карточку' }));
    expect(screen.queryByRole('dialog', { name: /Карточка заявки/ })).not.toBeInTheDocument();
  });

  test('ссылка на заявку, которой нет в очереди, не ломает страницу', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=999');
    expect(await screen.findByText(/Заявка не найдена/)).toBeInTheDocument();
  });
});
