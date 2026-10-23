import { useId } from 'react';
import { useRequests } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useMatching } from '../requests/useMatching';
import { QueryBoundary } from './QueryBoundary';
import { SectionHead } from './SectionHead';
import styles from './Settings.module.css';

const t = ru.settings.matching;

/**
 * «Подбор»: переключатель автоподбора новых заявок. Раньше он стоял в шапке «Заявок» и занимал там строку, хотя
 * меняют его редко; в «Заявках» осталась строка о том, включён ли он. Срабатывает сразу, как и прежде: значение
 * берём из ответа сервера (оно приходит с заявками), а не угадываем.
 */
export function MatchingSection() {
  const query = useRequests();
  const act = useMatching();
  const titleId = useId();
  const hintId = useId();
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
            {act.notice && (
              <p className={act.notice.kind === 'ok' ? styles.noticeOk : styles.noticeError} role={act.notice.kind === 'ok' ? 'status' : 'alert'}>
                {act.notice.text}
              </p>
            )}
          </div>
        )}
      </QueryBoundary>
    </section>
  );
}
