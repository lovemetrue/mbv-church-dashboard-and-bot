import { useId, useRef, useState } from 'react';
import type { PromptAgent, PromptBlock, PromptVersion, SavePromptBody } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, EmptyState, Modal, Pill } from '../../shared/ui';
import { formatWhen, promptErrorText } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { usePromptActions, useSettingsPrompts } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.prompts;

/** Предел из контракта (`SavePromptBody.text`): 1–20000 знаков. */
export const MAX_PROMPT_LENGTH = 20_000;
export const MAX_NOTE_LENGTH = 200;

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

function VersionRow({ v, onActivate }: { v: PromptVersion; onActivate: (v: PromptVersion) => void }) {
  return (
    <li className={styles.version}>
      <div className={styles.versionInfo}>
        <b className="num">{t.version(v.version)}</b>
        {v.active && <Pill tone="ok">{t.active}</Pill>}
        <span className={styles.muted}>
          {[formatWhen(v.at), v.by, v.note].filter(Boolean).join(' · ')}
        </span>
      </div>
      {!v.active && (
        <Button aria-label={t.makeActiveAria(v.version)} onClick={() => onActivate(v)}>
          {t.makeActive}
        </Button>
      )}
    </li>
  );
}

/** Окно подтверждения отката: решение, которое не должно случаться случайным касанием. */
function ConfirmActivate({
  block,
  version,
  hasDraft,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  block: PromptBlock;
  version: PromptVersion;
  hasDraft: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={t.confirmTitle(version.version)} onClose={onClose}>
      <p>{t.confirmText(version.version, block.title)}</p>
      {hasDraft && <p className={styles.muted}>{t.confirmDraft}</p>}
      {error && (
        <p className={styles.noticeError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogFoot}>
        <Button onClick={onClose}>{t.cancel}</Button>
        <Button variant="primary" onClick={onConfirm} disabled={pending}>
          {t.makeActive}
        </Button>
      </div>
    </Modal>
  );
}

function EditableBlock({ agent, block }: { agent: PromptAgent['key']; block: PromptBlock }) {
  const actions = usePromptActions();
  const textId = useId();
  const countId = useId();
  const noteId = useId();
  const noteHintId = useId();

  // Правка живёт отдельно от данных сервера: draft === null — человек не трогал поле, и оно
  // показывает действующий текст. Поэтому перечитывание списка по таймеру не затирает набранное:
  // подменяем текст только в нетронутом поле.
  const [draft, setDraft] = useState<string | null>(null);
  // Какой серверный текст был, когда человек начал править: если он потом изменился, предупреждаем.
  const baseRef = useRef<string>(block.text);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<PromptVersion | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const value = draft ?? block.text;
  const canSave = value.trim() !== '' && value !== block.text && value.length <= MAX_PROMPT_LENGTH && !pending;
  const changedElsewhere = draft !== null && baseRef.current !== block.text;

  const edit = (next: string) => {
    if (draft === null) baseRef.current = block.text;
    setDraft(next);
    setNotice(null);
  };

  async function save() {
    // Два нажатия подряд могут прийти до перерисовки: одного pending мало.
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    const body: SavePromptBody = { agent, block: block.key, text: value };
    if (note.trim()) body.note = note.trim();
    try {
      await actions.save(body);
      setDraft(null);
      setNote('');
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Набранное не стираем: человек исправит и повторит.
      setNotice({ kind: 'error', text: promptErrorText(e) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function activate(v: PromptVersion) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setConfirmError(null);
    try {
      await actions.activate({ agent, block: block.key, version: v.version });
      setConfirm(null);
      setNotice({ kind: 'ok', text: t.activated(v.version) });
    } catch (e) {
      setConfirmError(promptErrorText(e));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <label htmlFor={textId} className={styles.fieldLabel}>
        {t.textLabel}
      </label>
      <textarea
        id={textId}
        className={styles.textarea}
        rows={9}
        value={value}
        maxLength={MAX_PROMPT_LENGTH}
        aria-describedby={countId}
        onChange={(e) => edit(e.target.value)}
      />
      <p id={countId} className={styles.count}>
        {t.count(value.length)}
      </p>
      {changedElsewhere && (
        <p className={styles.noticeWarn} role="status">
          {t.changedElsewhere}
        </p>
      )}

      <label htmlFor={noteId} className={styles.fieldLabel}>
        {t.noteLabel}
      </label>
      <input
        id={noteId}
        type="text"
        className={styles.control}
        value={note}
        maxLength={MAX_NOTE_LENGTH}
        aria-describedby={noteHintId}
        autoComplete="off"
        onChange={(e) => setNote(e.target.value)}
      />
      <p id={noteHintId} className={styles.muted}>
        {t.noteHint}
      </p>

      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      <div className={styles.actionsRow}>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          {pending && !confirm ? t.saving : t.save}
        </Button>
      </div>

      <h5 className={styles.h5}>{t.versions}</h5>
      {block.versions.length ? (
        <ul className={styles.versions} aria-label={t.versions}>
          {block.versions.map((v) => (
            <VersionRow
              key={v.version}
              v={v}
              onActivate={(version) => {
                setConfirmError(null);
                setConfirm(version);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{t.versionsEmpty}</p>
      )}

      {confirm && (
        <ConfirmActivate
          block={block}
          version={confirm}
          hasDraft={draft !== null && draft !== block.text}
          pending={pending}
          error={confirmError}
          onConfirm={() => void activate(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function BlockCard({ agent, block }: { agent: PromptAgent['key']; block: PromptBlock }) {
  const titleId = useId();
  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <div className={styles.blockHead}>
        <h4 id={titleId} className={styles.blockTitle}>
          {block.title}
        </h4>
        {block.isDefault && <Pill>{t.isDefault}</Pill>}
      </div>
      <p className={styles.muted}>{block.purpose}</p>
      {block.editable ? (
        <>
          {block.isDefault && !block.versions.length && <p className={styles.muted}>{t.defaultNote}</p>}
          <EditableBlock agent={agent} block={block} />
        </>
      ) : (
        <>
          <p className={styles.readOnlyNote}>{t.readOnly}</p>
          {/* Прокручиваемый блок получает фокус, чтобы длинный текст читался с клавиатуры. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <pre className={styles.readOnlyText} tabIndex={0}>
            {block.text}
          </pre>
        </>
      )}
    </section>
  );
}

export function PromptsSection() {
  const query = useSettingsPrompts();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.prompts}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>
        {(data) =>
          data.agents.length ? (
            data.agents.map((agent) => (
              <div key={agent.key} className={styles.agent}>
                <h3 className={styles.agentTitle}>{agent.title}</h3>
                <p className={styles.muted}>
                  {t.model(agent.model)}. {t.modelNote}
                </p>
                {agent.blocks.map((block) => (
                  <BlockCard key={block.key} agent={agent.key} block={block} />
                ))}
              </div>
            ))
          ) : (
            <EmptyState>{t.empty}</EmptyState>
          )
        }
      </QueryBoundary>
    </section>
  );
}
