import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  pressed: boolean;
  count?: number | string;
  /** pill — овальная «таблетка» для фильтров; block — прямоугольная кнопка переключателя (выбор сущности). */
  shape?: 'pill' | 'block';
  children: ReactNode;
}

/** Переключаемая «таблетка»: фильтр-корзина, выбор сущности. Состояние — через aria-pressed. */
export function Chip({ pressed, count, shape = 'pill', children, type, ...rest }: ChipProps) {
  return (
    <button {...rest} type={type ?? 'button'} className={`${styles.chip} ${shape === 'block' ? styles.block : ''}`} aria-pressed={pressed}>
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
