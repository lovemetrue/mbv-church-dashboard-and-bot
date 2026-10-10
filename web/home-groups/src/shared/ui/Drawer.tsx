import { useEffect, useRef, type ReactNode } from 'react';
import { ru } from '../i18n/ru';
import { Button } from './Button';
import styles from './Drawer.module.css';

interface DrawerProps {
  /** Доступное имя панели («Карточка заявки»). */
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /**
   * docked — панель стоит в сетке рядом со списком (заявки) и только на узком экране
   * разворачивается на весь экран. Без docked — выезжает поверх страницы справа и не
   * сжимает таблицу под собой (справочник).
   */
  docked?: boolean;
  children: ReactNode;
}

/**
 * Выезжающая карточка. Не модальная на широком экране: список остаётся доступен, и по клику
 * на другую строку карточка меняется. Esc закрывает; фокус уходит в панель при открытии и
 * возвращается туда, откуда пришёл.
 */
export function Drawer({ label, title, subtitle, onClose, docked = false, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      // Если строка, из которой открыли карточку, уже убрана из дерева, фокус просто теряется.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside
      ref={ref}
      className={`${styles.drawer} ${docked ? styles.docked : styles.overlay}`}
      role="dialog"
      aria-label={label}
      aria-modal="false"
      tabIndex={-1}
    >
      <header className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <Button variant="ghost" onClick={onClose} aria-label={ru.reference.closeCard}>
          ✕
        </Button>
      </header>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}

/** Раздел внутри карточки: тонкая линия сверху и необязательный заголовок. */
export function DrawerSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      {title && <h3 className={styles.sectionTitle}>{title}</h3>}
      {children}
    </section>
  );
}
