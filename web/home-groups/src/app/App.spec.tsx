import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../test/render';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

const SOON = 'Появится на следующем этапе';

describe('оболочка', () => {
  test('вкладки обычного входа — это tablist с выбранной «Сегодня», у «Заявок» стоит счётчик открытых, вкладок «Контроль» и «Настройки» нет', async () => {
    // Фикстуры отдают полный вход, а здесь проверяется обычный: «Настройки» ему не показываются.
    stubFetchWithFixtures({ me: () => new Response(JSON.stringify({ role: 'admin' }), { status: 200 }) });
    renderAt(<App />);
    const tabs = screen.getByRole('tablist', { name: 'Разделы' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names[0]).toBe('Сегодня');
    expect(names[2]).toBe('Справочник');
    expect(names).toHaveLength(3);
    expect(within(tabs).getByRole('tab', { name: 'Сегодня' })).toHaveAttribute('aria-selected', 'true');
    // 11 готово + 0 перезвонить + 6 нужна помощь
    expect(await within(tabs).findByRole('tab', { name: /Заявки\s*17/ })).toBeInTheDocument();
  });

  test('в шапке плашка «Распределено X из Y» берёт числа из данных «Сегодня»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const pill = await screen.findByText(/Распределено/);
    expect(pill.textContent).toMatch(/12\s*из\s*18/);
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

  test('кнопки следующего этапа показаны, но отключены и объясняют почему', async () => {
    stubFetchWithFixtures();
    renderAt(<App />);
    const create = screen.getByRole('button', { name: '+ Создать' });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', SOON);
    expect(create).toHaveAttribute('aria-description', SOON);
    const start = await screen.findByRole('button', { name: /Начать обзвон \(11\)/ });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('aria-description', SOON);
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
