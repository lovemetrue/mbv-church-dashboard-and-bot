import type { TodayView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { urgentDistricts } from './model';
import styles from './Today.module.css';

/** Один показатель сдвоенного виджета: подпись и число; число — кнопка, если у показателя есть список. */
function Stat({ id, title, value, tone, big, aria, onOpen }: {
  id: string; title: string; value: number; tone?: string; big?: boolean; aria?: string; onOpen?: () => void;
}) {
  const cls = `${big ? styles.statBig : styles.statSmall} ${tone ?? ''} num`;
  return (
    <section className={styles.stat} aria-labelledby={id}>
      <h3 id={id} className={styles.widgetTitle}>
        {title}
      </h3>
      {onOpen ? (
        <button type="button" className={`${styles.widgetNumBtn} ${cls}`} aria-label={aria} onClick={onOpen}>
          {value}
        </button>
      ) : (
        <span className={cls}>{value}</span>
      )}
    </section>
  );
}

/** «Всего заявок» и «Исполнено»: общее число без вычитаний (заявки в подбор и другие обращения), рядом — сколько исполнено. */
export function TotalWidget({ data }: { data: TodayView }) {
  return (
    <div className={`${styles.panel} ${styles.pair}`}>
      <Stat id="today-total" title={ru.today.totalTitle} value={data.requestsAll} big />
      <Stat id="today-total-done" title={ru.today.totalDoneTitle} value={data.requestsDone} tone={styles.numOk} />
    </div>
  );
}

/** «Готово к утверждению» и «Утверждено»: число заявок с подобранной группой и число уже утверждённых. */
export function ReadyApprovedWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <div className={`${styles.panel} ${styles.pair}`}>
      <Stat id="today-ready" title={ru.today.readyTitle} value={data.counters.ready} tone={styles.numOk} big
        aria={ru.today.readyOpenLabel(data.counters.ready)} onOpen={() => nav.goBucket('ready')} />
      <Stat id="today-approved" title={ru.today.approvedTitle} value={data.counters.done} tone={styles.numOk}
        aria={ru.today.approvedOpenLabel(data.counters.done)} onOpen={() => nav.goBucket('done')} />
    </div>
  );
}

/** «Нужна помощь в сопоставлении» и «Перезвонить»: то, что делают люди, а не система. */
export function HelpCallbackWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  return (
    <div className={`${styles.panel} ${styles.pair}`}>
      <Stat id="today-help" title={ru.today.helpTitle} value={data.counters.human} tone={styles.numWarn} big
        aria={ru.today.helpOpenLabel(data.counters.human)} onOpen={() => nav.goBucket('human')} />
      <Stat id="today-callback" title={ru.today.callbackTitle} value={data.counters.callback} tone={styles.numAccent}
        aria={ru.today.callbackOpenLabel(data.counters.callback)} onOpen={() => nav.goBucket('callback')} />
    </div>
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
