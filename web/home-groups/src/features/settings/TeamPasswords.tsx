import { useId, useState } from 'react';
import type { GeneratePasswordOk, TeamAccountItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Pill } from '../../shared/ui';
import { copyText } from '../requests/work/clipboard';
import { formatWhen } from './model';
import { ConfirmDialog } from './StaffDialogs';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.users.team;
const MASK = '••••••••••••••';

/** «Глазик»: открытый — показать пароль, перечёркнутый — скрыть. Цвет — от текста кнопки, работает во всех темах. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Выданный пароль на экране: скрыт точками, «глазик» показывает, кнопка копирует. Живёт до перезагрузки страницы. */
function SecretPassword({ name, password }: { name: string; password: string }) {
  const [shown, setShown] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <span className={u.secret}>
      <code data-testid="team-password" className={u.secretValue}>
        {shown ? password : MASK}
      </code>
      <Button size="sm" aria-label={shown ? t.hideAria(name) : t.showAria(name)} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        <EyeIcon crossed={shown} />
      </Button>
      <Button
        size="sm"
        aria-label={t.copyAria(name)}
        onClick={() => void copyText(password).then((ok) => setCopy(ok ? 'done' : 'failed'))}
      >
        {t.copy}
      </Button>
      <span role="status" className={copy === 'failed' ? u.copyFail : u.copyOk}>
        {copy === 'done' ? t.copied : copy === 'failed' ? t.copyFailed : ''}
      </span>
    </span>
  );
}

/**
 * «Пароли для команды»: каждый из справочника команды (координаторы, распределители) с кнопкой «Сгенерировать пароль».
 * Ссылки «задайте пароль сами» не прижились, поэтому администратор выдаёт пароль сам и раздаёт лично. Сервер хранит
 * только хеш, поэтому пароль виден лишь здесь и лишь до перезагрузки страницы: потеряли — генерируют новый.
 */
export function TeamPasswords({
  team,
  personalEnabled,
  busy,
  generate,
}: {
  team: TeamAccountItem[];
  personalEnabled: boolean;
  busy: boolean;
  /** Запрос на сервер; строка — текст ошибки, null — запрос не ушёл (уже идёт другой). */
  generate: (coordinatorId: number) => Promise<GeneratePasswordOk | string | null>;
}) {
  const titleId = useId();
  const [issued, setIssued] = useState<Record<number, { login: string; password: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TeamAccountItem | null>(null);

  async function run(m: TeamAccountItem): Promise<string | null> {
    setError(null);
    const r = await generate(m.coordinatorId);
    if (r === null) return null;
    if (typeof r === 'string') {
      setConfirming(null);
      setError(r);
      return null;
    }
    setConfirming(null);
    setIssued((prev) => ({ ...prev, [m.coordinatorId]: { login: r.login, password: r.password } }));
    return null;
  }

  return (
    <section aria-labelledby={titleId} className={u.team}>
      <div className={u.listHead}>
        <h3 id={titleId} className={u.listTitle}>
          {t.title}
        </h3>
      </div>
      <p className={styles.muted}>{t.lead}</p>
      {!personalEnabled && <p className={styles.noticeWarn}>{t.personalOff}</p>}
      {error && (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      )}
      {team.length === 0 ? (
        <p className={styles.muted}>{t.empty}</p>
      ) : (
        <div className={u.wrap}>
          <table className={u.table} aria-labelledby={titleId}>
            <thead>
              <tr>
                <th scope="col">{t.cols.name}</th>
                <th scope="col">{t.cols.role}</th>
                <th scope="col">{t.cols.login}</th>
                <th scope="col">{t.cols.password}</th>
                <th scope="col">{t.cols.actions}</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => {
                const fresh = issued[m.coordinatorId];
                const login = fresh?.login ?? m.login;
                const when = formatWhen(m.lastLoginAt);
                return (
                  <tr key={m.coordinatorId} className={u.row}>
                    <td data-label={t.cols.name} className={u.name}>
                      {m.name}
                    </td>
                    <td data-label={t.cols.role}>{m.teamRole}</td>
                    <td data-label={t.cols.login} className={`${u.login} ${u.nowrap}`}>
                      {login ?? <span className={styles.muted}>{t.noLogin}</span>}
                    </td>
                    <td data-label={t.cols.password}>
                      <div>
                        {fresh ? (
                          <SecretPassword name={m.name} password={fresh.password} />
                        ) : (
                          <Pill tone={m.hasPassword ? 'ok' : 'plain'}>{m.hasPassword ? t.hasPassword : t.noPassword}</Pill>
                        )}
                        {!m.active && <p className={u.linkNote}>{t.disabled}</p>}
                        {m.hasPassword && when && <p className={u.linkNote}>{t.lastLogin(when)}</p>}
                      </div>
                    </td>
                    <td data-label={t.cols.actions} className={u.actionsCell}>
                      <div className={u.actions}>
                        {m.hasPassword || fresh ? (
                          <Button aria-label={t.regenerateAria(m.name)} disabled={busy || !m.active} onClick={() => setConfirming(m)}>
                            {t.regenerate}
                          </Button>
                        ) : (
                          <Button variant="primary" aria-label={t.generateAria(m.name)} disabled={busy || !m.active} onClick={() => void run(m)}>
                            {t.generate}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={t.confirmTitle(confirming.name)}
          text={t.confirmText}
          confirmLabel={t.confirm}
          busy={busy}
          onConfirm={() => run(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
