import type { TodayView } from '@contracts';
import { FORMS, plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import { inDistrict, urgentDistricts } from './model';
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

/**
 * «Срочно нужна группа в…»: район, где людей ждёт больше, чем свободных мест (спрос есть, групп нет или они заполнены).
 * Считается по той же таблице, что и «Сегодня», поэтому цифры совпадают с клетками матрицы. Остальные районы с нехваткой —
 * мелким списком; по клику открывается список групп вкладки «Группы».
 */
export function UrgentWidget({ data }: { data: TodayView }) {
  const nav = useAppNav();
  const list = urgentDistricts(data.matrix);
  const [top, ...rest] = list;
  return (
    <section className={`${styles.panel} ${styles.urgent}`} aria-labelledby="today-urgent">
      <h3 id="today-urgent" className={styles.widgetTitle}>
        {ru.today.urgentTitle}
      </h3>
      {top ? (
        <>
          <p className={styles.urgentTop}>
            <b>{inDistrict(top.district)}</b>
            <span className={styles.widgetCaption}>
              {ru.today.urgentLine(plural(top.demand, FORMS.person), top.supply, plural(top.deficit, FORMS.person))}
            </span>
          </p>
          {rest.length > 0 && (
            <ul className={styles.urgentRest} aria-label={ru.today.urgentMoreLabel}>
              {rest.slice(0, 3).map((d) => (
                <li key={d.district}>
                  <b>{d.district}</b>
                  <span className={styles.widgetCaption}>{ru.today.urgentShort(d.demand, d.supply)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.widgetAct}>
            <Button size="sm" onClick={() => nav.goTab('groups')}>
              {ru.today.urgentOpen}
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.widgetCaption}>{ru.today.urgentNone}</p>
      )}
    </section>
  );
}
