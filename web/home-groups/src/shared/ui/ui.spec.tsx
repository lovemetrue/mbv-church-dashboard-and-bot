import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { Button, ConfidenceDots, Drawer, Meter, Popover, Reasons } from './index';

describe('Button', () => {
  test('«следующий этап»: отключена, объясняет почему и не реагирует на нажатие', async () => {
    const onClick = vi.fn();
    render(
      <Button soon onClick={onClick}>
        Утвердить
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Утвердить' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Появится на следующем этапе');
    expect(b).toHaveAttribute('aria-description', 'Появится на следующем этапе');
    await userEvent.setup({ pointerEventsCheck: 0 }).click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('обычная кнопка по умолчанию не отправляет формы (type=button)', () => {
    render(<Button>Ок</Button>);
    expect(screen.getByRole('button', { name: 'Ок' })).toHaveAttribute('type', 'button');
  });
});

describe('Meter, ConfidenceDots, Reasons', () => {
  test('шкала ограничивает значение 0–100 и читается как meter', () => {
    render(<Meter value={140} label="Уверенность" />);
    expect(screen.getByRole('meter', { name: 'Уверенность' })).toHaveAttribute('aria-valuenow', '100');
  });

  test('квадратики данных называют каждый параметр словами', () => {
    render(<ConfidenceDots fill={[true, true, false, false]} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Район: есть · Возраст: есть · День и время: нет · Улица: нет',
    );
  });

  test('плашки причин не рисуются, когда причин нет', () => {
    const { container } = render(<Reasons items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Drawer', () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Открыть</button>
        {open && (
          <Drawer label="Карточка" title="Заголовок" onClose={() => setOpen(false)}>
            <p>Содержимое</p>
          </Drawer>
        )}
      </>
    );
  }

  test('при открытии фокус уходит в панель, по Escape она закрывается, а фокус возвращается на кнопку', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Открыть' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Карточка' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Popover', () => {
  test('открывается кнопкой, закрывается Escape и кликом снаружи, у кнопки верный aria-expanded', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Popover label="Фильтры" title="Фильтры">
          <p>Внутри</p>
        </Popover>
        <p>Снаружи</p>
      </>,
    );
    const trigger = screen.getByRole('button', { name: /Фильтры/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Фильтры' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByText('Снаружи'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
