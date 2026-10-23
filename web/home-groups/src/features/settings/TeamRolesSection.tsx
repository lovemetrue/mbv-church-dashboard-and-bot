import { useId, useRef, useState } from 'react';
import type { TeamRoleItem, TeamRoleKind } from '@contracts';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useSettingsTeamRoles, useTeamRoleActions } from './queries';
import styles from './Settings.module.css';
import r from './TeamRoles.module.css';

const t = ru.settings.teamRoles;
const KINDS: readonly (TeamRoleKind | '')[] = ['', 'catalyst', 'senior_distributor', 'distributor', 'senior', 'coordinator'];
const kindLabel = (k: TeamRoleKind | ''): string => (k === '' ? t.kinds.none : t.kinds[k]);
const errorText = (e: unknown): string => serverText(e, { network: t.network, fallback: t.fallback });

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * «Роли команды»: справочник, из которого выбирают роль координатора (миграция 049). Смысл роли решает отборы после
 * личного входа и автоназначение заявок, поэтому он задаётся здесь явно, а не угадывается по словам в названии.
 */
export function TeamRolesSection() {
  const query = useSettingsTeamRoles();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.teamRoles}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <RolesEditor items={data.items} />}</QueryBoundary>
    </section>
  );
}

function RolesEditor({ items }: { items: TeamRoleItem[] }) {
  const actions = useTeamRoleActions();
  const [notice, setNotice] = useState<Notice>(null);
  // Один запрос за раз: двойное нажатие не должно завести роль дважды.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  async function run(job: () => Promise<void>, ok: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await job();
      setNotice({ kind: 'ok', text: ok });
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e) });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.block}>
      <p>{t.intro}</p>
      <ul className={r.help}>
        {t.kindsHelp.map(([kind, meaning]) => (
          <li key={kind}>
            <b>{kind}</b> — {meaning}
          </li>
        ))}
      </ul>
      <ul className={r.list} aria-label={t.listLabel}>
        {items.map((item) => (
          <RoleRow
            key={`${item.id}:${item.name}:${item.kind ?? ''}`}
            item={item}
            busy={busy}
            onSave={(name, kind) => run(() => actions.update({ id: item.id, name, kind }), t.saved)}
            onRemove={() => run(() => actions.remove(item.id), t.removed)}
          />
        ))}
      </ul>
      <NewRole busy={busy} onAdd={(name, kind) => run(() => actions.create({ name, kind }), t.added)} />
      <p role="status" className={notice?.kind === 'error' ? styles.noticeError : notice ? styles.noticeOk : undefined}>
        {notice?.text ?? ''}
      </p>
    </div>
  );
}

function KindSelect({ id, value, onChange, disabled }: { id: string; value: TeamRoleKind | ''; onChange: (v: TeamRoleKind | '') => void; disabled: boolean }) {
  return (
    <select id={id} className={styles.control} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as TeamRoleKind | '')}>
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {kindLabel(k)}
        </option>
      ))}
    </select>
  );
}

function RoleRow({ item, busy, onSave, onRemove }: {
  item: TeamRoleItem;
  busy: boolean;
  onSave: (name: string, kind: TeamRoleKind | null) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const nameId = useId();
  const kindId = useId();
  const [name, setName] = useState(item.name);
  const [kind, setKind] = useState<TeamRoleKind | ''>(item.kind ?? '');
  const changed = name.trim() !== item.name || kind !== (item.kind ?? '');
  const inUse = item.members > 0;
  return (
    <li className={r.row}>
      <div className={r.fields}>
        <div className={r.field}>
          <label htmlFor={nameId} className={styles.fieldLabel}>{t.name}</label>
          <input id={nameId} className={styles.control} value={name} disabled={busy} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={r.field}>
          <label htmlFor={kindId} className={styles.fieldLabel}>{t.kind}</label>
          <KindSelect id={kindId} value={kind} disabled={busy} onChange={setKind} />
        </div>
      </div>
      <div className={r.foot}>
        <span className={styles.muted}>{t.members(item.members)}</span>
        <span className={r.actions}>
          <Button size="sm" variant="primary" disabled={busy || !changed || !name.trim()} aria-label={t.saveAria(item.name)} onClick={() => void onSave(name.trim(), kind || null)}>
            {t.save}
          </Button>
          {/* Роль с людьми не удалить: сервер откажет, поэтому и кнопку не даём нажать, а объясняем почему. */}
          <Button size="sm" variant="ghost" disabled={busy || inUse} aria-label={t.removeAria(item.name)} title={inUse ? t.removeBlocked : undefined} onClick={() => void onRemove()}>
            {t.remove}
          </Button>
        </span>
      </div>
    </li>
  );
}

function NewRole({ busy, onAdd }: { busy: boolean; onAdd: (name: string, kind: TeamRoleKind | null) => Promise<boolean> }) {
  const titleId = useId();
  const nameId = useId();
  const kindId = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TeamRoleKind | ''>('');
  return (
    <form
      className={r.add}
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onAdd(name.trim(), kind || null).then((ok) => {
          if (!ok) return;
          setName('');
          setKind('');
        });
      }}
    >
      <h3 id={titleId} className={r.addTitle}>{t.addTitle}</h3>
      <div className={r.fields}>
        <div className={r.field}>
          <label htmlFor={nameId} className={styles.fieldLabel}>{t.name}</label>
          <input id={nameId} className={styles.control} value={name} disabled={busy} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={r.field}>
          <label htmlFor={kindId} className={styles.fieldLabel}>{t.kind}</label>
          <KindSelect id={kindId} value={kind} disabled={busy} onChange={setKind} />
        </div>
      </div>
      <div className={r.foot}>
        <span />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t.add}</Button>
      </div>
    </form>
  );
}
