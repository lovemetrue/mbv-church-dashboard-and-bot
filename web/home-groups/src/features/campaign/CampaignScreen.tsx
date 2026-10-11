import type { CampaignView } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui';
import { BroadcastsSection, DaysSection, MdgSection, PlatformsSection, Tiles } from './CampaignSections';
import styles from './Campaign.module.css';
import { isNotConfigured, useCampaign } from './useCampaign';

const t = ru.campaign;

/**
 * Раздел «Кампания «40 дней»» в «Команде»: только чтение. Если фоновое обновление не удалось, а прежние
 * данные есть, они остаются на экране с короткой пометкой.
 */
export function CampaignScreen() {
  const query = useCampaign();
  if (query.data === undefined) {
    if (query.isError) {
      // Расписание не задано — не сбой: повторять нечего, пока его не зададут в боте.
      if (isNotConfigured(query.error)) return <EmptyState hint={t.notConfiguredHint}>{t.notConfigured}</EmptyState>;
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    return <LoadingState lines={6} />;
  }
  return (
    <>
      {query.isError && (
        <p className={styles.stale} role="alert">
          {t.staleError}
        </p>
      )}
      <CampaignContent data={query.data} />
    </>
  );
}

export function CampaignContent({ data }: { data: CampaignView }) {
  return (
    <div className={styles.page}>
      <Tiles data={data} />
      <div className={styles.grid}>
        <MdgSection mdg={data.mdg} />
        <PlatformsSection platforms={data.byPlatform} />
      </div>
      <DaysSection days={data.days} />
      <BroadcastsSection broadcasts={data.broadcasts} />
      <p className={styles.note}>{t.botNote}</p>
    </div>
  );
}
