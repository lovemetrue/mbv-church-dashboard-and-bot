import type { TodayView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { urgentDistricts } from './model';
import styles from './Today.module.css';

/** «Готово к утверждению»: число заявок, у которых группа подобрана и остался звонок. Нажатие открывает список. */
export function ReadyWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-ready">
      <h3 id="today-ready" className={styles.widgetTitle}>
        {ru.today.readyTitle}
      </h3>
      <button type="button" className={`${styles.widgetNumBtn} ${styles.numOk} num`} aria-label={ru.today.readyOpenLabel(data.counters.ready)} onClick={() => nav.goBucket('ready')}>
        {data.counters.ready}
      </button>
    </section>
  );
}

/** «Перезвонить»: число заявок, где просили перезвонить или не дозвонились. */
export function CallbackWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-callback">
      <h3 id="today-callback" className={styles.widgetTitle}>
        {ru.today.callbackTitle}
      </h3>
      <button type="button" className={`${styles.widgetNumBtn} ${styles.numAccent} num`} aria-label={ru.today.callbackOpenLabel(data.counters.callback)} onClick={() => nav.goBucket('callback')}>
        {data.counters.callback}
      </button>
    </section>
  );
}

/**
 * «Нужна помощь в сопоставлении»: только число заявок, с которыми система не справилась сама. Нажатие ведёт к списку в «Заявках»
 * (корзина «Нужна помощь»): подробности и ситуации живут там, на «Сегодня» их не повторяем.
 */
export function HelpWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-help">
      <h3 id="today-help" className={styles.widgetTitle}>
        {ru.today.helpTitle}
      </h3>
      <button type="button" className={`${styles.widgetNumBtn} ${styles.numWarn} num`} aria-label={ru.today.helpOpenLabel(data.counters.human)} onClick={() => nav.goBucket('human')}>
        {data.counters.human}
      </button>
    </section>
  );
}

/** «Утверждено»: только число человек, уже определённых в группы. Нажатие открывает список утверждённых. */
export function ApprovedWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <section className={`${styles.panel} ${styles.widget}`} aria-labelledby="today-approved">
      <h3 id="today-approved" className={styles.widgetTitle}>
        {ru.today.approvedTitle}
      </h3>
      <button type="button" className={`${styles.widgetNumBtn} ${styles.numOk} num`} aria-label={ru.today.approvedOpenLabel(data.counters.done)} onClick={() => nav.goBucket('done')}>
        {data.counters.done}
      </button>
    </section>
  );
}

/** Сколько районов показывать в «Срочно нужна группа»: остальные не помещаются и менее срочны. */
export const URGENT_SHOWN = 5;

/**
 * «Срочно нужна группа»: районы, где людей ждёт больше, чем свободных мест, — сначала там, где не хватает
 * больше всего. Рядом с районом одно число — сколько мест не хватает; «ждут» и «места» по отдельности — в таблице ниже. Фон бледно-розовый и
 * полупрозрачный, чтобы блок был заметен, но не кричал.
 */
export function UrgentWidget({ data }: { data: TodayView }) {
  const list = urgentDistricts(data.matrix).slice(0, URGENT_SHOWN);
  return (
    <section className={`${styles.panel} ${styles.urgent}`} aria-labelledby="today-urgent">
      <h3 id="today-urgent" className={styles.widgetTitle}>
        {ru.today.urgentTitle}
      </h3>
      {list.length > 0 ? (
        <ol className={styles.urgentList}>
          {list.map((d) => (
            <li key={d.district} className={styles.urgentRow}>
              <span>{d.district}</span>
              <span className={`${styles.urgentNum} num`}>{d.deficit}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.widgetCaption}>{ru.today.urgentNone}</p>
      )}
    </section>
  );
}
