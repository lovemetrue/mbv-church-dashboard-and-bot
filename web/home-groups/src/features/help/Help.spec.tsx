import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { Markdown } from './Markdown';

afterEach(() => vi.unstubAllGlobals());

describe('справка «?» в шапке', () => {
  test('знак «?» рядом с «Выйти» открывает справку: первой — частые проблемы, другие статьи переключаются', async () => {
    const fetchMock = stubFetchWithFixtures();
    renderAt(<App />);
    const user = userEvent.setup();
    // Статьи не грузятся, пока справку не открыли.
    expect((fetchMock.mock.calls as unknown as [string][]).some(([u]) => String(u).includes('/help'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Справка' }));
    const dialog = await screen.findByRole('dialog', { name: 'Справка' });
    const article = await within(dialog).findByRole('article', { name: 'Частые проблемы' });
    expect(within(article).getByRole('heading', { name: /Не вижу заявку/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Как работает интерфейс' }));
    const guide = await within(dialog).findByRole('article', { name: 'Как работает интерфейс' });
    expect(within(guide).getByRole('table')).toBeInTheDocument();
  });

  test('подсказка спросить помощника — только когда чат помощника доступен', async () => {
    stubFetchWithFixtures({ me: () => new Response(JSON.stringify({ role: 'readonly' }), { status: 200 }) });
    renderAt(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Справка' }));
    const dialog = await screen.findByRole('dialog', { name: 'Справка' });
    await within(dialog).findByRole('article', { name: 'Частые проблемы' });
    expect(within(dialog).queryByText(/Спросите «✦ Помощник»/)).not.toBeInTheDocument();
  });
});

describe('Markdown статей', () => {
  const show = (md: string) => render(<Markdown source={md} imageUrl={(p) => `/img/${p.split('/').pop()}`} />);

  test('заголовки, списки, жирный, код, цитата и таблица', () => {
    show('# Заголовок\n\nТекст **жирно** и `код`.\n\n- раз\n- два\n\n1. первый\n2. второй\n\n> цитата\n\n| А | Б |\n|---|---|\n| 1 | 2 |');
    expect(screen.getByRole('heading', { name: 'Заголовок' })).toBeInTheDocument();
    expect(screen.getByText('жирно').tagName).toBe('STRONG');
    expect(screen.getByText('код').tagName).toBe('CODE');
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('цитата').closest('blockquote')).not.toBeNull();
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '2']);
  });

  test('картинка берётся с сервера по имени файла; ссылка не на сайт или почту остаётся текстом', () => {
    show('![Вход](инструкция-координатора/guide-01-login.png)\n\n[сайт](https://example.org) и [плохая](javascript:alert(1))');
    expect(screen.getByRole('img', { name: 'Вход' })).toHaveAttribute('src', '/img/guide-01-login.png');
    expect(screen.getByRole('link', { name: 'сайт' })).toHaveAttribute('href', 'https://example.org');
    expect(screen.queryByRole('link', { name: 'плохая' })).not.toBeInTheDocument();
    expect(screen.getByText(/плохая/)).toBeInTheDocument();
  });
});
