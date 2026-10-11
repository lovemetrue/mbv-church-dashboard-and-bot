import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';

/** Сколько подтверждение висит само, если его не закрыли. */
const HIDE_AFTER_MS = 20_000;

/**
 * Подтверждение «Заявка №N создана» с кнопкой «Открыть». Окно с формой к этому моменту уже закрыто,
 * поэтому результат нельзя оставлять только в данных на экране: человек не увидел бы, что получилось.
 * Живёт в шапке, а не на вкладке, чтобы не пропасть при смене вкладки.
 */
export function CreateNotice({ text, onOpen, onDismiss }: { text: string; onOpen: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [text, onDismiss]);

  return createPortal(
    <div className={styles.notice} role="status" aria-label={text}>
      <span className={styles.noticeText}>{text}</span>
      <Button size="sm" variant="primary" onClick={onOpen}>
        {ru.create.open}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss} aria-label={ru.create.dismiss}>
        ✕
      </Button>
    </div>,
    document.body,
  );
}
