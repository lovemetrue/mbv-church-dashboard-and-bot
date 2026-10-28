import { useId, useState } from 'react';
import type { AssistantStatus, MatchingStatus, RequestItem } from '@contracts';
import { formatDateTime } from '../../entities/format';
import { canChange } from '../../shared/access';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, Modal } from '../../shared/ui';
import { useAssistantDock } from '../assistant-chat/AssistantChat';
import styles from './Requests.module.css';
import { ChangedRequests } from './ChangedRequests';
import { useMatching } from './useMatching';

const m = ru.requests.matching;

/**
 * «Подбор для новых заявок»: сводка, кнопка закрепления и значок ✦ помощника. Переключатель автоподбора живёт в
 * «Настройки → Подбор» (его меняют редко, а шапку он раздувал), здесь — только строка о том, включён ли он.
 * Расчёт показывается и без кнопки; кнопка лишь закрепляет его, чтобы выбранные группы не менялись сами.
 * Предложение остаётся предложением: человек распределён только после «Утвердить»,
 * поэтому здесь ничего не утверждается.
 */
export function MatchingPanel({
  matching,
  assistant,
  changed = [],
}: {
  matching: MatchingStatus;
  assistant: AssistantStatus;
  /** Открытые заявки, чьи данные изменились после закрепления предложения. */
  changed?: readonly RequestItem[];
}) {
  const nav = useAppNav();
  const me = useMe();
  const act = useMatching();
  const dock = useAssistantDock();
  const [confirming, setConfirming] = useState(false);
  const [listing, setListing] = useState(false);
  const titleId = useId();
  const { lastRun } = matching;
  // Подбор, пересчёт и помощник трогают одни и те же предложения: пока идёт любой из них, остальные не запускаем.
  const busy = act.pending !== null || dock?.review.pending === true;
  // Значок помощника: обычному входу при незаданном ключе он ни к чему — сделать с этим он ничего не может.
  const showHelper = dock !== null && me.data !== undefined && (assistant.available || me.data.role === 'super');
  const helperLabel = ru.requests.assistant.icon(assistant.available && assistant.enabled ? assistant.review.length : 0);

  return (
    <section className={styles.matching} aria-labelledby={titleId} aria-busy={busy}>
      <h3 id={titleId} className={styles.matchingTitle}>
        {m.title}
      </h3>
      <div className={styles.matchingStats}>
        <p>{m.saved(matching.saved, matching.waiting)}</p>
        <p>{lastRun ? m.lastRun(formatDateTime(lastRun.at), lastRun.created, lastRun.replaced) : m.neverRun}</p>
        <p>
          {matching.auto ? m.autoOn : m.autoOff}
          {me.data?.role === 'super' && (
            <>
              {' · '}
              <button type="button" className={styles.linkInline} onClick={() => nav.goSettingsSection('matching')}>
                {m.autoSettings}
              </button>
            </>
          )}
        </p>
        {/* Заявки, чьи данные поправили после закрепления: их предложения устарели, но молча не меняются. */}
        {changed.length > 0 && (
          <p className={styles.matchingWarn}>
            <button type="button" className={styles.matchingWarnLink} title={m.dataChangedHint} onClick={() => setListing(true)}>
              {m.dataChanged(changed.length)}
            </button>
          </p>
        )}
      </div>

      {/* «Только чтение» видит, как идёт подбор, но не запускает его. */}
      {canChange(me.data) && <div className={styles.matchingControls}>
        <Button variant="primary" size="big" disabled={busy} onClick={() => void act.run()}>
          {act.pending === 'run' ? m.running : m.run}
        </Button>
        {/* Второго уровня: пересчёт трогает уже закреплённые предложения, поэтому он за подтверждением. */}
        <Button disabled={busy} onClick={() => setConfirming(true)}>
          {act.pending === 'rerun' ? m.rerunning : m.rerun}
        </Button>
        {showHelper && dock && (
          <button
            type="button"
            className={styles.helperIcon}
            title={helperLabel}
            aria-label={helperLabel}
            aria-busy={dock.review.pending}
            onClick={() => dock.open('review')}
          >
            <span aria-hidden="true">✦</span>
            {assistant.available && assistant.enabled && assistant.review.length > 0 && (
              <span aria-hidden="true" className={styles.helperBadge}>
                {assistant.review.length}
              </span>
            )}
          </button>
        )}
      </div>}
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
      {listing && (
        <ChangedRequests
          items={changed}
          onClose={() => setListing(false)}
          onOpen={(id) => {
            // Окно закрываем вместе с переходом: карточка открывается поверх списка, а не под окном.
            setListing(false);
            nav.selectRequest(id);
          }}
        />
      )}
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
