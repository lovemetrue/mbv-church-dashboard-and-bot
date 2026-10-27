import type { OwnGroup } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import styles from './Create.module.css';

const t = ru.create.fromRequest;

/**
 * Группа, заведённая по заявке, — ссылкой с кодом и статусом: в строке списка и в шапке карточки, чтобы из заявки
 * сразу было видно, что группа есть и в каком она состоянии, и можно было перейти в её карточку. Клик по ссылке в строке
 * не открывает саму заявку.
 */
export function OwnGroupLink({ group }: { group: OwnGroup }) {
  const nav = useAppNav();
  return (
    <button
      type="button"
      className={styles.ownGroupLink}
      aria-label={t.linkAria(group.code)}
      onClick={(e) => {
        e.stopPropagation();
        nav.openGroup(group.id);
      }}
    >
      {t.link(group.code, group.status)}
    </button>
  );
}
