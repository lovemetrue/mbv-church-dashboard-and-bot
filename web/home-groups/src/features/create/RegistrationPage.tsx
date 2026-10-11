import { LOGOUT_URL } from '../../shared/api/base';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import { FormMetaContent } from './FormMetaGate';
import { RegistrationFlow } from './RegistrationFlow';

/** Адрес отдельной страницы регистрации внутри приложения (после основания сборки). */
export const REGISTRATION_PATH = '/registration';

/** Это адрес страницы регистрации? Слэш на конце не мешает. */
export const isRegistrationPath = (pathname: string): boolean => pathname.replace(/\/+$/, '') === REGISTRATION_PATH;

/**
 * Страница регистрации на месте для волонтёров: только форма, без шапки, вкладок и списков. Данные приложения
 * здесь не запрашиваются вовсе — нужны лишь справочники формы и сама регистрация, поэтому волонтёру достаточно
 * входа и телефона. «Выйти» — обычная форма POST, как в шапке.
 */
export function RegistrationPage() {
  return (
    <main className={styles.standalone}>
      <header className={styles.standaloneHead}>
        <h1 className={styles.standaloneTitle}>{ru.standalone.title}</h1>
        <form method="post" action={LOGOUT_URL} className={styles.standaloneLogout}>
          <Button type="submit" variant="ghost">
            {ru.standalone.logout}
          </Button>
        </form>
      </header>
      <div className={styles.standaloneCard}>
        <FormMetaContent>{(meta) => <RegistrationFlow meta={meta} />}</FormMetaContent>
      </div>
    </main>
  );
}
