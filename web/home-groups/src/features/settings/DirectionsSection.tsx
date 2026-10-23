import { useId, useRef, useState } from 'react';
import type { GroupDirectionItem } from '@contracts';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useDirectionActions, useSettingsDirections } from './queries';
import styles from './Settings.module.css';
import r from './TeamRoles.module.css';

const t = ru.settings.directions;
const errorText = (e: unknown): string => serverText(e, { network: t.network, fallback: t.fallback });

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * «Направления»: справочник, из которого выбирают направление группы (миграция 052) — основное, подростковое,
 * молодёжное служение и филиалы. Новый филиал добавляют здесь; переименование сразу видно у всех его групп.
 */
export function DirectionsSection() {
  const query = useSettingsDirections();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.directions}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <DirectionsEditor items={data.items} />}</QueryBoundary>
    </section>
  );
}

function DirectionsEditor({ items }: { items: GroupDirectionItem[] }) {
  const actions = useDirectionActions();
  const [notice, setNotice] = useState<Notice>(null);
  // Один запрос за раз: двойное нажатие не должно завести филиал дважды.
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
      <ul className={r.list} aria-label={t.listLabel}>
        {items.map((item) => (
          <DirectionRow
            key={`${item.id}:${item.name}`}
            item={item}
            busy={busy}
            onSave={(name) => run(() => actions.update(item.id, name), t.saved)}
            onRemove={() => run(() => actions.remove(item.id), t.removed)}
          />
        ))}
      </ul>
      <NewDirection busy={busy} onAdd={(name) => run(() => actions.create(name), t.added)} />
      <p role="status" className={notice?.kind === 'error' ? styles.noticeError : notice ? styles.noticeOk : undefined}>
        {notice?.text ?? ''}
      </p>
    </div>
  );
}

function DirectionRow({ item, busy, onSave, onRemove }: {
  item: GroupDirectionItem;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const nameId = useId();
  const [name, setName] = useState(item.name);
  const changed = name.trim() !== item.name;
  const inUse = item.groups > 0;
  return (
    <li className={r.row}>
      <div className={r.field}>
        <label htmlFor={nameId} className={styles.fieldLabel}>{t.name}</label>
        <input id={nameId} className={styles.control} value={name} disabled={busy} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={r.foot}>
        <span className={styles.muted}>{t.groups(item.groups)}</span>
        <span className={r.actions}>
          <Button size="sm" variant="primary" disabled={busy || !changed || !name.trim()} aria-label={t.saveAria(item.name)} onClick={() => void onSave(name.trim())}>
            {t.save}
          </Button>
          {/* Направление с группами не удалить: сервер откажет, поэтому и кнопку не даём нажать, а объясняем почему. */}
          <Button size="sm" variant="ghost" disabled={busy || inUse} aria-label={t.removeAria(item.name)} title={inUse ? t.removeBlocked : undefined} onClick={() => void onRemove()}>
            {t.remove}
          </Button>
        </span>
      </div>
    </li>
  );
}

function NewDirection({ busy, onAdd }: { busy: boolean; onAdd: (name: string) => Promise<boolean> }) {
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  return (
    <form
      className={r.add}
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onAdd(name.trim()).then((ok) => {
          if (ok) setName('');
        });
      }}
    >
      <h3 id={titleId} className={r.addTitle}>{t.addTitle}</h3>
      <div className={r.field}>
        <label htmlFor={nameId} className={styles.fieldLabel}>{t.name}</label>
        <input id={nameId} className={styles.control} value={name} disabled={busy} autoComplete="off" placeholder={t.placeholder} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={r.foot}>
        <span />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t.add}</Button>
      </div>
    </form>
  );
}
