import { useCallback, useId, useRef, useState } from 'react';
import type { CreateStaffBody, GeneratePasswordOk, SettingsStaffView, StaffItem, TeamAccountItem, UpdateStaffBody } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, EmptyState, Pill } from '../../shared/ui';
import { formatWhen, staffErrorText } from './model';
import { PasswordCell } from './PasswordCell';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useCoordinators } from '../../shared/api/queries';
import { useSettingsStaff, useSettingsTeamRoles, useStaffActions } from './queries';
import { ConfirmDialog, sameIds, StaffFormDialog, toFormValues, type StaffFormValues, type TeamRolesChoice } from './StaffDialogs';
import { RolesGuide } from './RolesGuide';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.users;

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * Строка списка: учётная запись (у неё может быть и место в команде) или человек из справочника команды, которому
 * вход ещё не заведён — запись появится с первым паролем. Прежде это были два списка с одними и теми же людьми.
 */
export interface UserRow {
  key: string;
  name: string;
  account: StaffItem | null;
  member: TeamAccountItem | null;
}

/** Один список из учётных записей и команды: участник команды со входом — та же строка, что и его учётная запись. */
export function userRows(data: Pick<SettingsStaffView, 'items' | 'team'>): UserRow[] {
  const byStaff = new Map(data.team.filter((m) => m.staffId !== null).map((m) => [m.staffId!, m]));
  const rows: UserRow[] = data.items.map((a) => ({ key: `s${a.id}`, name: a.fullName, account: a, member: byStaff.get(a.id) ?? null }));
  for (const m of data.team) if (m.staffId === null) rows.push({ key: `c${m.coordinatorId}`, name: m.name, account: null, member: m });
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: StaffItem }
  | { kind: 'toggle'; item: StaffItem }
  | { kind: 'regenerate'; row: UserRow }
  | { kind: 'personal'; enable: boolean };

type Outcome<T> = { value: T } | { error: string };

/**
 * Один запрос за раз на весь раздел. Двойное нажатие приходит раньше, чем кнопка успевает
 * отключиться после перерисовки, поэтому одного `disabled` мало: нужен флаг в ref. Параллельные
 * действия над разными людьми тоже ни к чему: ответы пришли бы вперемешку с перечитыванием списка.
 */
function useSingleFlight() {
  const flying = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(call: () => Promise<T>): Promise<Outcome<T> | null> => {
    if (flying.current) return null;
    flying.current = true;
    setBusy(true);
    try {
      return { value: await call() };
    } catch (e) {
      return { error: staffErrorText(e) };
    } finally {
      flying.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

function PersonalLogins({ data, busy, onToggle }: { data: SettingsStaffView['personal']; busy: boolean; onToggle: (enable: boolean) => void }) {
  const titleId = useId();
  const { enabled, canEnable, activeWithPassword } = data;
  const p = t.personal;
  return (
    <section aria-labelledby={titleId} className={`${styles.card} ${u.personal}`}>
      <div className={u.personalHead}>
        <h3 id={titleId} className={u.personalTitle}>
          {p.title}
        </h3>
        <Pill tone={enabled ? 'ok' : 'plain'}>{enabled ? p.on : p.off}</Pill>
      </div>
      <p className={u.personalText}>{enabled ? p.explainOn : p.explainOff}</p>
      <div className={u.personalFoot}>
        {/* Выключить можно всегда: иначе при сбое с паролями из режима было бы не выйти. */}
        <Button
          variant={enabled ? 'default' : 'primary'}
          disabled={busy || (!enabled && !canEnable)}
          onClick={() => onToggle(!enabled)}
        >
          {enabled ? p.disable : p.enable}
        </Button>
        <span className={styles.muted}>{p.withPassword(activeWithPassword)}</span>
      </div>
      {!enabled && !canEnable && <p className={styles.muted}>{p.cannotEnable}</p>}
    </section>
  );
}

function UserLine({
  row,
  fresh,
  busy,
  reveal,
  onGenerate,
  onEdit,
  onToggle,
}: {
  row: UserRow;
  fresh: string | undefined;
  busy: boolean;
  reveal: (id: number) => Promise<string | { error: string } | null>;
  onGenerate: (row: UserRow) => void;
  onEdit: (i: StaffItem) => void;
  onToggle: (i: StaffItem) => void;
}) {
  const { account, member, name } = row;
  const when = formatWhen(account?.lastLoginAt ?? member?.lastLoginAt);
  const teamRole = account?.teamRole ?? member?.teamRole ?? null;
  const disabled = account?.status === 'disabled';
  const hasPassword = fresh !== undefined || (account?.hasPassword ?? false);
  return (
    <tr className={u.row}>
      <td data-label={t.cols.name} className={u.name}>
        <div>
          {name}
          {account && <p className={u.sub}>{account.personName ? t.personLinked(account.personName) : t.personNone}</p>}
          {teamRole && <p className={u.sub}>{t.teamRole(teamRole)}</p>}
        </div>
      </td>
      <td data-label={t.cols.login} className={`${u.login} ${u.nowrap}`}>
        {account?.login ?? <span className={styles.muted}>{t.noLogin}</span>}
      </td>
      <td data-label={t.cols.role}>
        <div>
          {account ? <span className={u.nowrap}>{t.roles[account.role]}</span> : <span className={styles.muted}>{t.noAccount}</span>}
          {disabled && (
            <p>
              <Pill tone="plain">{t.statuses.disabled}</Pill>
            </p>
          )}
        </div>
      </td>
      <td data-label={t.cols.password}>
        {account ? (
          // Ключ — выданный пароль: новый сбрасывает открытый прежний.
          <PasswordCell
            key={fresh ?? 'saved'}
            name={name}
            fresh={fresh}
            hasPassword={account.hasPassword}
            viewable={account.passwordViewable}
            reveal={() => reveal(account.id)}
          />
        ) : (
          <Pill tone="plain">{t.password.none}</Pill>
        )}
      </td>
      <td data-label={t.cols.lastLogin} className={`${u.when} ${u.nowrap}`}>
        {when || t.neverLoggedIn}
      </td>
      <td data-label={t.cols.actions} className={u.actionsCell}>
        <div className={u.actions}>
          {hasPassword ? (
            <Button aria-label={t.regenerateAria(name)} disabled={busy || disabled} onClick={() => onGenerate(row)}>
              {t.regenerate}
            </Button>
          ) : (
            <Button variant="primary" aria-label={t.generateAria(name)} disabled={busy || disabled} onClick={() => onGenerate(row)}>
              {t.generate}
            </Button>
          )}
          {account && (
            <>
              <Button aria-label={t.editAria(name)} disabled={busy} onClick={() => onEdit(account)}>
                {t.edit}
              </Button>
              <Button aria-label={disabled ? t.enableAria(name) : t.disableAria(name)} disabled={busy} onClick={() => onToggle(account)}>
                {disabled ? t.enableAction : t.disableAction}
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function StaffBody({ data }: { data: SettingsStaffView }) {
  const actions = useStaffActions();
  const { busy, run } = useSingleFlight();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Пароли, выданные на этом экране, по id учётной записи: видны сразу, без «глазика». */
  const [issued, setIssued] = useState<Record<number, string>>({});
  const listId = useId();
  const rows = userRows(data);
  // Роли в команде правятся из окна пользователя, если запись — участник команды: нужны справочник ролей и его роли.
  const teamRoles = useSettingsTeamRoles();
  const coordinators = useCoordinators();
  const teamChoice: TeamRolesChoice | undefined = teamRoles.data
    ? { options: teamRoles.data.items.map((r) => ({ id: r.id, name: r.name, meaning: ru.settings.teamRoles.meaning[r.kind ?? 'none'] })) }
    : undefined;
  const teamRoleIdsOf = (item: StaffItem): number[] | null =>
    item.coordinatorId === null ? null : (coordinators.data?.items.find((c) => c.id === item.coordinatorId)?.roleIds ?? null);

  function remember(r: GeneratePasswordOk) {
    setIssued((prev) => ({ ...prev, [r.id]: r.password }));
  }

  async function generate(row: UserRow): Promise<string | null> {
    setNotice(null);
    const body = row.account ? { staffId: row.account.id } : { coordinatorId: row.member!.coordinatorId };
    const r = await run(() => actions.generatePassword(body));
    if (!r) return null;
    if ('error' in r) return r.error;
    remember(r.value);
    setDialog(null);
    setNotice({ kind: 'ok', text: t.issued(row.name, r.value.login) });
    return null;
  }

  async function startGenerate(row: UserRow) {
    // Новый пароль тому, у кого он уже есть, — после подтверждения: прежний перестанет работать.
    if (row.account?.hasPassword || (row.account && issued[row.account.id])) return setDialog({ kind: 'regenerate', row });
    const error = await generate(row);
    if (error) setNotice({ kind: 'error', text: error });
  }

  async function reveal(id: number): Promise<string | { error: string } | null> {
    const r = await run(() => actions.reveal({ id }));
    if (!r) return null;
    return 'error' in r ? { error: r.error } : r.value.password;
  }

  async function create(values: StaffFormValues): Promise<string | null> {
    const body: CreateStaffBody = { fullName: values.fullName, role: values.role, generatePassword: true };
    if (values.email) body.email = values.email;
    if (values.login) body.login = values.login;
    if (values.personKey) body.personKey = values.personKey;
    setNotice(null);
    const r = await run(() => actions.create(body));
    if (!r) return null;
    if ('error' in r) return r.error;
    remember(r.value);
    setDialog(null);
    setNotice({ kind: 'ok', text: t.created(values.fullName, r.value.login) });
    return null;
  }

  async function edit(item: StaffItem, values: StaffFormValues, teamRoleIds: number[] | null): Promise<string | null> {
    // Отправляем только изменённое: чужие поля сервер не трогаем и не затираем устаревшими.
    const body: UpdateStaffBody = { id: item.id };
    if (values.fullName !== item.fullName) body.fullName = values.fullName;
    if (values.email !== (item.email ?? '')) body.email = values.email;
    if (values.role !== item.role) body.role = values.role;
    if (values.personKey !== (item.personKey ?? '')) body.personKey = values.personKey || null;
    const before = teamRoleIds ?? [];
    const teamChanged = item.coordinatorId !== null && teamRoleIds !== null && !sameIds(values.teamRoleIds, before);
    setNotice(null);
    const r = await run(async () => {
      if (Object.keys(body).length > 1) await actions.update(body);
      if (teamChanged) await actions.setTeamRoles(item.coordinatorId!, values.teamRoleIds);
    });
    if (!r) return null;
    if ('error' in r) return r.error;
    setDialog(null);
    setNotice({ kind: 'ok', text: t.updated });
    return null;
  }

  async function toggleActive(item: StaffItem): Promise<string | null> {
    const enable = item.status === 'disabled';
    setNotice(null);
    const r = await run(() => actions.update({ id: item.id, active: enable }));
    if (!r) return null;
    if ('error' in r) return r.error;
    setDialog(null);
    setNotice({ kind: 'ok', text: enable ? t.enabledDone : t.disabledDone });
    return null;
  }

  async function setPersonal(enable: boolean): Promise<string | null> {
    setNotice(null);
    const r = await run(() => actions.setPersonalMode({ enabled: enable }));
    if (!r) return null;
    if ('error' in r) return r.error;
    setDialog(null);
    setNotice({ kind: 'ok', text: enable ? t.personal.enabledDone : t.personal.disabledDone });
    return null;
  }

  const close = () => setDialog(null);

  return (
    <>
      <PersonalLogins data={data.personal} busy={busy} onToggle={(enable) => setDialog({ kind: 'personal', enable })} />

      <section aria-labelledby={listId}>
        <div className={u.listHead}>
          <h3 id={listId} className={u.listTitle}>
            {t.listLabel}
          </h3>
          <Button variant="primary" disabled={busy} onClick={() => setDialog({ kind: 'add' })}>
            {t.add}
          </Button>
        </div>
        <p className={`${styles.muted} ${u.listLead}`}>{t.lead}</p>
        <RolesGuide />

        {notice && (
          <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
            {notice.text}
          </p>
        )}

        {rows.length ? (
          <div className={u.wrap}>
            <table className={u.table} aria-labelledby={listId}>
              <thead>
                <tr>
                  <th scope="col">{t.cols.name}</th>
                  <th scope="col">{t.cols.login}</th>
                  <th scope="col">{t.cols.role}</th>
                  <th scope="col">{t.cols.password}</th>
                  <th scope="col">{t.cols.lastLogin}</th>
                  <th scope="col">{t.cols.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <UserLine
                    key={row.key}
                    row={row}
                    fresh={row.account ? issued[row.account.id] : undefined}
                    busy={busy}
                    reveal={reveal}
                    onGenerate={(r) => void startGenerate(r)}
                    onEdit={(i) => setDialog({ kind: 'edit', item: i })}
                    onToggle={(i) => setDialog({ kind: 'toggle', item: i })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState hint={t.emptyHint}>{t.empty}</EmptyState>
        )}
      </section>

      {dialog?.kind === 'add' && (
        <StaffFormDialog
          title={t.addTitle}
          submitLabel={t.create}
          submittingLabel={t.creating}
          initial={{ fullName: '', email: '', role: 'admin', login: '', personKey: '', teamRoleIds: [] }}
          suggest={async (fullName) => {
            try {
              return (await actions.suggest({ fullName })).login;
            } catch {
              return null;
            }
          }}
          busy={busy}
          onSubmit={create}
          onClose={close}
        />
      )}
      {dialog?.kind === 'edit' && (
        <StaffFormDialog
          title={t.editTitle(dialog.item.fullName)}
          submitLabel={t.save}
          submittingLabel={t.saving}
          initial={toFormValues(dialog.item, teamRoleIdsOf(dialog.item) ?? [])}
          fixedLogin={dialog.item.login}
          {...(teamRoleIdsOf(dialog.item) !== null && teamChoice ? { teamRoles: teamChoice } : {})}
          busy={busy}
          onSubmit={(values) => edit(dialog.item, values, teamRoleIdsOf(dialog.item))}
          onClose={close}
        />
      )}
      {dialog?.kind === 'regenerate' && (
        <ConfirmDialog
          title={t.confirmTitle(dialog.row.name)}
          text={t.confirmText}
          confirmLabel={t.confirm}
          busy={busy}
          onConfirm={() => generate(dialog.row)}
          onClose={close}
        />
      )}
      {dialog?.kind === 'toggle' &&
        (dialog.item.status === 'disabled' ? (
          <ConfirmDialog
            title={t.enableTitle(dialog.item.fullName)}
            text={t.enableText}
            confirmLabel={t.confirmEnable}
            busy={busy}
            onConfirm={() => toggleActive(dialog.item)}
            onClose={close}
          />
        ) : (
          <ConfirmDialog
            title={t.disableTitle(dialog.item.fullName)}
            text={t.disableText}
            confirmLabel={t.confirmDisable}
            busy={busy}
            onConfirm={() => toggleActive(dialog.item)}
            onClose={close}
          />
        ))}
      {dialog?.kind === 'personal' && (
        <ConfirmDialog
          title={dialog.enable ? t.personal.confirmEnableTitle : t.personal.confirmDisableTitle}
          text={dialog.enable ? t.personal.confirmEnableText : t.personal.confirmDisableText}
          confirmLabel={dialog.enable ? t.personal.enable : t.personal.disable}
          busy={busy}
          onConfirm={() => setPersonal(dialog.enable)}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * Раздел «Пользователи и роли»: личные входы и один список — кто входит, к чьей карточке в «Людях» привязан, какой у
 * него уровень входа и роль в команде, его пароль («глазик») и кнопка нового пароля. Пароль выдаётся сразу, без ссылок:
 * администратор передаёт его человеку сам. Видит только полный вход.
 */
export function UsersSection() {
  const query = useSettingsStaff();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={t.title}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <StaffBody data={data} />}</QueryBoundary>
    </section>
  );
}
