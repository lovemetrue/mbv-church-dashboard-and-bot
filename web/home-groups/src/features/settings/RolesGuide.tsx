import type { Role } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.rolesGuide;
/** Порядок столбцов — от меньших прав к большим, как в окне пользователя. */
const ROLES: readonly Role[] = ['readonly', 'registration', 'admin', 'super'];

/**
 * «Что может каждая роль»: таблица разделов и действий по ролям доступа, а под ней — что добавляют роли в команде.
 * Права здесь описаны словами, а держит их сервер (`readonlyAllows`, `deskAllows`, `mayEditGroups`, «только полный вход»):
 * меняя права на сервере, поправьте и эту таблицу (`ru.settings.rolesGuide`).
 */
export function RolesGuide() {
  return (
    <details className={u.guide}>
      <summary className={u.guideSummary}>{t.title}</summary>
      <p className={styles.muted}>{t.caption}</p>
      <div className={u.guideWrap}>
        <table className={u.guideTable} aria-label={t.title}>
          <thead>
            <tr>
              <th scope="col">{t.what}</th>
              {ROLES.map((r) => (
                <th key={r} scope="col">
                  {ru.settings.users.roles[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map(([what, marks]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                {ROLES.map((r, i) => (
                  <td key={r} aria-label={marks[i] === '+' ? t.yes : marks[i] === '·' ? t.no : t.partly}>
                    <span aria-hidden="true">{marks[i] === '+' ? '✓' : marks[i] === '·' ? '—' : '✓*'}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>{t.footnote}</p>
      <h4 className={u.guideSub}>{t.teamTitle}</h4>
      <ul className={u.guideList}>
        {t.team.map(([role, meaning]) => (
          <li key={role}>
            <b>{role}</b> — {meaning}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{t.contacts}</p>
    </details>
  );
}
