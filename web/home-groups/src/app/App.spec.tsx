import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openCount } from '../entities/buckets';
import { buildRequests, buildToday } from '../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../test/render';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('оболочка', () => {
  test('вкладки обычного входа — это tablist с выбранной «Сегодня», у «Заявок» стоит счётчик открытых, вкладки «Настройки» нет, а «Команда» есть', async () => {
    // Фикстуры отдают полный вход, а здесь проверяется обычный: «Настройки» ему не показываются.
    stubFetchWithFixtures({ me: () => new Response(JSON.stringify({ role: 'admin' }), { status: 200 }) });
    renderAt(<App />);
    const tabs = screen.getByRole('tablist', { name: 'Разделы' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names[0]).toBe('Сегодня');
    // «Группы» стоят сразу после «Заявок»: у распределителей заявки, у координаторов группы.
    expect(names.map((n) => n?.replace(/\d+$/, '').trim())).toEqual(['Сегодня', 'Заявки', 'Группы', 'Команда', 'Справочник']);
    expect(within(tabs).getByRole('tab', { name: 'Сегодня' })).toHaveAttribute('aria-selected', 'true');
    // Число открытых берём из тех же фикстур: оно растёт вместе с демо-заявками.
    const open = openCount(buildRequests().counters);
    expect(await within(tabs).findByRole('tab', { name: new RegExp(`Заявки\\s*${open}$`) })).toBeInTheDocument();
  });

  test('в шапке плашка «Распределено X из Y» берёт числа из данных «Сегодня»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const pill = await screen.findByText(/Распределено/);
    const { assigned, total } = buildToday();
    expect(pill.textContent).toMatch(new RegExp(`${assigned}\\s*из\\s*${total}`));
  });

  test('стрелка вправо переключает вкладку и переносит на неё фокус, адрес запоминает вкладку', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    const today = screen.getByRole('tab', { name: 'Сегодня' });
    today.focus();
    await user.keyboard('{ArrowRight}');
    const requests = screen.getByRole('tab', { name: /Заявки/ });
    expect(requests).toHaveAttribute('aria-selected', 'true');
    expect(requests).toHaveFocus();
    expect(currentSearch().get('tab')).toBe('requests');
  });

  test('кнопка «Создать» в шапке доступна и открывает меню, а не стоит заглушкой «следующего этапа»', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    const create = screen.getByRole('button', { name: '+ Создать' });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAttribute('aria-description');
    await user.click(create);
    expect(screen.getByRole('menu', { name: 'Что создать' })).toBeInTheDocument();
  });

  test('выход — форма POST на /logout', () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const form = screen.getByRole('button', { name: 'Выйти' }).closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/logout');
  });

  test('выбор темы применяется к странице и запоминается', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    await user.selectOptions(screen.getByLabelText('Тема'), 'gray');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gray');
    expect(window.localStorage.getItem('hg.theme')).toBe('gray');
    await user.selectOptions(screen.getByLabelText('Тема'), 'auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  test('если загрузка не удалась, показывается ошибка с кнопкой «Повторить», и повтор работает', async () => {
    let fail = true;
    const { fixtureResponse } = await import('../fixtures');
    stubFetchWithFixtures({
      today: () =>
        fail
          ? new Response('{}', { status: 500 })
          : new Response(JSON.stringify(fixtureResponse('today')), { status: 200 }),
    });
    const user = userEvent.setup();
    renderAt(<App />);
    expect(await screen.findByText('Не удалось загрузить.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Спрос и предложение по районам')).toBeInTheDocument();
  });

  test('поиск из другой вкладки переносит на «Заявки» и сужает список по ФИО, месту и цифрам телефона', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />);
    await screen.findByText('Спрос и предложение по районам');
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по заявкам' }), 'соколов');
    expect(currentSearch().get('tab')).toBe('requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('button', { name: 'Мария Соколова' })).toBeInTheDocument();

    const box = screen.getByRole('searchbox', { name: 'Поиск по заявкам' });
    await user.clear(box);
    await user.type(box, '9111242');
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Список заявок' })).getAllByRole('listitem')).toHaveLength(1));
  });
});
