import { useState } from 'react';
import { groupLabel } from '../../entities/format';
import { useGroups } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button, ErrorState, KeyValue, LoadingState, Modal } from '../../shared/ui';
import { groupDataRows } from './Cards';
import styles from './Reference.module.css';

const t = ru.reference.preview;

/**
 * Карточка группы поверх заявки, только для просмотра: координатор сравнивает предложенные группы, не уходя
 * со своей заявки. Никаких правок и переходов — для этого есть карточка во вкладке «Группы». Окно (Modal), а не
 * шторка: карточка заявки сама шторка, и вторая закрыла бы её.
 */
export function GroupPreview({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const query = useGroups();
  const g = query.data?.items.find((x) => x.id === groupId);
  const title = g ? `Группа ${groupLabel(g)}` : t.loadingTitle;
  return (
    <Modal title={title} onClose={onClose} wide>
      {query.isPending ? (
        <LoadingState lines={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !g ? (
        <p className={styles.note}>{t.gone}</p>
      ) : (
        <>
          <p className={styles.note}>{[g.leader, g.district, g.metro].filter(Boolean).join(' · ')}</p>
          <p className={styles.note}>
            {t.readOnly} · {ru.reference.health}: {ru.reference.healthOf(g.health.score)}
          </p>
          <KeyValue rows={groupDataRows(g)} />
          <h3 className={styles.previewTitle}>{t.members(g.members.length)}</h3>
          {g.members.length ? (
            <ul className={styles.previewMembers}>
              {g.members.map((m) => (
                <li key={`${m.kind}-${m.id}`}>{m.fio}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>{t.noMembers}</p>
          )}
        </>
      )}
    </Modal>
  );
}

/** Кнопка «Карточка группы» рядом с предложенной группой: открывает окно просмотра поверх. */
export function GroupPreviewButton({ groupId, code, compact = false }: { groupId: number; code: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" aria-label={t.openAria(code)} title={t.openAria(code)} onClick={() => setOpen(true)}>
        {compact ? t.openShort : t.open}
      </Button>
      {open && <GroupPreview groupId={groupId} onClose={() => setOpen(false)} />}
    </>
  );
}
