import { useId, useState } from 'react';
import type { AssistantStatus, MatchingStatus, RequestItem } from '@contracts';
import { formatDateTime } from '../../entities/format';
import { canChange } from '../../shared/access';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, Modal, Popover } from '../../shared/ui';
import { useAssistantDock } from '../assistant-chat/AssistantChat';
import styles from './Requests.module.css';
import { ChangedRequests } from './ChangedRequests';
import { useMatching } from './useMatching';

const m = ru.requests.matching;

type MatchingActions = ReturnType<typeof useMatching>;

/**
 * Сводка подбора и кнопки «Предложить группы новым заявкам» / «Пересчитать все предложения». Живёт в двух местах: в
 * окошке кнопки «Подбор» в «Заявках» и в «Настройки → Подбор». Общий подбор запускают редко (обычно работает
 * автоподбор), поэтому большой плашкой над списком он больше не стоит — место отдано заявкам.
 *
 * `act` и окно подтверждения пересчёта держит вызывающий: окошко «Подбор» при закрытии размонтируется, а итог запуска
 * и вопрос «Пересчитать?» должны его пережить (вопрос — ещё и потому, что клик по нему закрыл бы окошко).
 * Предложение остаётся предложением: человек распределён только после «Утвердить», здесь ничего не утверждается.
 */
export function MatchingBlock({ matching, act, onRerun, busy }: { matching: MatchingStatus; act: MatchingActions; onRerun: () => void; busy: boolean }) {
  const nav = useAppNav();
  const me = useMe();
  const titleId = useId();
  const { lastRun } = matching;
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
          {me.data?.role === 'super' && nav.tab !== 'settings' && (
            <>
              {' · '}
              <button type="button" className={styles.linkInline} onClick={() => nav.goSettingsSection('matching')}>
                {m.autoSettings}
              </button>
            </>
          )}
        </p>
      </div>
      {/* «Только чтение» видит, как идёт подбор, но не запускает его. */}
      {canChange(me.data) && (
        <div className={styles.matchingControls}>
          <Button variant="primary" disabled={busy} onClick={() => void act.run()}>
            {act.pending === 'run' ? m.running : m.run}
          </Button>
          {/* Второго уровня: пересчёт трогает уже закреплённые предложения, поэтому он за подтверждением. */}
          <Button disabled={busy} onClick={onRerun}>
            {act.pending === 'rerun' ? m.rerunning : m.rerun}
          </Button>
        </div>
      )}
      <p className={styles.matchingHint}>{m.hint}</p>
    </section>
  );
}

/** Вопрос перед «Пересчитать все предложения». */
export function RerunConfirm({ act, busy, onClose }: { act: MatchingActions; busy: boolean; onClose: () => void }) {
  return (
    <Modal title={m.rerunTitle} onClose={onClose}>
      <p>{m.rerunQuestion}</p>
      <div className={styles.dialogFoot}>
        <Button onClick={onClose}>{ru.requests.act.cancel}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            // Окно закрываем сразу: итог и ошибка видны рядом с кнопкой «Подбор», а не под ним.
            onClose();
            void act.rerunAll();
          }}
        >
          {m.rerunConfirm}
        </Button>
      </div>
    </Modal>
  );
}

export function MatchingNotice({ act }: { act: MatchingActions }) {
  if (!act.notice) return null;
  return act.notice.kind === 'error' ? (
    <p className={styles.noticeError} role="alert">
      {act.notice.text}
    </p>
  ) : (
    <p className={styles.noticeOk} role="status">
      {act.notice.text}
    </p>
  );
}

/**
 * Подбор в «Заявках» — в одну строку с «Фильтрами»: кнопка «Подбор» (число — сколько заявок ещё без предложения)
 * с окошком сводки, значок ✦ помощника (его открывают каждый день) и, только когда есть, ссылка «Данные изменились
 * у N заявок». Итог запуска — строкой под ними.
 */
export function MatchingBar({
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
  // Подбор, пересчёт и помощник трогают одни и те же предложения: пока идёт любой из них, остальные не запускаем.
  const busy = act.pending !== null || dock?.review.pending === true;
  // Значок помощника: обычному входу при незаданном ключе он ни к чему — сделать с этим он ничего не может.
  const showHelper = dock !== null && me.data !== undefined && (assistant.available || me.data.role === 'super');
  const helperLabel = ru.requests.assistant.icon(assistant.available && assistant.enabled ? assistant.review.length : 0);

  return (
    <>
      <Popover label={m.button} badge={matching.waiting || undefined} title={m.title}>
        <MatchingBlock matching={matching} act={act} busy={busy} onRerun={() => setConfirming(true)} />
      </Popover>
      {showHelper && dock && canChange(me.data) && (
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
      {/* Заявки, чьи данные поправили после закрепления: их предложения устарели, но молча не меняются. */}
      {changed.length > 0 && (
        <button type="button" className={`${styles.matchingWarnLink} ${styles.matchingWarn}`} title={m.dataChangedHint} onClick={() => setListing(true)}>
          {m.dataChanged(changed.length)}
        </button>
      )}
      {act.notice && (
        <div className={styles.matchingNoticeLine}>
          <MatchingNotice act={act} />
        </div>
      )}
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
      {confirming && <RerunConfirm act={act} busy={busy} onClose={() => setConfirming(false)} />}
    </>
  );
}
