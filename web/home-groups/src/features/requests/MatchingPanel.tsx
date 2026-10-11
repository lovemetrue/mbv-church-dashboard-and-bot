import { useId, useState } from 'react';
import type { AssistantStatus, MatchingStatus } from '@contracts';
import { formatDateTime } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import styles from './Requests.module.css';
import { AssistantRun } from './assistant/AssistantRun';
import { useAssistantRun } from './assistant/useAssistantRun';
import { useMatching } from './useMatching';

const m = ru.requests.matching;

/**
 * «Подбор для новых заявок»: сводка, кнопка закрепления и переключатель автоподбора.
 * Расчёт показывается и без кнопки; кнопка лишь закрепляет его, чтобы выбранные группы не менялись сами.
 * Предложение остаётся предложением: человек распределён только после «Утвердить»,
 * поэтому здесь ничего не утверждается.
 */
export function MatchingPanel({
  matching,
  assistant,
  dataChanged = 0,
}: {
  matching: MatchingStatus;
  assistant: AssistantStatus;
  dataChanged?: number;
}) {
  const act = useMatching();
  const helper = useAssistantRun();
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const noteId = useId();
  const { lastRun } = matching;
  // Подбор, пересчёт и помощник трогают одни и те же предложения: пока идёт любой из них, остальные не запускаем.
  const busy = act.pending !== null || helper.pending;

  return (
    <section className={styles.matching} aria-labelledby={titleId} aria-busy={busy}>
      <h3 id={titleId} className={styles.matchingTitle}>
        {m.title}
      </h3>
      <div className={styles.matchingStats}>
        <p>{m.saved(matching.saved, matching.waiting)}</p>
        <p>{lastRun ? m.lastRun(formatDateTime(lastRun.at), lastRun.created, lastRun.replaced) : m.neverRun}</p>
        {/* Заявки, чьи данные поправили после закрепления: их предложения устарели, но молча не меняются. */}
        {dataChanged > 0 && <p className={styles.matchingWarn}>{m.dataChanged(dataChanged)}</p>}
      </div>

      <div className={styles.matchingControls}>
        <Button variant="primary" size="big" disabled={busy} onClick={() => void act.run()}>
          {act.pending === 'run' ? m.running : m.run}
        </Button>
        {/* Второго уровня: пересчёт трогает уже закреплённые предложения, поэтому он за подтверждением. */}
        <Button disabled={busy} onClick={() => setConfirming(true)}>
          {act.pending === 'rerun' ? m.rerunning : m.rerun}
        </Button>
        <div className={styles.switchBox}>
          <button
            type="button"
            role="switch"
            aria-checked={matching.auto}
            aria-describedby={act.canToggle ? undefined : noteId}
            className={styles.switch}
            disabled={busy || !act.canToggle}
            onClick={() => void act.setAuto(!matching.auto)}
          >
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
            <span>{m.auto}</span>
          </button>
          {!act.canToggle && (
            <span id={noteId} className={styles.note}>
              {m.superOnly}
            </span>
          )}
        </div>
      </div>

      <AssistantRun status={assistant} run={helper} locked={act.pending !== null} />

      {helper.notice &&
        (helper.notice.kind === 'error' ? (
          <p className={styles.noticeError} role="alert">
            {helper.notice.text}
          </p>
        ) : (
          <p className={styles.noticeOk} role="status">
            {helper.notice.text}
          </p>
        ))}
      {act.notice &&
        (act.notice.kind === 'error' ? (
          <p className={styles.noticeError} role="alert">
            {act.notice.text}
          </p>
        ) : (
          <p className={styles.noticeOk} role="status">
            {act.notice.text}
          </p>
        ))}
      <p className={styles.matchingHint}>{m.hint}</p>
      {confirming && (
        <Modal title={m.rerunTitle} onClose={() => setConfirming(false)}>
          <p>{m.rerunQuestion}</p>
          <div className={styles.dialogFoot}>
            <Button onClick={() => setConfirming(false)}>{ru.requests.act.cancel}</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                // Окно закрываем сразу: итог и ошибка видны в панели, а не под ним.
                setConfirming(false);
                void act.rerunAll();
              }}
            >
              {m.rerunConfirm}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
