import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../shared/api/queries';
import { ru } from '../shared/i18n/ru';
import { useAppNav, visibleTabs } from '../shared/nav';
import { LoadingState } from '../shared/ui';
import { AssistantChat } from '../features/assistant-chat';
import { isRegistrationPath, REGISTRATION_PATH, RegistrationPage } from '../features/create/RegistrationPage';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { GroupsScreen } from '../features/groups/GroupsScreen';
import { KitsScreen } from '../features/kits/KitsScreen';
import { ReferenceScreen } from '../features/reference/ReferenceScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TeamScreen } from '../features/team/TeamScreen';
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

/**
 * Оболочка: шапка, вкладки и содержимое выбранной вкладки. Роутер и провайдеры — снаружи.
 * Страница `/registration` решается до оболочки, а не внутри неё: оболочка при показе тут же начинает читать
 * заявки и «Сегодня», а волонтёру на месте нужна только форма.
 */
export function App() {
  const { pathname } = useLocation();
  const me = useMe();
  if (isRegistrationPath(pathname)) return <RegistrationPage />;
  // Стойке регистрации остальные разделы закрыты (сервер отвечает 403 и сам уводит её на `/registration` при загрузке):
  // сюда она попадёт разве что переходом внутри приложения — возвращаем на её страницу.
  if (me.data?.role === 'registration') return <Navigate to={REGISTRATION_PATH} replace />;
  return <Shell />;
}

/**
 * Вкладка, которой этому входу не видно (например, «Команда» и «Наборы» у «Только чтение»), по набранному вручную адресу
 * уводит на «Сегодня», как «Настройки». Настоящая защита — 403 сервера.
 */
function HiddenTabGuard() {
  const nav = useAppNav();
  const me = useMe();
  const hidden = me.data !== undefined && !visibleTabs(me.data.role).includes(nav.tab) && nav.tab !== 'settings';
  useEffect(() => {
    if (hidden) nav.goTab('today', { replace: true });
  }, [hidden, nav.goTab]);
  return null;
}

function Shell() {
  const nav = useAppNav();
  // «Команда» и «Наборы» закрыты входу «Только чтение»: их экраны ждут ответа `/me`, чтобы не спросить лишнего.
  const role = useMe().data?.role;
  const shown = role ? visibleTabs(role) : [];
  return (
    <div className={styles.wrap}>
      <a className={styles.skip} href="#tabpanel">
        {ru.skipToContent}
      </a>
      {/* Помощник — снаружи вкладок: его окно открывается и плавающей кнопкой, и значком ✦ в блоке подбора. */}
      <HiddenTabGuard />
      <AssistantChat>
        <Header />
        <Tabs />
        <main id={PANEL_ID} role="tabpanel" aria-labelledby={tabDomId(nav.tab)} tabIndex={-1} className={styles.main}>
          {nav.tab === 'today' && <TodayScreen />}
          {nav.tab === 'requests' && <RequestsScreen />}
          {nav.tab === 'groups' && <GroupsScreen />}
          {nav.tab === 'kits' && shown.includes('kits') && <KitsScreen />}
          {nav.tab === 'team' && shown.includes('team') && <TeamScreen />}
          {nav.tab === 'reference' && <ReferenceScreen />}
          {nav.tab === 'settings' && <SettingsRoute />}
        </main>
      </AssistantChat>
    </div>
  );
}
