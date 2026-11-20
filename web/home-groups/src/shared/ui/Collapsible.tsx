import { useId, useState, type ReactNode } from 'react';
import styles from './Collapsible.module.css';

function readOpen(key: string | undefined): boolean {
  if (!key) return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    // Хранилище закрыто (приватное окно, запрет сайта): блок свёрнут, как по умолчанию.
    return false;
  }
}

/**
 * Сворачиваемый блок с заголовком-кнопкой. По умолчанию свёрнут; содержимое рисуется только раскрытым — поэтому, например,
 * карта в «Заявках» берёт данные при раскрытии, а не при каждом заходе. `storageKey` — браузер помнит, раскрыт ли блок
 * (localStorage, как остальные личные настройки); без него блок свёрнут при каждом показе.
 */
export function Collapsible({ title, storageKey, className, children }: { title: string; storageKey?: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const bodyId = useId();
  function toggle() {
    const next = !open;
    setOpen(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      /* не запомнилось — не страшно */
    }
  }
  return (
    <section className={className}>
      <h3 className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
          {title}
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
