import { useCallback, useId, useRef, useState } from 'react';
import type { CreateStaffBody, DeliveryOk, SettingsStaffView, StaffItem, StaffStatus, UpdateStaffBody } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, EmptyState, Pill, type PillTone } from '../../shared/ui';
import { buildLinkUrl, formatWhen, staffErrorText } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useSettingsStaff, useStaffActions } from './queries';
import { ConfirmDialog, LinkDialog, StaffFormDialog, toFormValues, type StaffFormValues } from './StaffDialogs';
import styles from './Settings.module.css';
import u from './Users.module.css';

const t = ru.settings.users;

const STATUS_TONE: Record<StaffStatus, PillTone> = { invited: 'warn', active: 'ok', disabled: 'plain' };

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: StaffItem }
  | { kind: 'toggle'; item: StaffItem }
  | { kind: 'personal'; enable: boolean }
  | { kind: 'link'; name: string; email: string; url: string };

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
  const { enabled, canEnable, activeWithPassword, mailConfigured } = data;
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
      {!mailConfigured && <p className={u.mailHint}>{p.mailMissing}</p>}
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

function StaffRow({
  item,
  busy,
  onReset,
  onInvite,
  onEdit,
  onToggle,
}: {
  item: StaffItem;
  busy: boolean;
  onReset: (i: StaffItem) => void;
  onInvite: (i: StaffItem) => void;
  onEdit: (i: StaffItem) => void;
  onToggle: (i: StaffItem) => void;
}) {
  const when = formatWhen(item.lastLoginAt);
  return (
    <tr className={u.row}>
      <td data-label={t.cols.name} className={u.name}>
        {item.fullName}
      </td>
      <td data-label={t.cols.login} className={`${u.login} ${u.nowrap}`}>
        {item.login}
      </td>
      <td data-label={t.cols.email}>{item.email}</td>
      <td data-label={t.cols.role} className={u.nowrap}>{t.roles[item.role]}</td>
      <td data-label={t.cols.status}>
        {/* Обёртка нужна карточке на телефоне: ячейка там — сетка из подписи и одного значения. */}
        <div>
          <Pill tone={STATUS_TONE[item.status]}>{t.statuses[item.status]}</Pill>
          {item.hasPendingLink ? (
            <p className={u.linkNote}>{t.pendingLink}</p>
          ) : (
            item.status === 'invited' && <p className={u.linkNote}>{t.noPendingLink}</p>
          )}
        </div>
      </td>
      <td data-label={t.cols.lastLogin} className={`${u.when} ${u.nowrap}`}>
        {when || t.neverLoggedIn}
      </td>
      <td data-label={t.cols.actions} className={u.actionsCell}>
        <div className={u.actions}>
          {item.status === 'active' && (
            <Button aria-label={t.resetAria(item.fullName)} disabled={busy} onClick={() => onReset(item)}>
              {t.reset}
            </Button>
          )}
          {item.status === 'invited' && (
            <Button aria-label={t.inviteAria(item.fullName)} disabled={busy} onClick={() => onInvite(item)}>
              {t.invite}
            </Button>
          )}
          <Button aria-label={t.editAria(item.fullName)} disabled={busy} onClick={() => onEdit(item)}>
            {t.edit}
          </Button>
          <Button
            aria-label={item.status === 'disabled' ? t.enableAria(item.fullName) : t.disableAria(item.fullName)}
            disabled={busy}
            onClick={() => onToggle(item)}
          >
            {item.status === 'disabled' ? t.enableAction : t.disableAction}
          </Button>
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
  const listId = useId();

  /** Что сделать после отправки ссылки: письмо ушло — сказать, не ушло — показать ссылку целиком. */
  function showDelivery(d: DeliveryOk, name: string) {
    if (d.delivery === 'link') {
      if (!d.path) {
        setDialog(null);
        setNotice({ kind: 'error', text: t.errors.noLink });
        return;
      }
      setDialog({ kind: 'link', name, email: d.email, url: buildLinkUrl(d.path) });
      return;
    }
    setDialog(null);
    setNotice({ kind: 'ok', text: t.sent(d.email) });
  }

  async function sendLink(kind: 'invite' | 'reset', item: StaffItem) {
    setNotice(null);
    const r = await run(() => actions[kind]({ id: item.id }));
    if (!r) return;
    if ('error' in r) setNotice({ kind: 'error', text: r.error });
    else showDelivery(r.value, item.fullName);
  }

  async function create(values: StaffFormValues): Promise<string | null> {
    const body: CreateStaffBody = { fullName: values.fullName, email: values.email, role: values.role };
    if (values.login) body.login = values.login;
    setNotice(null);
    const r = await run(() => actions.create(body));
    if (!r) return null;
    if ('error' in r) return r.error;
    showDelivery(r.value, values.fullName);
    return null;
  }

  async function edit(item: StaffItem, values: StaffFormValues): Promise<string | null> {
    // Отправляем только изменённое: чужие поля сервер не трогаем и не затираем устаревшими.
    const body: UpdateStaffBody = { id: item.id };
    if (values.fullName !== item.fullName) body.fullName = values.fullName;
    if (values.email !== item.email) body.email = values.email;
    if (values.role !== item.role) body.role = values.role;
    setNotice(null);
    const r = await run(() => actions.update(body));
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

        {notice && (
          <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
            {notice.text}
          </p>
        )}

        {data.items.length ? (
          <div className={u.wrap}>
            <table className={u.table} aria-labelledby={listId}>
              <thead>
                <tr>
                  <th scope="col">{t.cols.name}</th>
                  <th scope="col">{t.cols.login}</th>
                  <th scope="col">{t.cols.email}</th>
                  <th scope="col">{t.cols.role}</th>
                  <th scope="col">{t.cols.status}</th>
                  <th scope="col">{t.cols.lastLogin}</th>
                  <th scope="col">{t.cols.actions}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <StaffRow
                    key={item.id}
                    item={item}
                    busy={busy}
                    onReset={(i) => void sendLink('reset', i)}
                    onInvite={(i) => void sendLink('invite', i)}
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
          initial={{ fullName: '', email: '', role: 'admin', login: '' }}
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
          initial={toFormValues(dialog.item)}
          fixedLogin={dialog.item.login}
          busy={busy}
          onSubmit={(values) => edit(dialog.item, values)}
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
      {dialog?.kind === 'link' && <LinkDialog name={dialog.name} email={dialog.email} url={dialog.url} onClose={close} />}
    </>
  );
}

/**
 * Раздел «Пользователи и роли»: личные входы и список людей с их входами. Видит только полный
 * вход. Самостоятельный модуль: берёт общий клиент API и общие компоненты, больше ничего.
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
