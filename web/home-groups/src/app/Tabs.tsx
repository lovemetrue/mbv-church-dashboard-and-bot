import { useRef, type KeyboardEvent } from 'react';
import { openCount } from '../entities/buckets';
import { useMe, useRequests } from '../shared/api/queries';
import { ru } from '../shared/i18n/ru';
import { useAppNav, visibleTabs, type TabId } from '../shared/nav';
import styles from './App.module.css';

export const tabDomId = (tab: TabId): string => `tab-${tab}`;
export const PANEL_ID = 'tabpanel';

/** Вкладки по шаблону WAI-ARIA: стрелки, Home/End, один пункт в порядке Tab (roving tabindex). */
export function Tabs() {
  const nav = useAppNav();
  const requests = useRequests();
  const me = useMe();
  const tabs = visibleTabs(me.data?.role);
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const open = requests.data ? openCount(requests.data.counters) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.indexOf(nav.tab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const tab = tabs[next] as TabId;
    nav.goTab(tab);
    refs.current[tab]?.focus();
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label={ru.tabs.label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab}
          ref={(el) => {
            refs.current[tab] = el;
          }}
          id={tabDomId(tab)}
          type="button"
          role="tab"
          aria-selected={nav.tab === tab}
          aria-controls={PANEL_ID}
          tabIndex={nav.tab === tab ? 0 : -1}
          className={styles.tab}
          onClick={() => nav.goTab(tab)}
        >
          {ru.tabs[tab]}
          {tab === 'requests' && open !== null && <span className={`${styles.cnt} num`}>{open}</span>}
        </button>
      ))}
    </div>
  );
}
