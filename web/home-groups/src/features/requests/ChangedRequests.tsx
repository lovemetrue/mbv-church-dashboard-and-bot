import type { RequestItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Modal } from '../../shared/ui';
import { DataChanges } from './DataChanges';
import styles from './Requests.module.css';

const c = ru.requests.rematch.changes;

/**
 * Окно «Заявки с изменившимися данными»: откуда пришло новое (человек или бот дописали район, возраст, время, улицу)
 * видно по строкам «было → стало». Имя ведёт в карточку заявки, где её можно пересчитать.
 */
export function ChangedRequests({
  items,
  onOpen,
  onClose,
}: {
  items: readonly RequestItem[];
  /** Открыть карточку заявки; окно закрывается тем же действием. */
  onOpen: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={c.title} onClose={onClose}>
      <p className={styles.changesIntro}>{c.intro}</p>
      <ul className={styles.changedRequests}>
        {items.map((r) => (
          <li key={r.id} className={styles.changedRequest}>
            <button
              type="button"
              className={styles.changedRequestLink}
              aria-label={c.openCard(r.fio, r.id)}
              onClick={() => onOpen(r.id)}
            >
              {r.fio}
              <span className={styles.changedRequestNo}> {c.requestNumber(r.id)}</span>
            </button>
            <DataChanges changes={r.proposal?.changes} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
