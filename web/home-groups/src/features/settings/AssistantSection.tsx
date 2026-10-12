import { useId, useRef, useState } from 'react';
import type { SettingsAssistantView } from '@contracts';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { LlmConnectionForm } from './LlmConnectionForm';
import { formatWhen } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useAssistantActions, useSettingsAssistant } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.assistant;

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * Переключатель «Помощник включён». Правка живёт отдельно от данных сервера: `draft === null` — человек ничего
 * не трогал, и переключатель показывает то, что действует. Поэтому перечитывание настройки по таймеру не затирает
 * несохранённый выбор (как у настройки бота): подменяется только нетронутый переключатель.
 */
function EnabledForm({ current }: { current: boolean }) {
  const actions = useAssistantActions();
  const [draft, setDraft] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const hintId = useId();

  const value = draft ?? current;
  const canSave = !pending && value !== current;

  async function save() {
    // Два нажатия подряд могут прийти до перерисовки: одного pending мало.
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      await actions.setEnabled(value);
      setDraft(null);
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Выбор не стираем: человек повторит.
      setNotice({ kind: 'error', text: serverText(e, { network: t.errors.network, fallback: t.errors.other }) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <label className={styles.radio}>
        <input
          type="checkbox"
          role="switch"
          checked={value}
          aria-describedby={hintId}
          onChange={() => {
            setDraft(!value);
            setNotice(null);
          }}
        />
        <span>{t.toggle}</span>
      </label>
      <p id={hintId} className={`${styles.muted} ${styles.hintLine}`}>
        {t.toggleHint}
      </p>
      {notice && (
        <p className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      <div className={styles.actionsRow}>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          {pending ? t.saving : t.save}
        </Button>
      </div>
    </>
  );
}

function LastRun({ run }: { run: SettingsAssistantView['lastRun'] }) {
  if (!run) return <p className={styles.muted}>{t.neverRun}</p>;
  return (
    <p>
      {t.lastRun(formatWhen(run.at), run.actor)}
      <br />
      <span className={styles.muted}>{t.lastRunStats(run.asked, run.filled, run.withQuestions, run.proposals)}</span>
    </p>
  );
}

/**
 * «Помощник»: подключение (провайдер, модель, ключ), переключатель, последний запуск и что уходит к модели. Ключ можно
 * ввести, но показать его обратно нельзя: сервер отдаёт лишь последние четыре символа (см. LlmConnectionForm).
 */
export function AssistantSection() {
  const query = useSettingsAssistant();
  const titleId = useId();
  const sentId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.assistant}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>
        {(data) => (
          <div className={styles.block}>
            <LlmConnectionForm llm={data.llm} />
            <div className={styles.stackTop}>
              <EnabledForm current={data.enabled} />
            </div>
            <div className={styles.stackTop}>
              <LastRun run={data.lastRun} />
            </div>
            <div role="group" aria-labelledby={sentId}>
              <h3 id={sentId} className={styles.h5}>
                {t.sentTitle}
              </h3>
              <p>{t.sentText}</p>
              <p className={styles.stackTop}>{t.sentChat}</p>
            </div>
            <p className={`${styles.muted} ${styles.hintBelow}`}>{t.promptsHint}</p>
          </div>
        )}
      </QueryBoundary>
    </section>
  );
}
