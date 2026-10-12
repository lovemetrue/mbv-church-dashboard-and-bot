import { useCallback, useEffect, useId, useState, type FocusEvent, type ReactNode } from 'react';
import styles from './Tip.module.css';

export interface TipAria {
  'aria-describedby'?: string;
}

interface Pos {
  top: number;
  left: number;
  above: boolean;
}

const WIDTH = 260;
const MARGIN = 8;

/**
 * Подсказка при наведении и при фокусе с клавиатуры (role=tooltip, связь через aria-describedby).
 * Esc убирает её, не закрывая ничего другого: так требует WCAG 1.4.13. Окно позиционируется по
 * экрану (fixed), а не внутри таблицы: у строк и карточек бывает overflow, который его бы обрезал.
 * Через render-prop отдаём `aria-describedby` тому элементу, который получает фокус.
 * `inline` — подсказка к значку в строке текста (по умолчанию блок на всю ширину, как у клеток матрицы).
 */
export function Tip({ text, inline = false, children }: { text: string; inline?: boolean; children: (aria: TipAria) => ReactNode }) {
  const id = useId();
  const [pos, setPos] = useState<Pos | null>(null);
  const open = pos !== null;

  const show = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const left = Math.min(Math.max(r.left + r.width / 2 - WIDTH / 2, MARGIN), Math.max(MARGIN, vw - WIDTH - MARGIN));
    // Внизу экрана подсказка открывается вверх, иначе её закроет край окна.
    const above = r.bottom + 110 > window.innerHeight && r.top > 110;
    setPos({ top: above ? r.top - 6 : r.bottom + 6, left, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Панель и окна тоже слушают Esc; пока видна подсказка, Esc принадлежит ей.
        e.preventDefault();
        setPos(null);
      }
    };
    // Прокрутка уводит клетку из-под подсказки: проще скрыть, чем двигать.
    const hide = () => setPos(null);
    // Фаза перехвата: раньше слушателей панели, чтобы их проверка defaultPrevented сработала.
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  const onFocus = (e: FocusEvent<HTMLElement>) => show(e.currentTarget);

  return (
    <span
      className={inline ? styles.tipInline : styles.tipRoot}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={onFocus}
      onBlur={() => setPos(null)}
      onClick={() => setPos(null)}
    >
      {children(open ? { 'aria-describedby': id } : {})}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={styles.tip}
          style={{ top: pos.top, left: pos.left, width: WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
