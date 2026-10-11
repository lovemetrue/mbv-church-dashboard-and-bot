import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { ChatPanel } from './ChatPanel';
import { useChat } from './useChat';
import styles from './Chat.module.css';

/**
 * Плавающая кнопка «✦ Помощник» и окно разговора. Стоит в оболочке, то есть на всех вкладках, но не на странице
 * регистрации (там оболочки нет). Показывается, только когда сервер говорит, что чат доступен: ключ задан,
 * помощник включён и база готова. Пока `me` не прочитан или без сведений о помощнике — кнопки нет.
 *
 * Разговор и черновик держим здесь, а не в окне: закрыли и снова открыли — всё на месте. Дальше памяти страницы
 * они не уходят.
 */
export function AssistantChat() {
  const me = useMe();
  const chat = useChat();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Закрыли окно — фокус обратно на кнопку, которая его открывала (иначе клавиатурный пользователь теряет место).
  useEffect(() => {
    if (wasOpen.current && !open) fabRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  if (me.data?.assistant?.chat !== true) return null;

  if (open) {
    return <ChatPanel chat={chat} draft={draft} onDraft={setDraft} onClose={() => setOpen(false)} isSuper={me.data.role === 'super'} />;
  }
  return (
    <button ref={fabRef} type="button" className={styles.fab} onClick={() => setOpen(true)}>
      <span aria-hidden="true">✦ </span>
      {ru.chat.fab}
    </button>
  );
}
