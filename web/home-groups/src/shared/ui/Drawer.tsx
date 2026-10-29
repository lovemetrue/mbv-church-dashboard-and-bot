import { useEffect, useRef, type ReactNode } from 'react';
import { ru } from '../i18n/ru';
import { Button } from './Button';
import styles from './Drawer.module.css';
import { useFitVisualViewport } from './useFitVisualViewport';

interface DrawerProps {
  /** Доступное имя панели («Карточка заявки»). */
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Значки действий справа от названия (правка, звонок, переход): под рукой, а не в глубине карточки. */
  tools?: ReactNode;
  /** Значки строкой под названием и подзаголовком, а не справа от названия: у группы название длинное (код и ведущий). */
  toolsBelow?: boolean;
  onClose: () => void;
  /**
   * docked — панель стоит в сетке рядом со списком (заявки) и только на узком экране
   * разворачивается на весь экран. Без docked — выезжает поверх страницы справа и не
   * сжимает таблицу под собой (справочник).
   */
  docked?: boolean;
  /**
   * beside — вторая карточка рядом с открытой: на широком экране встаёт левее неё (человек слева от группы, чтобы их
   * сверять), на узком — поверх всего. Esc закрывает сначала её, а карточку под ней оставляет.
   */
  beside?: boolean;
  children: ReactNode;
}

/**
 * Выезжающая карточка. Не модальная на широком экране: список остаётся доступен, и по клику
 * на другую строку карточка меняется. Esc закрывает; фокус уходит в панель при открытии и
 * возвращается туда, откуда пришёл.
 */
export function Drawer({ label, title, subtitle, tools, toolsBelow = false, onClose, docked = false, beside = false, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Ширина выезжающей карточки — как в стилях (.overlay); прикреплённая на узком экране идёт на весь экран.
  // Вторая карточка на узком экране закрывает собой и первую — во всю ширину.
  useFitVisualViewport(ref, docked || beside ? undefined : 440);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Фокус уходит в карточку, только если человек уже что-то фокусировал (строку, кнопку).
    // При загрузке страницы по ссылке фокус в body: красть его у скринридера не нужно.
    if (previous && previous !== document.body) ref.current?.focus({ preventScroll: true });
    return () => {
      // Если строка, из которой открыли карточку, уже убрана из дерева, фокус просто теряется.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Вторая карточка слушает на погружении — раньше первой — и гасит Esc, иначе он закрыл бы обе разом.
      if (beside) e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, beside);
    return () => document.removeEventListener('keydown', onKey, beside);
  }, [beside]);

  return (
    <aside
      ref={ref}
      className={`${styles.drawer} ${docked ? styles.docked : styles.overlay} ${beside ? styles.beside : ''}`}
      role="dialog"
      aria-label={label}
      aria-modal="false"
      tabIndex={-1}
    >
      <header className={styles.head}>
        <div className={styles.titles}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{title}</h2>
            {tools && !toolsBelow && <div className={styles.tools}>{tools}</div>}
          </div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          {tools && toolsBelow && <div className={`${styles.tools} ${styles.toolsBelow}`}>{tools}</div>}
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
