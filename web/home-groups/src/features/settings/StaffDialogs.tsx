import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Role, StaffItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { isValidEmail } from './model';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.users;

const ROLES: readonly Role[] = ['admin', 'super'];

/** То, что вводят в форме «Добавить» и «Изменить». */
export interface StaffFormValues {
  fullName: string;
  email: string;
  role: Role;
  /** Только при добавлении; пусто — пусть подберёт сервер. */
  login: string;
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className={styles.noticeError} role="alert">
      {text}
    </p>
  );
}

/**
 * Форма пользователя: одна и для «Добавить», и для «Изменить». Проверяет только то, что можно
 * проверить на месте (ФИО не пустое, почта похожа на почту); остальное решает сервер, и его
 * отказ показывается над кнопками, не стирая набранное.
 *
 * `onSubmit` возвращает текст ошибки или null. Закрывает окно тот, кто его открыл: форма не
 * знает, что делать после успеха (закрыть, показать ссылку или письмо).
 */
export function StaffFormDialog({
  title,
  submitLabel,
  submittingLabel,
  initial,
  fixedLogin,
  suggest,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  submittingLabel: string;
  initial: StaffFormValues;
  /** Логин существующего пользователя: его не меняют, поэтому поле заменено строкой. */
  fixedLogin?: string;
  /** Подсказка логина по ФИО; undefined — подсказывать нечего (форма «Изменить»). */
  suggest?: (fullName: string) => Promise<string | null>;
  busy: boolean;
  onSubmit: (values: StaffFormValues) => Promise<string | null>;
  onClose: () => void;
}) {
  const ids = { name: useId(), email: useId(), login: useId(), nameErr: useId(), emailErr: useId(), loginHint: useId() };
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<StaffFormValues>(initial);
  const [problems, setProblems] = useState<{ name?: string; email?: string }>({});
  const [error, setError] = useState<string | null>(null);

  // Ответ на подсказку может прийти позже, чем человек успел поменять ФИО: берём только
  // последний запрос, иначе в поле встал бы логин от старого имени.
  const suggestSeq = useRef(0);
  const suggestedFor = useRef<string | null>(null);
  const touchedRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const set = <K extends keyof StaffFormValues>(key: K, value: StaffFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  };

  async function suggestLogin() {
    const name = values.fullName.trim();
    if (!suggest || !name || touchedRef.current || suggestedFor.current === name) return;
    suggestedFor.current = name;
    const seq = ++suggestSeq.current;
    const login = await suggest(name);
    // Подсказка необязательна: не вышла — человек впишет логин сам или оставит пустым.
    if (!login || seq !== suggestSeq.current || touchedRef.current || !mounted.current) return;
    setValues((v) => ({ ...v, login }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: { name?: string; email?: string } = {};
    if (!values.fullName.trim()) next.name = t.errFullName;
    if (!isValidEmail(values.email)) next.email = t.errEmail;
    setProblems(next);
    if (next.name) return nameRef.current?.focus();
    if (next.email) return emailRef.current?.focus();
    setError(await onSubmit({ ...values, fullName: values.fullName.trim(), email: values.email.trim(), login: values.login.trim() }));
  }

  const unchanged =
    fixedLogin !== undefined &&
    values.fullName.trim() === initial.fullName &&
    values.email.trim() === initial.email &&
    values.role === initial.role;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={ids.name} className={styles.fieldLabel} style={{ marginTop: 0 }}>
          {t.fullName}
        </label>
        <input
          id={ids.name}
          ref={nameRef}
          type="text"
          className={`${styles.control} ${problems.name ? u.invalid : ''}`}
          value={values.fullName}
          autoComplete="off"
          aria-invalid={problems.name ? true : undefined}
          aria-describedby={problems.name ? ids.nameErr : undefined}
          onChange={(e) => {
            set('fullName', e.target.value);
            setProblems((p) => ({ ...p, name: undefined }));
          }}
          onBlur={() => void suggestLogin()}
        />
        {problems.name && (
          <p id={ids.nameErr} className={u.fieldError}>
            {problems.name}
          </p>
        )}

        <label htmlFor={ids.email} className={styles.fieldLabel}>
          {t.email}
        </label>
        <input
          id={ids.email}
          ref={emailRef}
          type="email"
          inputMode="email"
          className={`${styles.control} ${problems.email ? u.invalid : ''}`}
          value={values.email}
          autoComplete="off"
          autoCapitalize="none"
          aria-invalid={problems.email ? true : undefined}
          aria-describedby={problems.email ? ids.emailErr : undefined}
          onChange={(e) => {
            set('email', e.target.value);
            setProblems((p) => ({ ...p, email: undefined }));
          }}
        />
        {problems.email && (
          <p id={ids.emailErr} className={u.fieldError}>
            {problems.email}
          </p>
        )}

        <fieldset className={u.fieldset}>
          <legend className={u.legend}>{t.role}</legend>
          {ROLES.map((role) => {
            const nameId = `${ids.name}-${role}-name`;
            const descId = `${ids.name}-${role}-desc`;
            return (
              // Вся карточка — подпись переключателя, чтобы попасть было легко пальцем; имя же берём
              // только из заголовка, а пояснение читается как описание.
              <label key={role} className={u.radio}>
                <input
                  type="radio"
                  name={`${ids.name}-role`}
                  checked={values.role === role}
                  aria-labelledby={nameId}
                  aria-describedby={descId}
                  onChange={() => set('role', role)}
                />
                <span className={u.radioText}>
                  <span id={nameId} className={u.radioName}>
                    {t.roles[role]}
                  </span>
                  <span id={descId} className={`${styles.muted} ${u.radioHint}`}>
                    {t.roleHints[role]}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {fixedLogin !== undefined ? (
          <p className={`${styles.muted} ${u.passwordNote}`}>{t.loginFixed(fixedLogin)}</p>
        ) : (
          <>
            <label htmlFor={ids.login} className={styles.fieldLabel}>
              {t.login}
            </label>
            <input
              id={ids.login}
              type="text"
              className={styles.control}
              value={values.login}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={ids.loginHint}
              onChange={(e) => {
                touchedRef.current = true;
                set('login', e.target.value);
              }}
            />
            <p id={ids.loginHint} className={styles.muted}>
              {t.loginHint}
            </p>
            <p className={`${styles.muted} ${u.passwordNote}`}>{t.passwordNote}</p>
          </>
        )}

        <ErrorLine text={error} />
        <div className={styles.dialogFoot}>
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button type="submit" variant="primary" disabled={busy || unchanged}>
            {busy ? submittingLabel : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Окно подтверждения: отключение, включение и переключение личных входов. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  busy: boolean;
  /** Возвращает текст ошибки или null; окно закрывает вызвавший. */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      <ErrorLine text={error} />
      <div className={styles.dialogFoot}>
        <Button onClick={onClose}>{t.cancel}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setError(await onConfirm());
          }}
        >
          {busy ? t.working : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Полная ссылка на пароль. Показывается, когда письмо не ушло: администратор передаёт её
 * человеку сам. Ссылка одноразовая, поэтому предупреждение стоит прямо над ней.
 */
export function LinkDialog({ name, email, url, onClose }: { name: string; email: string; url: string; onClose: () => void }) {
  const boxId = useId();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');

  async function copyLink() {
    boxRef.current?.select();
    try {
      // Без защищённого соединения (http) буфера обмена у страницы нет: тогда пробуем старый способ.
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (!document.execCommand('copy')) throw new Error('copy');
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <Modal title={t.linkTitle(name)} onClose={onClose}>
      <p>{t.linkLead(email)}</p>
      <p className={styles.noticeWarn}>{t.linkWarning}</p>
      <label htmlFor={boxId} className={styles.fieldLabel}>
        {t.linkLabel}
      </label>
      <textarea
        id={boxId}
        ref={boxRef}
        className={u.linkBox}
        readOnly
        rows={4}
        value={url}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={u.copyRow}>
        <Button variant="primary" onClick={() => void copyLink()}>
          {t.copy}
        </Button>
        <span role="status" className={copy === 'failed' ? u.copyFail : u.copyOk}>
          {copy === 'done' ? t.copied : copy === 'failed' ? t.copyFailed : ''}
        </span>
      </div>
      <div className={styles.dialogFoot}>
        <Button onClick={onClose}>{t.close}</Button>
      </div>
    </Modal>
  );
}

export const toFormValues = (item: StaffItem): StaffFormValues => ({
  fullName: item.fullName,
  email: item.email,
  role: item.role,
  login: '',
});
