import type { TodayView } from '@contracts';
import { FORMS, plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import styles from './Today.module.css';

/** Сколько ситуаций мелким шрифтом в виджете; остальные — в списке «Заявок» (на живых данных их под сотню). */
export const WIDGET_SITUATIONS = 3;

/**
 * «Нужна помощь в сопоставлении»: компактный виджет верхнего ряда — число, подпись, переход к списку
 * и пара первых ситуаций. Полный разбор живёт в «Заявках» (корзина «Нужна помощь»), здесь его нет.
 */
export function HelpWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  const empty = data.clusters.length === 0 && data.singles.length === 0;
  const lines = [
    ...data.clusters.map((c) => ({
      key: `c-${c.district}`,
      title: ru.today.helpCluster(c.district, plural(c.requestIds.length, FORMS.person)),
      note: null as string | null,
      open: () => nav.goBucket('human'),
    })),
    ...data.singles.map((s) => ({
      key: `s-${s.requestId}`,
      title: s.fio,
      note: s.reason,
      open: () => nav.openRequest(s.requestId),
    })),
  ].slice(0, WIDGET_SITUATIONS);

  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-help">
      <div className={styles.widgetHead}>
        <span className={`${styles.widgetNum} ${styles.numWarn} num`}>{data.counters.human}</span>
        <div>
          <h3 id="today-help" className={styles.widgetTitle}>
            {ru.today.helpTitle}
          </h3>
          <p className={styles.widgetCaption}>{ru.today.helpCaption}</p>
        </div>
      </div>
      {empty ? (
        <p className={styles.widgetCaption}>{ru.today.helpEmpty}</p>
      ) : (
        <ul className={styles.situations}>
          {lines.map((l) => (
            <li key={l.key}>
              <button type="button" className={styles.situation} onClick={l.open}>
                <b>{l.title}</b>
                {l.note && <span>{l.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.widgetAct}>
        <Button size="sm" onClick={() => nav.goBucket('human')}>
          {ru.today.helpOpen}
        </Button>
      </div>
    </section>
  );
}

/** «Утверждено»: сколько человек уже в группах и сколько добавилось сегодня. */
export function ApprovedWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-approved">
      <div className={styles.widgetHead}>
        <span className={`${styles.widgetNum} ${styles.numOk} num`}>{data.counters.done}</span>
        <div>
          <h3 id="today-approved" className={styles.widgetTitle}>
            {ru.today.approvedTitle}
          </h3>
          <p className={styles.widgetCaption}>{ru.today.approvedCaption}</p>
        </div>
      </div>
      <p className={`${styles.approvedToday} num`}>{ru.today.approvedToday(data.approvedToday)}</p>
      <div className={styles.widgetAct}>
        <Button size="sm" onClick={() => nav.goBucket('done')}>
          {ru.today.approvedOpen}
        </Button>
      </div>
    </section>
  );
}
