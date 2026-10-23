import type { KeyboardEvent, ReactNode } from 'react';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import type { DockTab } from './AssistantChat';
import styles from './Chat.module.css';

export interface DockTabs {
  current: DockTab;
  onSelect: (tab: DockTab) => void;
}

const TAB_LABELS: Record<DockTab, string> = { review: ru.requests.assistant.tabReview, chat: ru.requests.assistant.tabChat };

/**
 * Рамка окна помощника: заголовок, вкладки «Разбор заявок» / «Вопрос по базе» и содержимое. Окно не модальное:
 * за ним можно читать страницу, поэтому фокус не заперт, а Esc закрывает только его.
 */
export function DockFrame({ subtitle, onClose, tabs, children }: { subtitle: string; onClose: () => void; tabs: DockTabs | null; children: ReactNode }) {
  // Esc ловим на самом окне и гасим: иначе вместе с ним закрылась бы карточка заявки или записи под ним
  // (она слушает Esc на document и пропускает только уже погашенное событие).
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
  return (
    <section className={styles.panel} role="dialog" aria-modal="false" aria-label={ru.chat.title} onKeyDown={onKeyDown}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{ru.chat.title}</h2>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label={ru.chat.close}>
          ✕
        </Button>
      </header>
      {tabs && (
        <div role="group" aria-label={ru.requests.assistant.tabsLabel} className={styles.tabs}>
          {(['review', 'chat'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={styles.tab}
              aria-pressed={tabs.current === t}
              onClick={() => tabs.onSelect(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
