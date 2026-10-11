import type { TeamView } from '@contracts';
import { useTeam } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { ErrorState, LoadingState } from '../../shared/ui';
import { CampaignScreen } from '../campaign/CampaignScreen';
import { ActivitySection, AgingSection, StuckSection, Tiles, WorkloadSection } from './TeamSections';
import { ExportSection } from './ExportSection';
import { parseTeamSection, TeamSwitch } from './TeamSwitch';
import styles from './Team.module.css';

/**
 * «Команда»: сегмент разделов («Заявки» по умолчанию, «Кампания «40 дней»») и выбранный раздел.
 * Запрос раздела, который не открыт, не уходит: кампанию читают только те, кто её открыл.
 */
export function TeamScreen() {
  const nav = useAppNav();
  const section = parseTeamSection(nav.section);
  return (
    <>
      <TeamSwitch current={section} />
      {section === 'campaign' ? <CampaignScreen /> : <TeamRequests />}
    </>
  );
}

/**
 * Раздел «Заявки»: сводка для руководителя координаторов. Данные одним запросом `GET /team`, опрос раз в минуту.
 * Если фоновое обновление не удалось, а прежние данные есть, они остаются на экране с короткой пометкой:
 * пропадать из-за сбоя сети сводке незачем.
 */
function TeamRequests() {
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
