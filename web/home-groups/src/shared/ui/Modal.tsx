import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ru } from '../i18n/ru';
import { Button } from './Button';
import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Модальное окно для решений, которые нельзя принять случайным кликом (выбор группы,
 * причина отказа, подтверждение «нет мест»). На телефоне — шторка снизу.
 *
 * Esc ловится на этапе погружения на document, а не обработчиком окна: карточка заявки
 * (Drawer) тоже слушает Esc на document и зарегистрировалась раньше, поэтому в обычной
 * фазе она закрылась бы первой, а вместе с ней и всё, что человек успел ввести. Здесь мы
 * перехватываем клавишу раньше и ставим preventDefault, по которому Drawer её пропускает.
 * Фокус заперт внутри окна и возвращается туда, откуда пришёл.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // С самой панели (tabindex=-1) Tab идёт на первый элемент, Shift+Tab — на последний.
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Если кнопка, открывшая окно, уже убрана из дерева, фокус просто теряется.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label={ru.common.close}>
            ✕
          </Button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
