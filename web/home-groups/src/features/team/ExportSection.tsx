import { useId } from 'react';
import { API_BASE } from '../../shared/api/base';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import buttonStyles from '../../shared/ui/Button.module.css';
import styles from './Team.module.css';

const t = ru.team;

/**
 * «Выгрузка» только для полного входа: в файлах телефоны. Роль берём из `/me`, но решает сервер:
 * обычному входу адреса выгрузки отвечают 403, так что спрятанный блок — лишь удобство.
 * Пока роль не пришла, блока нет: лучше показать позже, чем показать и убрать.
 */
export function ExportSection() {
  const me = useMe();
  const id = useId();
  if (me.data?.role !== 'super') return null;
  const link = `${buttonStyles.btn} ${buttonStyles.primary} ${buttonStyles.md} ${styles.download}`;
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h3 id={id} className={styles.h3}>
        {t.exportTitle}
      </h3>
      <div className={styles.downloads}>
        {/* Обычные ссылки: браузер сам скачает файл вместе с сессионной кукой, JS для этого не нужен. */}
        <a className={link} href={`${API_BASE}export/requests.csv`} download>
          {t.exportRequests}
        </a>
        <a className={link} href={`${API_BASE}export/people.csv`} download>
          {t.exportPeople}
        </a>
      </div>
      <p className={styles.warning}>{t.exportWarning}</p>
    </section>
  );
}
