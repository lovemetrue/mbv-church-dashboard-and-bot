import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import { Answer } from './Answer';
import { DockFrame, type DockTabs } from './DockFrame';
import { COUNTER_FROM, MAX_LENGTH } from './model';
import type { Chat } from './useChat';
import styles from './Chat.module.css';

const t = ru.chat;

interface PanelProps {
  chat: Chat;
  draft: string;
  onDraft: (value: string) => void;
  onClose: () => void;
  /** Ссылка «Настройки → Помощник» только полному входу: обычному туда нельзя. */
  isSuper: boolean;
  /** Вкладки окна помощника; null — вкладок нет. */
  tabs?: DockTabs | null;
}

/** Вкладка «Вопрос по базе» окна помощника. */
export function ChatPanel({ chat, draft, onDraft, onClose, isSuper, tabs = null }: PanelProps) {
  const nav = useAppNav();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { entries, pending, history, loadHistory } = chat;
  const last = entries[entries.length - 1];
  const memoryId = useId();

  // Прошлый разговор хранит сервер: читаем его при открытии окна (повторно за сеанс страницы он не запрашивается).
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // При открытии фокус сразу в поле: человек пришёл спросить.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Пока шёл запрос, поле было неактивно и фокус ушёл на страницу; вернуть его надо, но не отбирать у того,
  // кто успел нажать другую кнопку окна («Скопировать ответ»).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      const active = document.activeElement;
      // Нажатая «Отправить» к этому времени тоже неактивна и браузеры по-разному решают, куда ушёл фокус.
      const lost = !active || active === document.body || active === inputRef.current || (active as HTMLButtonElement).disabled;
      if (lost) inputRef.current?.focus({ preventScroll: true });
    }
    wasPending.current = pending;
  }, [pending]);

  // К последнему сообщению: новый ответ и «Ищу в базе…» не должны оставаться за краем.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [entries.length, pending]);

  function submit() {
    if (chat.send(draft)) onDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter, которым выбирают вариант при вводе (IME), отправкой не считается.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const showCounter = draft.length >= COUNTER_FROM;

  return (
    <DockFrame subtitle={t.subtitle} onClose={onClose} tabs={tabs}>
      <div className={styles.scroll} ref={scrollRef}>
        <div role="log" aria-label={t.logLabel} className={styles.log}>
          <div className={`${styles.bubble} ${styles.bot}`}>
            <p className={styles.text}>{t.hello}</p>
            {entries.length === 0 && history === 'error' && (
              <div role="alert" className={styles.historyError}>
                <p className={styles.text}>{t.historyError}</p>
                <Button size="sm" onClick={() => void loadHistory()}>
                  {t.historyRetry}
                </Button>
              </div>
            )}
            {entries.length === 0 && history !== 'loading' && history !== 'idle' && (
              <div role="group" aria-label={t.chipsLabel} className={styles.chips}>
                {t.chips.map((q) => (
                  <button key={q} type="button" className={styles.chip} onClick={() => chat.send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
          {entries.map((e) =>
            e.kind === 'user' ? (
              <div key={e.id} className={`${styles.bubble} ${styles.me}`}>
                <span className={styles.sr}>{t.you}: </span>
                <p className={styles.text}>{e.text}</p>
              </div>
            ) : e.kind === 'answer' ? (
              <div key={e.id} className={`${styles.bubble} ${styles.bot}`}>
                <span className={styles.sr}>{t.assistant}: </span>
                <Answer answer={e.answer} queries={e.queries} tables={e.tables} />
              </div>
            ) : (
              <div key={e.id} className={`${styles.bubble} ${styles.bot} ${styles.failure}`}>
                <span className={styles.errorMark}>{t.errorMark}</span>
                <p className={styles.text}>{e.text}</p>
                {e.hint === 'settings' && isSuper && (
                  <p className={styles.hint}>
                    {t.settingsHint}{' '}
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => {
                        nav.goSettingsSection('assistant');
                        onClose();
                      }}
                    >
                      {t.settingsLink}
                    </button>
                  </p>
                )}
                {e === last && (
                  <div className={styles.answerActions}>
                    <Button size="sm" disabled={pending} onClick={chat.retry}>
                      {t.retry}
                    </Button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        <div role="status" className={styles.thinkingBox}>
          {pending && <div className={`${styles.bubble} ${styles.bot} ${styles.thinking}`}>{t.thinking}</div>}
          {history === 'loading' && <div className={`${styles.bubble} ${styles.bot} ${styles.thinking}`}>{t.historyLoading}</div>}
        </div>
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.inputRow}>
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={2}
            maxLength={MAX_LENGTH}
            value={draft}
            disabled={pending}
            placeholder={t.placeholder}
            aria-label={t.inputLabel}
            aria-describedby={memoryId}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="submit" variant="primary" disabled={pending || !draft.trim()} aria-label={t.send}>
            →
          </Button>
        </div>
        <p id={memoryId} className={styles.memory}>
          {t.memory}
        </p>
        {chat.clearError && (
          <p role="alert" className={styles.clearError}>
            {chat.clearError}
          </p>
        )}
        <div className={styles.formFoot}>
          {entries.length > 0 ? (
            <Button size="sm" variant="ghost" disabled={chat.clearing} onClick={() => void chat.clear()}>
              {chat.clearing ? t.clearing : t.clear}
            </Button>
          ) : (
            <span />
          )}
          {showCounter && <span className={styles.counter}>{t.counter(draft.length, MAX_LENGTH)}</span>}
        </div>
      </form>
    </DockFrame>
  );
}
