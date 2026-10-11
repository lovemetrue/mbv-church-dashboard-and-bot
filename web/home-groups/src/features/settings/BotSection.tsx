import { useId, useRef, useState } from 'react';
import type { SettingsBotView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { botErrorText, hasBotIds } from './model';
import { QueryBoundary } from './QueryBoundary';
import { RefreshButton } from './RefreshButton';
import { SectionHead } from './SectionHead';
import { useBotActions, useSettingsBot } from './queries';
import styles from './Settings.module.css';

const t = ru.settings.bot;

type Mode = SettingsBotView['extraQuestions']['mode'];
const MODES: readonly Mode[] = ['off', 'all', 'list'];

interface Draft {
  mode: Mode;
  ids: string;
}

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * Кому бот задаёт два новых вопроса анкеты. Правка живёт отдельно от данных сервера: `draft === null` — человек
 * ничего не трогал, и форма показывает то, что действует. Поэтому перечитывание настройки по таймеру не затирает
 * набранное (как у инструкций агентов): подменяется только нетронутая форма.
 */
function ExtraQuestionsForm({ current }: { current: SettingsBotView['extraQuestions'] }) {
  const actions = useBotActions();
  const modeId = useId();
  const idsId = useId();
  const idsHintId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const value: Draft = draft ?? { mode: current.mode, ids: current.ids };
  // Режим «Только этим людям» без единого номера не сохраняется: бот не стал бы спрашивать никого, и это не то, чего хотели.
  const canSave = !pending && (value.mode !== 'list' || hasBotIds(value.ids));

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...value, ...patch });
    setNotice(null);
  };

  async function save() {
    // Два нажатия подряд могут прийти до перерисовки: одного pending мало.
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      // Номера уходят только в режиме «Только этим людям»: в остальных сервер хранит пустую строку.
      await actions.saveExtraQuestions(value.mode === 'list' ? { mode: 'list', ids: value.ids.trim() } : { mode: value.mode });
      setDraft(null);
      setNotice({ kind: 'ok', text: t.saved });
    } catch (e) {
      // Набранное не стираем: человек исправит и повторит.
      setNotice({ kind: 'error', text: botErrorText(e) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className={styles.block}>
      <p>{t.intro}</p>

      <span id={modeId} className={styles.fieldLabel}>
        {t.modeLabel}
      </span>
      <div role="radiogroup" aria-labelledby={modeId} className={styles.radios}>
        {MODES.map((m) => (
          <label key={m} className={styles.radio}>
            <input type="radio" name={modeId} checked={value.mode === m} onChange={() => edit({ mode: m })} />
            <span>{t.modes[m]}</span>
          </label>
        ))}
      </div>

      {value.mode === 'list' && (
        <>
          <label htmlFor={idsId} className={styles.fieldLabel}>
            {t.idsLabel}
          </label>
          <input
            id={idsId}
            type="text"
            className={styles.control}
            value={value.ids}
            placeholder={t.idsPlaceholder}
            aria-describedby={idsHintId}
            autoComplete="off"
            onChange={(e) => edit({ ids: e.target.value })}
          />
          <p id={idsHintId} className={`${styles.muted} ${styles.hintLine}`}>
            {t.idsHint}
          </p>
        </>
      )}

      <p className={styles.source}>
        {t.source}: <b>{current.source === 'settings' ? t.sourceSettings : t.sourceEnv}</b>
        <br />
        <span className={styles.muted}>{t.envValue(current.envValue)}</span>
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
    </div>
  );
}

export function BotSection() {
  const query = useSettingsBot();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.bot}>
        <RefreshButton query={query} />
      </SectionHead>
      <QueryBoundary query={query}>
        {(data) => (
          <>
            <ExtraQuestionsForm current={data.extraQuestions} />
            <p className={`${styles.muted} ${styles.hintBelow}`}>{t.resendHint}</p>
          </>
        )}
      </QueryBoundary>
    </section>
  );
}
