import type { Cluster, TodayView } from '@contracts';
import { FORMS, plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import styles from './Today.module.css';

function clusterText(c: Cluster): string {
  const who = `${plural(c.requestIds.length, FORMS.person)} (${c.firstNames.join(', ')})`;
  const ages = c.ages.length ? `, ${ru.today.clusterAges} ${c.ages.join(' и ')}` : '';
  const days = c.days.length ? `, ${ru.today.clusterDays} ${c.days.join(' / ')}` : '';
  return `${who}${ages}${days}. ${ru.today.clusterTail}`;
}

/** «Нужна помощь в сопоставлении»: кластеры «не хватает группы» и одиночные ситуации. */
export function HelpBlock({ data }: { data: TodayView }) {
  const nav = useAppNav();
  const empty = data.clusters.length === 0 && data.singles.length === 0;
  return (
    <>
      <div className={styles.helpHead}>
        <span className={`${styles.helpNum} num`}>{data.counters.human}</span>
        <h3 id="today-help" className={styles.helpTitle}>
          {ru.today.helpTitle}
        </h3>
      </div>
      {empty ? (
        <p className={styles.sub}>{ru.today.helpEmpty}</p>
      ) : (
        <ul className={styles.sits}>
          {data.clusters.map((c) => (
            <li key={`c-${c.district}`} className={`${styles.sit} ${styles.sitCluster}`}>
              <b>{ru.today.clusterTitle(c.district)}</b>
              <p>{clusterText(c)}</p>
              <div className={styles.act}>
                <Button variant="primary" size="sm" soon>
                  {ru.today.proposeOpen}
                </Button>
                <Button size="sm" onClick={() => nav.goBucket('human')}>
                  {ru.today.showRequests}
                </Button>
              </div>
            </li>
          ))}
          {data.singles.map((s) => (
            <li key={`s-${s.requestId}`} className={styles.sit}>
              <b>{s.fio}</b>
              <p>
                {s.reason}
                {s.place ? ` · «${s.place}»` : ''}
              </p>
              <div className={styles.act}>
                <Button size="sm" onClick={() => nav.openRequest(s.requestId)}>
                  {ru.today.clarify}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
