import { useState } from 'react';
import { ru } from '../../shared/i18n/ru';
import { Button, Pill } from '../../shared/ui';
import { copyText } from '../requests/work/clipboard';
import u from './Users.module.css';

const t = ru.settings.users.password;
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

/**
 * Пароль пользователя в списке. Только что выданный уже на экране; выданный раньше сервер хранит зашифрованным и
 * отдаёт по «глазику» (каждое открытие — в журнал), поэтому за ним идём лишь по нажатию, а не со всем списком.
 * Пароль, заданный до шифрования, не открыть: тогда так и написано, а новый выдаёт кнопка в строке.
 */
export function PasswordCell({
  name,
  fresh,
  hasPassword,
  viewable,
  reveal,
}: {
  name: string;
  /** Пароль, выданный на этом экране: его не нужно просить у сервера. */
  fresh: string | undefined;
  hasPassword: boolean;
  viewable: boolean;
  /** Строка — пароль, `{ error }` — отказ словами, null — запрос не ушёл (идёт другой). */
  reveal: () => Promise<string | { error: string } | null>;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [shown, setShown] = useState(fresh !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const value = fresh ?? opened;

  if (!fresh && !hasPassword) return <Pill tone="plain">{t.none}</Pill>;
  if (!fresh && !viewable) return <span className={u.linkNote}>{t.old}</span>;

  async function toggle() {
    setError(null);
    if (shown) return setShown(false);
    if (value !== null) return setShown(true);
    const r = await reveal();
    if (r === null) return;
    if (typeof r === 'string') {
      setOpened(r);
      setShown(true);
    } else setError(r.error);
  }

  return (
    <div>
      <span className={u.secret}>
        <code data-testid="user-password" className={u.secretValue}>
          {shown && value !== null ? value : MASK}
        </code>
        <Button size="sm" aria-label={shown ? t.hideAria(name) : t.showAria(name)} aria-pressed={shown} onClick={() => void toggle()}>
          <EyeIcon crossed={shown} />
        </Button>
        {value !== null && (
          <Button size="sm" aria-label={t.copyAria(name)} onClick={() => void copyText(value).then((ok) => setCopy(ok ? 'done' : 'failed'))}>
            {t.copy}
          </Button>
        )}
        <span role="status" className={copy === 'failed' ? u.copyFail : u.copyOk}>
          {copy === 'done' ? t.copied : copy === 'failed' ? t.copyFailed : ''}
        </span>
      </span>
      {error && (
        <p role="alert" className={u.copyFail}>
          {error}
        </p>
      )}
    </div>
  );
}
