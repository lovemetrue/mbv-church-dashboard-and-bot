import { useId } from 'react';
import type { MatchingStatus } from '@contracts';
import { formatDateTime } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Requests.module.css';
import { useMatching } from './useMatching';

const m = ru.requests.matching;

/**
 * «Подбор для новых заявок»: сводка, кнопка запуска и переключатель автоподбора.
 * Предложение остаётся предложением: человек распределён только после «Утвердить»,
 * поэтому здесь ничего не утверждается.
 */
export function MatchingPanel({ matching }: { matching: MatchingStatus }) {
  const act = useMatching();
  const titleId = useId();
  const noteId = useId();
  const { lastRun } = matching;
  const busy = act.pending !== null;

  return (
    <section className={styles.matching} aria-labelledby={titleId} aria-busy={busy}>
      <h3 id={titleId} className={styles.matchingTitle}>
        {m.title}
      </h3>
      <div className={styles.matchingStats}>
        <p>{m.waiting(matching.waiting)}</p>
        <p>{lastRun ? m.lastRun(formatDateTime(lastRun.at), lastRun.created, lastRun.replaced) : m.neverRun}</p>
      </div>

      <div className={styles.matchingControls}>
        <Button variant="primary" size="big" disabled={busy} onClick={() => void act.run()}>
          {act.pending === 'run' ? m.running : m.run}
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
    </section>
  );
}
