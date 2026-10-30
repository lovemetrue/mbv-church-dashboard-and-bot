import { useId, useState } from 'react';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { useMatching } from '../requests/useMatching';
import { MatchingBlock, RerunConfirm } from '../requests/MatchingPanel';
import { QueryBoundary } from './QueryBoundary';
import { SectionHead } from './SectionHead';
import styles from './Settings.module.css';

const t = ru.settings.matching;

/**
 * «Подбор»: переключатели автоподбора и сообщений в MAX, а под ними — сводка и запуск общего подбора. Переключатель
 * автоподбора раньше стоял в шапке «Заявок» и занимал там строку, хотя меняют его редко; в «Заявках» подбор теперь
 * под кнопкой «Подбор». Переключатели срабатывают сразу: значение берём из ответа сервера (оно приходит с заявками),
 * а не угадываем.
 */
export function MatchingSection() {
  const query = useRequests();
  const act = useMatching();
  const titleId = useId();
  const hintId = useId();
  const [confirming, setConfirming] = useState(false);
  const notifyHintId = useId();
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={ru.settings.sections.matching} />
      <QueryBoundary query={query}>
        {(data) => (
          <div className={styles.block}>
            <p>{t.intro}</p>
            <label className={`${styles.radio} ${styles.stackTop}`}>
              <input
                type="checkbox"
                role="switch"
                checked={data.matching.auto}
                disabled={act.pending !== null}
                aria-describedby={hintId}
                onChange={() => void act.setAuto(!data.matching.auto)}
              />
              <span>{ru.requests.matching.auto}</span>
            </label>
            <p id={hintId} className={`${styles.muted} ${styles.hintLine}`}>
              {t.autoHint}
            </p>
            <label className={`${styles.radio} ${styles.stackTop}`}>
              <input
                type="checkbox"
                role="switch"
                checked={data.matching.notify === true}
                disabled={act.pending !== null || !act.canToggle}
                aria-describedby={notifyHintId}
                onChange={() => void act.setNotify(data.matching.notify !== true)}
              />
              <span>{t.notify}</span>
            </label>
            <p id={notifyHintId} className={`${styles.muted} ${styles.hintLine}`}>
              {t.notifyHint}
            </p>
            {/* Только пока есть что переотправлять: после повтора строка исчезает сама (счётчик приходит с заявками). */}
            {(data.matching.fioResend ?? 0) > 0 && act.canToggle && (
              <div className={styles.stackTop}>
                <p>{t.fioResendText(data.matching.fioResend!)}</p>
                <p className={`${styles.muted} ${styles.hintLine}`}>{t.fioResendHint}</p>
                <Button disabled={act.pending !== null} onClick={() => void act.resendFio()}>
                  {t.fioResendButton(data.matching.fioResend!)}
                </Button>
              </div>
            )}
            {act.notice && (
              <p className={act.notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={act.notice.kind === 'ok' ? 'status' : 'alert'}>
                {act.notice.text}
              </p>
            )}
            {/* Общий подбор: в «Заявках» он спрятан под кнопку «Подбор», здесь — рядом с его настройками. */}
            <div className={styles.stackTop}>
              <MatchingBlock matching={data.matching} act={act} busy={act.pending !== null} onRerun={() => setConfirming(true)} />
            </div>
            {confirming && <RerunConfirm act={act} busy={act.pending !== null} onClose={() => setConfirming(false)} />}
          </div>
        )}
      </QueryBoundary>
    </section>
  );
}
