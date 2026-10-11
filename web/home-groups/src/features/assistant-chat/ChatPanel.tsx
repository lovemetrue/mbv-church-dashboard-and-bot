import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import { Answer } from './Answer';
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
}

/** Окно разговора. Не модальное: за ним можно читать страницу, поэтому фокус не заперт, а Esc закрывает только его. */
export function ChatPanel({ chat, draft, onDraft, onClose, isSuper }: PanelProps) {
  const nav = useAppNav();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { entries, pending } = chat;
  const last = entries[entries.length - 1];

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

  // Esc ловим на самом окне и гасим: иначе вместе с ним закрылась бы карточка заявки или записи под ним
  // (она слушает Esc на document и пропускает только уже погашенное событие).
  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const showCounter = draft.length >= COUNTER_FROM;

  return (
    <section className={styles.panel} role="dialog" aria-modal="false" aria-label={t.title} onKeyDown={onPanelKeyDown}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>
            {t.title}
          </h2>
          <p className={styles.subtitle}>{t.subtitle}</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label={t.close}>
          ✕
        </Button>
      </header>

      <div className={styles.scroll} ref={scrollRef}>
        <div role="log" aria-label={t.logLabel} className={styles.log}>
          <div className={`${styles.bubble} ${styles.bot}`}>
            <p className={styles.text}>{t.hello}</p>
            {entries.length === 0 && (
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
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="submit" variant="primary" disabled={pending || !draft.trim()} aria-label={t.send}>
            →
          </Button>
        </div>
        <div className={styles.formFoot}>
          {entries.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={chat.clear}>
              {t.clear}
            </Button>
          ) : (
            <span />
          )}
          {showCounter && <span className={styles.counter}>{t.counter(draft.length, MAX_LENGTH)}</span>}
        </div>
      </form>
    </section>
  );
}
