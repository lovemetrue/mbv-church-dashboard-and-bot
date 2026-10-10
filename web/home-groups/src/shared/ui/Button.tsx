import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ru } from '../i18n/ru';
import styles from './Button.module.css';

type Variant = 'default' | 'primary' | 'ghost' | 'ok';
type Size = 'sm' | 'md' | 'big';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  /**
   * Кнопка есть в макете, но действие появится на следующем этапе: показываем её отключённой
   * с подсказкой, чтобы служитель видел будущий функционал и не гадал, почему не нажимается.
   */
  soon?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', soon = false, disabled, children, type, ...rest },
  ref,
) {
  const cls = [styles.btn, styles[variant], styles[size]].join(' ');
  if (soon) {
    return (
      // Подсказка висит на обёртке: у отключённой кнопки браузеры не всегда показывают title.
      <span className={styles.soonWrap} title={ru.nextStage}>
        <button
          {...rest}
          ref={ref}
          type={type ?? 'button'}
          className={cls}
          disabled
          title={ru.nextStage}
          aria-description={ru.nextStage}
        >
          {children}
        </button>
      </span>
    );
  }
  return (
    <button {...rest} ref={ref} type={type ?? 'button'} className={cls} disabled={disabled}>
      {children}
    </button>
  );
});
