import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Popover.module.css';

interface PopoverProps {
  /** Текст кнопки-открывашки. */
  label: string;
  /** Что приписать после названия («· 2»). */
  badge?: ReactNode;
  /** Доступное имя всплывающего окна. */
  title: string;
  children: ReactNode;
}

/**
 * Всплывающее окно («Фильтры», «Вид таблицы»). На широком экране — под кнопкой, на телефоне —
 * шторка снизу: окно у края экрана иначе вылезало бы за него.
 * Закрывается Esc, кликом вне окна и повторным нажатием на кнопку; фокус возвращается на кнопку.
 */
export function Popover({ label, badge, title, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <Button
        ref={triggerRef}
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {badge ? ` · ${String(badge)}` : ''} ▾
      </Button>
      {open && (
        <>
          <div className={styles.scrim} aria-hidden="true" />
          <div ref={panelRef} id={id} className={styles.panel} role="dialog" aria-label={title} tabIndex={-1}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}
