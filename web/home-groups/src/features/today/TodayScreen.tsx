import type { TodayView } from '@contracts';
import { useState } from 'react';
import { useGroups, useToday } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { ErrorState, LoadingState } from '../../shared/ui';
import { CellPanel } from './CellPanel';
import { Matrix, type CellRef } from './Matrix';
import { useMatrixPrefs } from './prefs';
import { GroupsMap } from '../reference/GroupsMap';
import { ApprovedWidget, CallbackWidget, HelpWidget, ReadyWidget, UrgentWidget } from './Widgets';
import styles from './Today.module.css';

export function TodayScreen() {
  const query = useToday();
  if (query.isPending) return <LoadingState lines={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <TodayContent data={query.data} />;
}

/**
 * «Пульт»: верхний ряд компактных виджетов (число и подпись), под ним таблица на всю ширину.
 */
export function TodayContent({ data }: { data: TodayView; now?: Date }) {
  const groups = useGroups();
  const [prefs, setPrefs] = useMatrixPrefs();
  const [selected, setSelected] = useState<CellRef | null>(null);
  const selectedCell = selected
    ? data.matrix.find((r) => r.district === selected.district)?.cells.find((c) => c.age === selected.age)
    : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <ReadyWidget data={data} />
        <CallbackWidget data={data} />
        <HelpWidget data={data} />
        <ApprovedWidget data={data} />
        <UrgentWidget data={data} />
      </div>

      <section className={`${styles.panel} ${styles.matrixPanel}`} aria-labelledby="today-matrix">
        <h3 id="today-matrix" className={styles.h3}>
          {ru.today.matrixTitle}
        </h3>
        <Matrix data={data} prefs={prefs} onPrefs={setPrefs} selected={selected} onOpen={setSelected} />
      </section>

      {/* Карта групп переехала сюда из «Справочника»: открывать её нужно там, где смотрят, где людям не хватает групп. */}
      <GroupsMap groups={groups.data?.items ?? []} />

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
