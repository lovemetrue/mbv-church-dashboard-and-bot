import { useId, useRef, useState } from 'react';
import type { MapConfigView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { isInsecurePage, llmErrorText } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useMapActions, useSettingsMap } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.map;

/**
 * Ключ Яндекс.Карт (JS API) для карты групп. Как и остальные ключи: поле закрыто всегда, после сохранения очищается, сервер
 * отдаёт лишь последние четыре символа. Рядом — сколько раз карта открывалась в этом месяце: у бесплатного ключа лимит.
 */
export function MapSection() {
  const query = useSettingsMap();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.map}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <MapForm view={data} />}</QueryBoundary>
    </section>
  );
}

function MapForm({ view }: { view: MapConfigView }) {
  const actions = useMapActions();
  const keyId = useId();
  const stateId = useId();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inFlight = useRef(false);
  const typed = apiKey.trim() !== '';
  const insecure = isInsecurePage();

  async function save() {
    if (!typed || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await actions.save({ apiKey: apiKey.trim() });
      setApiKey('');
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      setNotice({ kind: 'error', text: llmErrorText(e, { network: t.errors.network, forbidden: t.errors.forbidden, other: t.errors.other }) });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function removeKey(): Promise<string | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setRemoving(true);
    try {
      await actions.save({ apiKey: null });
      setRemoveOpen(false);
      setNotice({ kind: 'ok', text: t.removed });
      return null;
    } catch (e) {
      return llmErrorText(e, { network: t.errors.network, forbidden: t.errors.forbidden, other: t.errors.other });
    } finally {
      inFlight.current = false;
      setRemoving(false);
    }
  }

  return (
    <div className={styles.block}>
      <p>{t.intro}</p>
      {!view.keySet && !view.keyUnreadable && <p className={styles.muted}>{t.keyMissing}</p>}
      <fieldset className={styles.plainFieldset} disabled={saving}>
        <label htmlFor={keyId} className={styles.fieldLabel}>
          {t.keyLabel}
        </label>
        <input
          id={keyId}
          type="password"
          className={styles.control}
          value={apiKey}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          aria-describedby={!typed && (view.keySet || view.keyUnreadable) ? stateId : undefined}
          onChange={(e) => {
            setApiKey(e.target.value);
            setNotice(null);
          }}
        />
      </fieldset>
      {!typed && view.keyUnreadable && (
        <p id={stateId} className={styles.noticeError} role="alert">
          {t.keyUnreadable}
        </p>
      )}
      {!typed && view.keySet && (
        <p id={stateId} className={`${styles.muted} ${styles.hintLine}`}>
          {t.keySaved(view.keyHint)}
        </p>
      )}
      {insecure && (
        <p className={styles.noticeWarn} role="note">
          {ru.settings.assistant.conn.insecurePage}
        </p>
      )}
      {(view.keySet || view.keyUnreadable) && (
        <div className={styles.actionsRow}>
          <Button variant="ghost" onClick={() => setRemoveOpen(true)} disabled={removing}>
            {t.removeKey}
          </Button>
        </div>
      )}
      <div className={styles.actionsRow}>
        <Button variant="primary" onClick={() => void save()} disabled={!typed || saving || removing}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      <p className={`${styles.muted} ${styles.hintBelow}`}>{t.usage(view.loadsThisMonth, view.monthlyLimit)}</p>
      {removeOpen && <RemoveDialog busy={removing} onConfirm={removeKey} onClose={() => !removing && setRemoveOpen(false)} />}
    </div>
  );
}

function RemoveDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t.removeTitle} onClose={onClose}>
      <p>{t.removeText}</p>
      {error && (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      )}
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
          {busy ? t.removing : t.removeConfirm}
        </Button>
      </div>
    </Modal>
  );
}
