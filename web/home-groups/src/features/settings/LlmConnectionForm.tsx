import { useId, useRef, useState } from 'react';
import type { LlmConfigBody, LlmConfigView, LlmTestResult } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { isInsecurePage, llmErrorText } from './model';
import { useAssistantActions } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.assistant.conn;

type ProviderId = LlmConfigView['provider'];

interface Draft {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  /** Модель вписана человеком, а не подставлена при выборе провайдера: при смене провайдера её не трогаем. */
  modelManual: boolean;
}

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

type Outcome = { kind: 'result'; result: LlmTestResult } | { kind: 'error'; text: string };

/** «Другой» провайдер — тот, у которого нет готового адреса: его вводит человек. */
function needsBaseUrl(providers: LlmConfigView['providers'], id: ProviderId): boolean {
  const found = providers.find((p) => p.id === id);
  return found ? found.baseUrl === null : id === 'custom';
}

/** Секунды с одним знаком после запятой: «0,8». */
const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

/**
 * Подключение помощника: провайдер, модель и ключ. Правка живёт отдельно от данных сервера: `draft === null` — человек
 * ничего не трогал, и форма показывает действующее подключение. Поэтому перечитывание настройки по таймеру не затирает
 * набранное, в том числе ключ в поле.
 *
 * Ключ в поле закрыт всегда, кнопки «показать» нет (так решил заказчик), а после сохранения поле очищается: введённый
 * ключ не остаётся ни в состоянии, ни в кэше запросов, ни в хранилище браузера. Сервер отдаёт лишь последние четыре символа.
 */
export function LlmConnectionForm({ llm }: { llm: LlmConfigView }) {
  const actions = useAssistantActions();
  const titleId = useId();
  const providerId = useId();
  const noteId = useId();
  const modelId = useId();
  const modelHintId = useId();
  const listId = useId();
  const urlId = useId();
  const keyId = useId();
  const keyStateId = useId();
  const insecureId = useId();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Два нажатия подряд могут прийти до перерисовки: одного состояния мало.
  const saveInFlight = useRef(false);
  const testInFlight = useRef(false);
  // Номер правки: ответ проверки про старые значения не показываем, если форму успели изменить.
  const editVersion = useRef(0);

  const { providers } = llm;
  const base: Draft = { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl ?? '', apiKey: '', modelManual: false };
  const value = draft ?? base;
  const option = providers.find((p) => p.id === value.provider);
  const custom = needsBaseUrl(providers, value.provider);
  const model = value.model.trim();
  const url = value.baseUrl.trim();
  const keyTyped = value.apiKey.trim() !== '';
  const complete = model !== '' && (!custom || url !== '');
  const changed = value.provider !== llm.provider || model !== llm.model || (custom && url !== (llm.baseUrl ?? '').trim());
  const canSave = !saving && !removing && complete && (changed || keyTyped);
  const canTest = !testing && complete;
  const insecure = isInsecurePage();

  const edit = (patch: Partial<Draft>) => {
    editVersion.current += 1;
    setDraft({ ...value, ...patch });
    setNotice(null);
    setOutcome(null);
  };

  function pickProvider(id: ProviderId) {
    const next = providers.find((p) => p.id === id);
    let nextModel = value.model;
    let manual = value.modelManual;
    // Модель другого провайдера у нового не заработает: подставляем его модель по умолчанию, если пусто или это не вписанное вручную.
    if (next?.defaultModel && (nextModel.trim() === '' || (!next.models.includes(nextModel.trim()) && !manual))) {
      nextModel = next.defaultModel;
      manual = false;
    }
    edit({ provider: id, model: nextModel, modelManual: manual });
  }

  /** Тело запроса. Ключ — только если человек его ввёл: иначе поле не передаётся и сервер оставляет прежний. */
  function body(): LlmConfigBody {
    return {
      provider: value.provider,
      model,
      ...(custom ? { baseUrl: url } : {}),
      ...(keyTyped ? { apiKey: value.apiKey.trim() } : {}),
    };
  }

  async function check() {
    if (!canTest || testInFlight.current) return;
    testInFlight.current = true;
    setTesting(true);
    setOutcome(null);
    const version = editVersion.current;
    const sent = body();
    try {
      const result = await actions.testLlm(sent);
      if (version === editVersion.current) setOutcome({ kind: 'result', result });
    } catch (e) {
      const text = llmErrorText(e, { network: t.errors.networkTest, forbidden: t.errors.forbiddenTest, other: t.errors.otherTest });
      if (version === editVersion.current) setOutcome({ kind: 'error', text });
    } finally {
      testInFlight.current = false;
      setTesting(false);
    }
  }

  async function save() {
    if (!canSave || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setNotice(null);
    try {
      await actions.saveLlm(body());
      // Черновик вместе с ключом исчезает: дальше форма показывает то, что сохранено на сервере.
      setDraft(null);
      setOutcome(null);
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Набранное, и ключ в том числе, не стираем: человек исправит и повторит.
      setNotice({ kind: 'error', text: llmErrorText(e, { network: t.errors.networkSave, forbidden: t.errors.forbidden, other: t.errors.other }) });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  /** Убирает сохранённый ключ, не трогая остальное: уходят действующие провайдер и модель, а не несохранённая правка. */
  async function removeKey(): Promise<string | null> {
    if (saveInFlight.current) return null;
    saveInFlight.current = true;
    setRemoving(true);
    try {
      const acting = needsBaseUrl(providers, llm.provider);
      await actions.saveLlm({ provider: llm.provider, model: llm.model, ...(acting ? { baseUrl: llm.baseUrl ?? '' } : {}), apiKey: null });
      setRemoveOpen(false);
      setNotice({ kind: 'ok', text: t.removed });
      return null;
    } catch (e) {
      return llmErrorText(e, { network: t.errors.networkRemove, forbidden: t.errors.forbidden, other: t.errors.other });
    } finally {
      saveInFlight.current = false;
      setRemoving(false);
    }
  }

  const keyStateLine = llm.keyUnreadable
    ? null
    : llm.keySource === 'settings'
      ? t.keyInSettings(llm.keyHint)
      : llm.keySource === 'env'
        ? t.keyInEnv(llm.keyHint)
        : null;
  const keyDescribedBy = [!keyTyped && (keyStateLine || llm.keyUnreadable) ? keyStateId : '', insecure ? insecureId : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.h5}>
        {t.title}
      </h3>
      {!llm.keySet && !llm.keyUnreadable && <p className={styles.muted}>{t.keyMissing}</p>}

      <fieldset className={styles.plainFieldset} disabled={saving}>
        <label htmlFor={providerId} className={styles.fieldLabel}>
          {t.providerLabel}
        </label>
        <select
          id={providerId}
          className={styles.control}
          value={value.provider}
          aria-describedby={option ? noteId : undefined}
          onChange={(e) => pickProvider(e.target.value as ProviderId)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {option && (
          <p id={noteId} className={`${styles.muted} ${styles.hintLine}`}>
            {option.note}
          </p>
        )}

        <label htmlFor={modelId} className={styles.fieldLabel}>
          {t.modelLabel}
        </label>
        <input
          id={modelId}
          type="text"
          className={styles.control}
          list={listId}
          value={value.model}
          aria-describedby={modelHintId}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => edit({ model: e.target.value, modelManual: true })}
        />
        <datalist id={listId}>
          {(option?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p id={modelHintId} className={`${styles.muted} ${styles.hintLine}`}>
          {t.modelHint}
        </p>

        {custom && (
          <>
            <label htmlFor={urlId} className={styles.fieldLabel}>
              {t.baseUrlLabel}
            </label>
            <input
              id={urlId}
              type="url"
              className={styles.control}
              value={value.baseUrl}
              placeholder={t.baseUrlPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => edit({ baseUrl: e.target.value })}
            />
          </>
        )}

        <label htmlFor={keyId} className={styles.fieldLabel}>
          {t.keyLabel}
        </label>
        {/* Без name и с new-password: менеджеры паролей и автозаполнение не должны ни подставлять, ни запоминать ключ. */}
        <input
          id={keyId}
          type="password"
          className={styles.control}
          value={value.apiKey}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          aria-describedby={keyDescribedBy || undefined}
          onChange={(e) => edit({ apiKey: e.target.value })}
        />
      </fieldset>

      {!keyTyped && llm.keyUnreadable && (
        <p id={keyStateId} className={styles.noticeError} role="alert">
          {t.keyUnreadable}
        </p>
      )}
      {!keyTyped && keyStateLine && (
        <p id={keyStateId} className={`${styles.muted} ${styles.hintLine}`}>
          {keyStateLine}
        </p>
      )}
      {insecure && (
        <p id={insecureId} className={styles.noticeWarn} role="note">
          {t.insecurePage}
        </p>
      )}
      {(llm.keySource === 'settings' || llm.keyUnreadable) && (
        <div className={styles.actionsRow}>
          <Button variant="ghost" onClick={() => setRemoveOpen(true)} disabled={removing}>
            {t.removeKey}
          </Button>
        </div>
      )}

      {value.provider !== llm.provider && (
        <p className={styles.noticeWarn} role="note">
          {t.providerChange}
        </p>
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
          {t.testOk(outcome.result.provider, outcome.result.model, seconds(outcome.result.ms))}
        </p>
      )}
      {outcome?.kind === 'result' && !outcome.result.ok && (
        <div className={styles.noticeError} role="alert">
          {outcome.result.message}
          {outcome.result.detail && <span className={styles.noticeSub}>{t.testDetail(outcome.result.detail)}</span>}
          {outcome.result.status !== undefined && <span className={styles.noticeSub}>{t.testStatus(outcome.result.status)}</span>}
        </div>
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
