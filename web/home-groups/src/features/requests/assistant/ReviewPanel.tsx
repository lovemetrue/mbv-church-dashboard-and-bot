import { useState } from 'react';
import type { AssistantReviewItem, AssistantStatus } from '@contracts';
import { useMe, useRequests } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button } from '../../../shared/ui';
import { DockFrame, type DockTabs } from '../../assistant-chat/DockFrame';
import chat from '../../assistant-chat/Chat.module.css';
import { ReviewCard } from './ReviewCard';
import styles from './Review.module.css';
import type { useAssistantRun } from './useAssistantRun';

const a = ru.requests.assistant;

/**
 * Вкладка «Разбор заявок» окна помощника. Помощник говорит с координатором репликами, как в чате: сколько заявок может
 * разобрать и что для этого прочитает; после разбора — что получилось, а где не справился — почему и что спросить
 * у человека. Ответ человека можно сразу вписать в заявку, не уходя из окна. Выключен или не подключён — так и говорит.
 */
export function ReviewPanel({ run, onClose, isSuper, tabs }: {
  run: ReturnType<typeof useAssistantRun>;
  onClose: () => void;
  isSuper: boolean;
  tabs: DockTabs | null;
}) {
  const requests = useRequests();
  const status = requests.data?.assistant;
  return (
    <DockFrame subtitle={a.reviewSubtitle} onClose={onClose} tabs={tabs}>
      <div className={chat.scroll}>
        <div role="log" aria-label={a.tabReview} className={chat.log}>
          {status ? (
            <Conversation status={status} run={run} isSuper={isSuper} onClose={onClose} />
          ) : requests.isError ? (
            <div className={`${chat.bubble} ${chat.bot} ${chat.failure}`} role="alert">
              <p className={chat.text}>{a.loadFailed}</p>
              <div className={chat.answerActions}>
                <Button size="sm" onClick={() => void requests.refetch()}>{a.retry}</Button>
              </div>
            </div>
          ) : (
            <div className={`${chat.bubble} ${chat.bot} ${chat.thinking}`}>{a.loading}</div>
          )}
        </div>
      </div>
    </DockFrame>
  );
}

function Conversation({ status, run, isSuper, onClose }: {
  status: AssistantStatus;
  run: ReturnType<typeof useAssistantRun>;
  isSuper: boolean;
  onClose: () => void;
}) {
  const nav = useAppNav();
  const me = useMe();
  // Что записали в заявку из этого окна: заявка уходит из списка, а подтверждение должно остаться.
  const [saved, setSaved] = useState<string | null>(null);

  const settingsLink = (
    <button
      type="button"
      className={chat.link}
      onClick={() => {
        nav.goSettingsSection('assistant');
        onClose();
      }}
    >
      {a.settingsLink}
    </button>
  );
  if (!status.available || !status.enabled) {
    // Пока роль неизвестна, не говорим «включить может полный вход»: полному входу это была бы неправда.
    if (!me.data) return null;
    const text = !status.available ? (isSuper ? a.notConnectedSuper : a.notConnectedAdmin) : isSuper ? a.offSuper : a.offAdmin;
    return (
      <div className={`${chat.bubble} ${chat.bot}`}>
        <p className={chat.text}>
          {text}
          {isSuper && <>{settingsLink}.</>}
        </p>
      </div>
    );
  }

  const waiting = status.review.filter((i) => i.state === 'reviewed');
  const fresh = status.review.filter((i) => i.state === 'new');
  const intro = fresh.length > 0 ? a.canRun(fresh.length) : waiting.length > 0 ? a.onlyWaiting : a.nothing;

  return (
    <>
      <div className={`${chat.bubble} ${chat.bot}`}>
        <p className={chat.text}>{intro}</p>
        {fresh.length > 0 && (
          <div className={chat.answerActions}>
            <Button variant="primary" size="sm" disabled={run.pending} onClick={() => void run.run()}>
              {run.pending ? a.running : a.run(fresh.length)}
            </Button>
          </div>
        )}
      </div>

      <div role="status" className={chat.thinkingBox}>
        {run.pending && <div className={`${chat.bubble} ${chat.bot} ${chat.thinking}`}>{a.running}</div>}
        {!run.pending && run.result && (
          <div className={`${chat.bubble} ${chat.bot}`}>
            <p className={chat.text}>{a.done(run.result)}</p>
          </div>
        )}
        {saved && (
          <div className={`${chat.bubble} ${chat.bot}`}>
            <p className={chat.text}>{a.answerSaved(saved)}</p>
          </div>
        )}
      </div>
      {!run.pending && run.error && (
        <div className={`${chat.bubble} ${chat.bot} ${chat.failure}`} role="alert">
          <span className={chat.errorMark}>{a.errorMark}</span>
          <p className={chat.text}>{run.error}</p>
          <div className={chat.answerActions}>
            <Button size="sm" onClick={() => void run.run()}>{a.retry}</Button>
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <ItemList title={a.waitingTitle(waiting.length)} items={waiting} onSaved={setSaved} onOpen={(id) => nav.selectRequest(id)} />
      )}
      {fresh.length > 0 && waiting.length > 0 && (
        <p className={styles.freshNote}>{a.newTitle(fresh.length)}</p>
      )}
    </>
  );
}

function ItemList({ title, items, onSaved, onOpen }: {
  title: string;
  items: readonly AssistantReviewItem[];
  onSaved: (fio: string) => void;
  onOpen: (id: number) => void;
}) {
  return (
    <section className={styles.list} aria-label={title}>
      <h3 className={styles.listTitle}>{title}</h3>
      {items.map((item) => (
        <ReviewCard key={item.requestId} item={item} onSaved={onSaved} onOpen={onOpen} />
      ))}
    </section>
  );
}
