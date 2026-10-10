import { useEffect } from 'react';
import { useMe } from '../shared/api/queries';
import { ru } from '../shared/i18n/ru';
import { useAppNav } from '../shared/nav';
import { LoadingState } from '../shared/ui';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { ReferenceScreen } from '../features/reference/ReferenceScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import styles from './App.module.css';
import { Header } from './Header';
import { PANEL_ID, Tabs, tabDomId } from './Tabs';

/**
 * «Настройки» только для полного входа. Роль приходит отдельным запросом, поэтому пока её нет,
 * показываем ожидание, а не экран: иначе обычный вход на миг увидел бы запросы к закрытым
 * адресам. Тому, у кого роль обычная (или не удалось узнать), адрес вкладки, набранный вручную,
 * не годится: возвращаем на «Сегодня». Настоящая защита всё равно на сервере (403).
 */
function SettingsRoute() {
  const nav = useAppNav();
  const me = useMe();
  const allowed = me.data?.role === 'super';
  const denied = !allowed && !me.isPending;
  useEffect(() => {
    // replace: иначе «назад» вернул бы на закрытый адрес и снова увёл бы вперёд.
    if (denied) nav.goTab('today', { replace: true });
  }, [denied, nav.goTab]);
  if (allowed) return <SettingsScreen />;
  return denied ? null : <LoadingState />;
}

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
        {nav.tab === 'settings' && <SettingsRoute />}
      </main>
    </div>
  );
}
