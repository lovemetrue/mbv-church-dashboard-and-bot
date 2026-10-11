import type { TeamView } from '@contracts';
import { useTeam } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { ErrorState, LoadingState } from '../../shared/ui';
import { ActivitySection, AgingSection, StuckSection, Tiles, WorkloadSection } from './TeamSections';
import { ExportSection } from './ExportSection';
import styles from './Team.module.css';

/**
 * «Команда»: сводка для руководителя координаторов. Данные одним запросом `GET /team`, опрос раз в минуту.
 * Если фоновое обновление не удалось, а прежние данные есть, они остаются на экране с короткой пометкой:
 * пропадать из-за сбоя сети сводке незачем.
 */
export function TeamScreen() {
  const query = useTeam();
  if (query.data === undefined) {
    if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    return <LoadingState lines={6} />;
  }
  return (
    <>
      {query.isError && (
        <p className={styles.stale} role="alert">
          {ru.team.staleError}
        </p>
      )}
      <TeamContent data={query.data} />
    </>
  );
}

export function TeamContent({ data }: { data: TeamView }) {
  return (
    <div className={styles.page}>
      <Tiles totals={data.totals} />
      <div className={styles.grid}>
        <AgingSection aging={data.aging} />
        <WorkloadSection workload={data.workload} />
        <StuckSection stuck={data.stuck} />
        <ActivitySection activity={data.activity} />
      </div>
      <ExportSection />
    </div>
  );
}
