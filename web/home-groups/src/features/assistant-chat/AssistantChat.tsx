import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMe } from '../../shared/api/queries';
import { canChange } from '../../shared/access';
import { ru } from '../../shared/i18n/ru';
import { ReviewPanel } from '../requests/assistant/ReviewPanel';
import { useAssistantRun } from '../requests/assistant/useAssistantRun';
import { ChatPanel } from './ChatPanel';
import { useChat } from './useChat';
import styles from './Chat.module.css';

/** Вкладка окна помощника: разбор непонятных заявок или вопрос по базе. */
export type DockTab = 'review' | 'chat';

interface Dock {
  open: (tab: DockTab) => void;
  /** Разбор заявок: его состояние живёт здесь, а не в окне — закрыли окно на минуту разбора, итог не потерялся. */
  review: ReturnType<typeof useAssistantRun>;
}

const DockContext = createContext<Dock | null>(null);

/** Открыть окно помощника из любого места страницы (значок ✦ в блоке подбора). */
export function useAssistantDock(): Dock | null {
  return useContext(DockContext);
}

/**
 * Окно помощника и плавающая кнопка «✦ Помощник». Стоит в оболочке, то есть на всех вкладках, но не на странице
 * регистрации (там оболочки нет). В окне две вкладки: «Разбор заявок» (открывается значком ✦ в блоке подбора) и
 * «Вопрос по базе» — чат. Плавающая кнопка и вкладка чата есть, только когда сервер говорит, что чат доступен:
 * ключ задан, помощник включён и база готова. Разбор открывается всегда: если помощник выключен или не подключён,
 * окно само скажет об этом словами, а не молча не откроется.
 *
 * Разговор, черновик и разбор держим здесь, а не в окне: закрыли и снова открыли — всё на месте. Прошлый разговор
 * хранит сервер (по логину) и отдаёт при первом открытии окна; в браузер (память вкладки, адрес) он не пишется.
 */
export function AssistantChat({ children }: { children?: ReactNode }) {
  const me = useMe();
  const chat = useChat();
  const review = useAssistantRun();
  const [tab, setTab] = useState<DockTab | null>(null);
  const [draft, setDraft] = useState('');
  const fabRef = useRef<HTMLButtonElement>(null);
  // Куда вернуть фокус после закрытия: на ту кнопку, что открыла окно (✦ в блоке подбора или плавающую).
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const open = useCallback((next: DockTab) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) opener.current = active;
    setTab(next);
  }, []);
  const dock = useMemo(() => ({ open, review }), [open, review]);

  // Закрыли окно — фокус обратно на кнопку, которая его открывала (иначе клавиатурный пользователь теряет место).
  useEffect(() => {
    if (wasOpen.current && tab === null) {
      const back = opener.current?.isConnected ? opener.current : fabRef.current;
      back?.focus({ preventScroll: true });
    }
    wasOpen.current = tab !== null;
  }, [tab]);

  const chatOn = me.data?.assistant?.chat === true;
  const isSuper = me.data?.role === 'super';
  const close = () => setTab(null);
  // Чат недоступен — вкладки «Вопрос по базе» нет, и окно открывается только на разборе.
  const shown: DockTab | null = tab === 'chat' && !chatOn ? 'review' : tab;
  const tabs = chatOn ? { current: shown ?? 'review', onSelect: (t: DockTab) => setTab(t) } : null;

  // «Только чтение» помощника не запускает и не спрашивает: разбор пишет в базу, а вопросы — расход на модель.
  if (!canChange(me.data)) return <DockContext.Provider value={null}>{children}</DockContext.Provider>;

  return (
    <DockContext.Provider value={dock}>
      {children}
      {shown === 'chat' && <ChatPanel chat={chat} draft={draft} onDraft={setDraft} onClose={close} isSuper={isSuper} tabs={tabs} />}
      {shown === 'review' && <ReviewPanel run={review} onClose={close} isSuper={isSuper} tabs={tabs} />}
      {shown === null && chatOn && (
        <button ref={fabRef} type="button" className={styles.fab} onClick={() => open('chat')}>
          <span aria-hidden="true">✦ </span>
          {ru.chat.fab}
        </button>
      )}
    </DockContext.Provider>
  );
}
