import { useId, useRef, useState } from 'react';
import type { GeocoderConfigView, GeocoderTestResult } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { isInsecurePage, llmErrorText } from './model';
import { AddressesModal } from './AddressesModal';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useGeocoderActions, useSettingsGeocoder } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.geocoder;
const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

type Notice = { kind: 'ok' | 'error'; text: string };
type Outcome = { kind: 'result'; result: GeocoderTestResult } | { kind: 'error'; text: string };

/**
 * Ключ Яндекс.Геокодера: можно ввести, проверить и убрать; показать обратно нельзя (сервер отдаёт лишь последние четыре
 * символа). Как и у ключа помощника, поле закрыто всегда, а после сохранения очищается: ключ не остаётся ни в состоянии,
 * ни в кэше запросов, ни в хранилище браузера.
 */
export function GeocoderSection() {
  const query = useSettingsGeocoder();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.geocoder}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>{(data) => <GeocoderForm view={data} />}</QueryBoundary>
    </section>
  );
}

function GeocoderForm({ view }: { view: GeocoderConfigView }) {
  const actions = useGeocoderActions();
  const keyId = useId();
  const keyStateId = useId();
  const insecureId = useId();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const testInFlight = useRef(false);
  const version = useRef(0);

  const typed = apiKey.trim() !== '';
  const canSave = typed && !saving && !removing;
  const canTest = (typed || view.keySet) && !testing;
  const insecure = isInsecurePage();

  const stateLine = view.keyUnreadable ? null : view.keySource === 'settings' ? t.keyInSettings(view.keyHint) : view.keySource === 'env' ? t.keyInEnv(view.keyHint) : null;
  const describedBy = [!typed && (stateLine || view.keyUnreadable) ? keyStateId : '', insecure ? insecureId : ''].filter(Boolean).join(' ');

  function edit(value: string) {
    version.current += 1;
    setApiKey(value);
    setNotice(null);
    setOutcome(null);
  }

  async function check() {
    if (!canTest || testInFlight.current) return;
    testInFlight.current = true;
    setTesting(true);
    setOutcome(null);
    const v = version.current;
    try {
      const result = await actions.test(typed ? { apiKey: apiKey.trim() } : {});
      if (v === version.current) setOutcome({ kind: 'result', result });
    } catch (e) {
      const text = llmErrorText(e, { network: t.errors.networkTest, forbidden: t.errors.forbiddenTest, other: t.errors.otherTest });
      if (v === version.current) setOutcome({ kind: 'error', text });
    } finally {
      testInFlight.current = false;
      setTesting(false);
    }
  }

  async function save() {
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await actions.save({ apiKey: apiKey.trim() });
      setApiKey('');
      setOutcome(null);
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Набранный ключ не стираем: человек исправит и повторит.
      setNotice({ kind: 'error', text: llmErrorText(e, { network: t.errors.networkSave, forbidden: t.errors.forbidden, other: t.errors.other }) });
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
      return llmErrorText(e, { network: t.errors.networkRemove, forbidden: t.errors.forbidden, other: t.errors.other });
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
        {/* Без name и с new-password: менеджеры паролей и автозаполнение не должны ни подставлять, ни запоминать ключ. */}
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
          aria-describedby={describedBy || undefined}
          onChange={(e) => edit(e.target.value)}
        />
      </fieldset>
      {!typed && view.keyUnreadable && (
        <p id={keyStateId} className={styles.noticeError} role="alert">
          {t.keyUnreadable}
        </p>
      )}
      {!typed && stateLine && (
        <p id={keyStateId} className={`${styles.muted} ${styles.hintLine}`}>
          {stateLine}
        </p>
      )}
      {insecure && (
        <p id={insecureId} className={styles.noticeWarn} role="note">
          {ru.settings.assistant.conn.insecurePage}
        </p>
      )}
      {(view.keySource === 'settings' || view.keyUnreadable) && (
        <div className={styles.actionsRow}>
          <Button variant="ghost" onClick={() => setRemoveOpen(true)} disabled={removing}>
            {t.removeKey}
          </Button>
        </div>
      )}

      <div className={styles.actionsRow}>
        <Button onClick={() => void check()} disabled={!canTest}>
          {testing ? t.testing : t.test}
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          {saving ? t.saving : t.save}
        </Button>
      </div>

      {outcome?.kind === 'result' && outcome.result.ok && (
        <p className={styles.noticeOk} role="status">
          {t.testOk(seconds(outcome.result.ms))}
        </p>
      )}
      {outcome?.kind === 'result' && !outcome.result.ok && (
        <p className={styles.noticeError} role="alert">
          {outcome.result.message}
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p className={styles.noticeError} role="alert">
          {outcome.text}
        </p>
      )}
      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}

      <div role="group" aria-label={t.addressesTitle} className={styles.stackTop}>
        <h3 className={styles.h5}>{t.addressesTitle}</h3>
        <p>{t.addresses(view.addresses)}</p>
        <p className={`${styles.muted} ${styles.hintLine}`}>{t.addressesHint}</p>
        <div className={styles.actionsRow}>
          <Button onClick={() => setTableOpen(true)}>{t.openTable}</Button>
        </div>
        {view.addresses.waiting === 0 && view.addresses.found > 0 && <p className={styles.noticeOk}>{t.rerunHint}</p>}
      </div>
      <p className={`${styles.muted} ${styles.hintBelow}`}>{t.usage(view.usedToday, view.dailyLimit)}</p>
      <p className={`${styles.muted} ${styles.hintLine}`}>{t.privacy}</p>

      {tableOpen && <AddressesModal onClose={() => setTableOpen(false)} />}
      {removeOpen && <RemoveKeyDialog busy={removing} onConfirm={removeKey} onClose={() => !removing && setRemoveOpen(false)} />}
    </div>
  );
}

function RemoveKeyDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => Promise<string | null>; onClose: () => void }) {
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
