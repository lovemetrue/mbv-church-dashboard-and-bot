import type { TodayView } from '@contracts';
import { greeting } from '../../entities/format';
import { FORMS, plural } from '../../entities/plural';
import { useToday } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, ErrorState, LoadingState } from '../../shared/ui';
import { HelpBlock } from './HelpBlock';
import { Matrix } from './Matrix';
import styles from './Today.module.css';

export function TodayScreen() {
  const query = useToday();
  if (query.isPending) return <LoadingState lines={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <TodayContent data={query.data} now={new Date()} />;
}

export function TodayContent({ data, now }: { data: TodayView; now: Date }) {
  const nav = useAppNav();
  const { counters } = data;
  const queue = counters.ready + counters.callback;

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby="today-hello">
        <div className={styles.hero}>
          <div>
            <h2 id="today-hello" className={styles.hello}>
              {greeting(now)}
            </h2>
            <p className={styles.sub}>
              {queue > 0
                ? ru.today.distributed(plural(queue, FORMS.request))
                : ru.today.nobodyToCall}
            </p>
          </div>
          <Button variant="primary" size="big" soon>
            {ru.today.startCall(queue)}
          </Button>
        </div>
        <div className={styles.counters} role="group" aria-label={ru.today.countersLabel}>
          <button type="button" className={`${styles.counter} ${styles.counterReady}`} onClick={() => nav.goBucket('ready')}>
            <span className={`${styles.counterNum} num`}>{counters.ready}</span>
            <span className={styles.counterLabel}>{ru.today.readyTitle}</span>
            <span className={styles.counterHint}>{ru.today.readyHint}</span>
          </button>
          <button type="button" className={`${styles.counter} ${styles.counterCb}`} onClick={() => nav.goBucket('callback')}>
            <span className={`${styles.counterNum} num`}>{counters.callback}</span>
            <span className={styles.counterLabel}>{ru.today.callbackTitle}</span>
            <span className={styles.counterHint}>{ru.today.callbackHint}</span>
          </button>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.areaHelp}`} aria-labelledby="today-help">
          <HelpBlock data={data} />
        </section>
        <section className={`${styles.panel} ${styles.areaMatrix}`} aria-labelledby="today-matrix">
          <h3 id="today-matrix" className={styles.h3}>
            {ru.today.matrixTitle}
          </h3>
          <Matrix data={data} />
        </section>
      </div>
    </div>
  );
}
