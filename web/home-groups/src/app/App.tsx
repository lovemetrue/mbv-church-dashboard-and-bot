import { ru } from '../shared/i18n/ru';
import { useAppNav } from '../shared/nav';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { ReferenceScreen } from '../features/reference/ReferenceScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import styles from './App.module.css';
import { Header } from './Header';
import { PANEL_ID, Tabs, tabDomId } from './Tabs';

/** Оболочка: шапка, вкладки и содержимое выбранной вкладки. Роутер и провайдеры — снаружи. */
export function App() {
  const nav = useAppNav();
  return (
    <div className={styles.wrap}>
      <a className={styles.skip} href="#tabpanel">
        {ru.skipToContent}
      </a>
      <Header />
      <Tabs />
      <main id={PANEL_ID} role="tabpanel" aria-labelledby={tabDomId(nav.tab)} tabIndex={-1} className={styles.main}>
        {nav.tab === 'today' && <TodayScreen />}
        {nav.tab === 'requests' && <RequestsScreen />}
        {nav.tab === 'reference' && <ReferenceScreen />}
      </main>
    </div>
  );
}
