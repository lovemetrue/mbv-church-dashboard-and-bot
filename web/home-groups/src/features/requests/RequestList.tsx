import type { RequestItem } from '@contracts';
import { BUCKET_LABEL } from '../../entities/buckets';
import { groupLabel, groupLine } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { AgeTag, ConfidenceDots, Pill } from '../../shared/ui';
import styles from './Requests.module.css';

function proposalText(r: RequestItem) {
  if (r.bucket === 'done') {
    if (r.finalGroup) return `→ ${groupLabel(r.finalGroup)} (${r.finalGroup.leader})`;
    return r.finalGroupText ? `→ ${r.finalGroupText}` : '';
  }
  if (r.proposal) return groupLine(r.proposal.main.group);
  return null;
}

interface RequestListProps {
  items: readonly RequestItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function RequestList({ items, selectedId, onSelect }: RequestListProps) {
  return (
    <div className={styles.listbox}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span>{ru.requests.colPerson}</span>
        <span>{ru.requests.colProposal}</span>
        <span>{ru.requests.colConfidence}</span>
        <span>{ru.requests.colData}</span>
      </div>
      <ul className={styles.rows} aria-label={ru.requests.listLabel}>
        {items.map((r) => {
          const text = proposalText(r);
          const confidence = r.proposal && r.bucket !== 'done' ? (r.proposal.main.confidence ?? r.proposal.main.score) : null;
          return (
            <li
              key={r.id}
              className={`${styles.row} ${selectedId === r.id ? styles.selected : ''}`}
              onClick={() => onSelect(r.id)}
            >
              <div className={styles.who}>
                <button
                  type="button"
                  className={styles.nameBtn}
                  aria-current={selectedId === r.id ? 'true' : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(r.id);
                  }}
                >
                  {r.fio}
                </button>
                {r.ageLabel && <AgeTag>{r.ageLabel}</AgeTag>}
                <span className={styles.place}>{r.place ?? ru.common.placeUnknown}</span>
              </div>
              <div className={styles.prop}>
                <Pill tone={r.bucket === 'cancelled' ? 'plain' : r.bucket}>{BUCKET_LABEL[r.bucket]}</Pill>
                <div className={styles.propText}>
                  {text ?? <span className={styles.note}>{r.noPlan?.reason ?? ''}</span>}
                </div>
              </div>
              <div className={`${styles.conf} num`}>
                {confidence !== null && (
                  <>
                    <span className="visually-hidden">{ru.requests.confidence}: </span>
                    {confidence}
                  </>
                )}
              </div>
              <div className={styles.dots}>
                <ConfidenceDots fill={r.dataFill} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
