import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Role, StaffItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { PersonField } from '../manage/PersonField';
import { isValidEmail } from './model';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.users;

const ROLES: readonly Role[] = ['admin', 'readonly', 'registration', 'super'];

/** То, что вводят в форме «Добавить» и «Изменить». */
export interface StaffFormValues {
  fullName: string;
  email: string;
  role: Role;
  /** Только при добавлении; пусто — пусть подберёт сервер. */
  login: string;
  /** Человек из «Людей» («u12», «p7»); пусто — ФИО только строкой (служебная запись, человек не из «Людей»). */
  personKey: string;
  /** Роли в команде (`team_roles.id`) — только у участника команды; у остальных пусто и не отправляется. */
  teamRoleIds: number[];
}

/** Роли команды для формы: у участника команды они отмечаются галочками рядом с ролью доступа. */
export interface TeamRolesChoice {
  options: { id: number; name: string; meaning: string }[];
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
  teamRoles,
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
  /** Есть — запись участника команды: его роли в команде правятся тут же. */
  teamRoles?: TeamRolesChoice;
  busy: boolean;
  onSubmit: (values: StaffFormValues) => Promise<string | null>;
  onClose: () => void;
}) {
  const ids = { name: useId(), email: useId(), login: useId(), nameErr: useId(), emailErr: useId(), loginHint: useId(), person: useId(), personHint: useId(), teamErr: useId() };
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<StaffFormValues>(initial);
  const [problems, setProblems] = useState<{ name?: string; email?: string; team?: string }>({});
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
    const next: { name?: string; email?: string; team?: string } = {};
    if (!values.fullName.trim()) next.name = t.errFullName;
    // Без роли участника команды сервер не сохранит: справочник требует хотя бы одну.
    if (teamRoles && values.teamRoleIds.length === 0) next.team = t.errTeamRole;
    // Почта необязательна: пароль выдаётся сразу, а почта нужна только ссылке «Забыли пароль». Вписанная — проверяется.
    if (values.email.trim() !== '' && !isValidEmail(values.email)) next.email = t.errEmail;
    setProblems(next);
    if (next.name) return nameRef.current?.focus();
    if (next.email) return emailRef.current?.focus();
    if (next.team) return;
    setError(await onSubmit({ ...values, fullName: values.fullName.trim(), email: values.email.trim(), login: values.login.trim() }));
  }

  const unchanged =
    fixedLogin !== undefined &&
    values.fullName.trim() === initial.fullName &&
    values.email.trim() === initial.email &&
    values.role === initial.role &&
    values.personKey === initial.personKey &&
    sameIds(values.teamRoleIds, initial.teamRoleIds);

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

        {/* Роль доступа — сразу после ФИО: это главное, что решают о пользователе, и её не должно быть видно лишь после прокрутки. */}
        <fieldset className={u.fieldset}>
          <legend className={u.legend}>{t.role}</legend>
          <p className={`${styles.muted} ${u.radioHint}`}>{t.roleLead}</p>
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

        {teamRoles && (
          <fieldset className={u.fieldset} aria-describedby={problems.team ? ids.teamErr : undefined}>
            <legend className={u.legend}>{t.teamRolesLabel}</legend>
            <p className={`${styles.muted} ${u.radioHint}`}>{t.teamRolesLead}</p>
            {teamRoles.options.map((r) => {
              const nameId = `${ids.name}-team-${r.id}`;
              const descId = `${ids.name}-team-${r.id}-desc`;
              return (
                <label key={r.id} className={u.radio}>
                  <input
                    type="checkbox"
                    checked={values.teamRoleIds.includes(r.id)}
                    aria-labelledby={nameId}
                    aria-describedby={descId}
                    onChange={(e) => {
                      const on = e.target.checked;
                      set('teamRoleIds', on ? [...values.teamRoleIds, r.id] : values.teamRoleIds.filter((x) => x !== r.id));
                      setProblems((p) => ({ ...p, team: undefined }));
                    }}
                  />
                  <span className={u.radioText}>
                    <span id={nameId} className={u.radioName}>
                      {r.name}
                    </span>
                    <span id={descId} className={`${styles.muted} ${u.radioHint}`}>
                      {r.meaning}
                    </span>
                  </span>
                </label>
              );
            })}
            {problems.team && (
              <p id={ids.teamErr} className={u.fieldError} role="alert">
                {problems.team}
              </p>
            )}
          </fieldset>
        )}

        {/* ФИО — строкой, а если это человек из «Людей», рядом ссылка на него: его данные не дублируются. */}
        <label htmlFor={ids.person} className={styles.fieldLabel}>
          {t.person}
        </label>
        <PersonField
          id={ids.person}
          label={t.person}
          value={values.personKey}
          taken=""
          disabled={busy}
          describedBy={ids.personHint}
          onPick={(p) => {
            setValues((v) => ({ ...v, personKey: p?.key ?? '', fullName: v.fullName.trim() ? v.fullName : (p?.fio ?? '') }));
            setError(null);
          }}
        />
        <p id={ids.personHint} className={styles.muted}>
          {t.personHint}
        </p>

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

export const toFormValues = (item: StaffItem, teamRoleIds: number[] = []): StaffFormValues => ({
  fullName: item.fullName,
  email: item.email ?? '',
  role: item.role,
  login: '',
  personKey: item.personKey ?? '',
  teamRoleIds,
});

/** Те же роли, в любом порядке: порядок галочек не правка. */
export const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));
