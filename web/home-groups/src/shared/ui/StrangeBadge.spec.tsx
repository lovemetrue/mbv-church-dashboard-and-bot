import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { StrangeMark } from '@contracts';
import { StrangeBadge, StrangeBanner } from './index';

const mark = (patch: Partial<StrangeMark> = {}): StrangeMark => ({ by: 'Анна', at: '2026-10-09T12:00:00.000Z', note: null, ...patch });
const TEXT = 'Странный человек. Отметка: Анна, 09.10.2026.';

describe('StrangeBadge: красный значок «!»', () => {
  test('без метки значка нет', () => {
    const { container } = render(<StrangeBadge mark={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('с меткой значок называет её словами: смысл не держится на цвете', () => {
    render(<StrangeBadge mark={mark()} />);
    expect(screen.getByRole('img', { name: TEXT })).toBeInTheDocument();
  });

  test('подсказка появляется при наведении и при фокусе с клавиатуры и уходит по Esc', async () => {
    const user = userEvent.setup();
    render(<StrangeBadge mark={mark({ note: 'Говорит о слежке.' })} />);
    const badge = screen.getByRole('img', { name: `${TEXT} Говорит о слежке.` });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(badge);
    expect(screen.getByRole('tooltip')).toHaveTextContent(`${TEXT} Говорит о слежке.`);
    await user.unhover(badge);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    expect(badge).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('внутри кнопки значок не получает фокуса и подсказывает нативным title', () => {
    render(<StrangeBadge mark={mark()} interactive={false} />);
    const badge = screen.getByRole('img', { name: TEXT });
    expect(badge).toHaveAttribute('title', TEXT);
    expect(badge).not.toHaveAttribute('tabindex');
  });

  test('красит значок переменной опасности темы, а не вшитым цветом', () => {
    render(<StrangeBadge mark={mark()} />);
    const svg = screen.getByRole('img', { name: TEXT }).querySelector('svg')!;
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
});

describe('StrangeBanner: полоса в карточке', () => {
  test('без метки полосы нет', () => {
    const { container } = render(<StrangeBanner mark={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('называет метку, кто и когда поставил, и показывает заметку', () => {
    render(<StrangeBanner mark={mark({ note: 'Говорит о слежке.' })} />);
    const banner = screen.getByRole('note', { name: 'Странный человек' });
    expect(banner).toHaveTextContent('Странный человек');
    expect(banner).toHaveTextContent('Отметка: Анна, 09.10.2026.');
    expect(banner).toHaveTextContent('Говорит о слежке.');
  });

  test('без заметки абзаца с заметкой нет', () => {
    render(<StrangeBanner mark={mark()} />);
    expect(screen.getByRole('note', { name: 'Странный человек' }).querySelectorAll('p')).toHaveLength(2);
  });
});
