import type { TodayView } from '@contracts';
import { useState } from 'react';
import { greeting } from '../../entities/format';
import { FORMS, plural } from '../../entities/plural';
import { useRequests, useToday } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, ErrorState, LoadingState, Tip } from '../../shared/ui';
import { CellPanel } from './CellPanel';
import { Matrix, type CellRef } from './Matrix';
import { useMatrixPrefs } from './prefs';
import { ApprovedWidget, HelpWidget } from './Widgets';
import styles from './Today.module.css';

export function TodayScreen() {
  const query = useToday();
  if (query.isPending) return <LoadingState lines={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <TodayContent data={query.data} now={new Date()} />;
}

/**
 * «Пульт»: верхний ряд (приветствие, счётчики и два виджета), под ним таблица на всю ширину.
 * Сводку по заявкам (сколько закреплено, кто первый в очереди) берём из того же запроса, что и экран
 * «Заявки»: он уже в кэше, а пока не пришёл — этих мест просто нет.
 */
export function TodayContent({ data, now }: { data: TodayView; now: Date }) {
  const nav = useAppNav();
  const requests = useRequests();
  const [prefs, setPrefs] = useMatrixPrefs();
  const [selected, setSelected] = useState<CellRef | null>(null);
  const { counters } = data;
  const queue = counters.ready + counters.callback;
  const matching = requests.data?.matching;
  const selectedCell = selected
    ? data.matrix.find((r) => r.district === selected.district)?.cells.find((c) => c.age === selected.age)
    : undefined;

  // Очередь обзвона в списке идёт «перезвонить», потом «готово»; первая из неё открывается сразу.
  const startCall = () => {
    const first = requests.data?.items.find((i) => i.bucket === 'callback') ?? requests.data?.items.find((i) => i.bucket === 'ready');
    nav.goQueue(first?.id);
  };

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <section className={`${styles.panel} ${styles.areaHero}`} aria-labelledby="today-hello">
          <div className={styles.hero}>
            <div>
              <h2 id="today-hello" className={styles.hello}>
                {greeting(now)}
              </h2>
              <p className={styles.sub}>
                {queue > 0 ? ru.today.distributed(plural(queue, FORMS.request)) : ru.today.nobodyToCall}
              </p>
            </div>
            <Button variant="primary" size="big" disabled={queue === 0} onClick={startCall}>
              {queue === 0 ? ru.today.queueEmpty : ru.today.startCall(queue)}
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
          {matching && (
            <p className={styles.saved}>
              <Tip text={ru.today.savedHint}>
                {(aria) => (
                  // tabIndex=0: подсказка должна открываться и с клавиатуры, а текст сам по себе не фокусируется.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  <span tabIndex={0} {...aria} className={`${styles.savedText} num`}>
                    {ru.today.savedLabel(matching.saved, counters.ready + counters.callback + counters.human)}
                  </span>
                )}
              </Tip>
            </p>
          )}
        </section>
        <HelpWidget data={data} />
        <ApprovedWidget data={data} />
      </div>

      <section className={`${styles.panel} ${styles.matrixPanel}`} aria-labelledby="today-matrix">
        <h3 id="today-matrix" className={styles.h3}>
          {ru.today.matrixTitle}
        </h3>
        <Matrix data={data} prefs={prefs} onPrefs={setPrefs} selected={selected} onOpen={setSelected} />
      </section>

      {selected && selectedCell && (
        <CellPanel
          district={selected.district}
          age={selected.age}
          cell={selectedCell}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
