import type { TodayView } from '@contracts';
import { useState } from 'react';
import { useToday } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Collapsible, ErrorState, LoadingState } from '../../shared/ui';
import { CellPanel } from './CellPanel';
import { Matrix, type CellRef } from './Matrix';
import { useMatrixPrefs } from './prefs';
import { GroupsMap } from '../reference/GroupsMap';
import { HelpCallbackWidget, ReadyApprovedWidget, TotalWidget, UrgentWidget } from './Widgets';
import styles from './Today.module.css';

export function TodayScreen() {
  const query = useToday();
  if (query.isPending) return <LoadingState lines={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <TodayContent data={query.data} />;
}

/** Браузер помнит, раскрыта ли таблица по районам (localStorage, как остальные личные настройки). */
export const MATRIX_OPEN_KEY = 'hg.today.matrixOpen';

/**
 * «Пульт»: верхний ряд компактных виджетов (число и подпись), под ним карта групп, ниже — сворачиваемая таблица по районам
 * (по умолчанию свёрнута: смотрят её реже, чем карту).
 */
export function TodayContent({ data }: { data: TodayView; now?: Date }) {
  const [prefs, setPrefs] = useMatrixPrefs();
  const [selected, setSelected] = useState<CellRef | null>(null);
  const selectedCell = selected
    ? data.matrix.find((r) => r.district === selected.district)?.cells.find((c) => c.age === selected.age)
    : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <TotalWidget data={data} />
        <ReadyApprovedWidget data={data} />
        <HelpCallbackWidget data={data} />
        <UrgentWidget data={data} />
      </div>

      {/* Карта сразу под виджетами: где группы есть физически, смотрят чаще, чем таблицу. */}
      <GroupsMap />

      <Collapsible title={ru.today.matrixTitle} storageKey={MATRIX_OPEN_KEY} className={`${styles.panel} ${styles.matrixPanel}`}>
        <Matrix data={data} prefs={prefs} onPrefs={setPrefs} selected={selected} onOpen={setSelected} />
      </Collapsible>

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
