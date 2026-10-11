import type { RequestItem } from '@contracts';
import { BUCKET_LABEL } from '../../entities/buckets';
import { groupLabel, groupLine } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { AgeTag, ConfidenceDots, Pill } from '../../shared/ui';
import { SavedTag } from './SavedTag';
import { AssistantTag } from './assistant/AssistantTag';
import styles from './Requests.module.css';

function proposalText(r: RequestItem) {
  if (r.bucket === 'done') {
    if (r.finalGroup) return `→ ${groupLabel(r.finalGroup)} (${r.finalGroup.leader})`;
    return r.finalGroupText ? `→ ${r.finalGroupText}` : '';
  }
  if (r.proposal) return groupLine(r.proposal.main.group);
  return null;
}

/** Выбор строк для массовых действий (см. `bulk/useBulk.ts`). */
export interface RowSelection {
  isPicked: (id: number) => boolean;
  toggle: (id: number) => void;
  /** Достигнут предел выбора: невыбранные флажки не нажимаются. */
  limitReached: boolean;
}

interface RequestListProps {
  items: readonly RequestItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  selection: RowSelection;
}

export function RequestList({ items, selectedId, onSelect, selection }: RequestListProps) {
  return (
    <div className={styles.listbox}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span />
        <span>{ru.requests.colPerson}</span>
        <span>{ru.requests.colProposal}</span>
        <span>{ru.requests.colConfidence}</span>
        <span>{ru.requests.colData}</span>
      </div>
      <ul className={styles.rows} aria-label={ru.requests.listLabel}>
        {items.map((r) => {
          const text = proposalText(r);
          const confidence = r.proposal && r.bucket !== 'done' ? (r.proposal.main.confidence ?? r.proposal.main.score) : null;
          const picked = selection.isPicked(r.id);
          return (
            <li
              key={r.id}
              className={`${styles.row} ${selectedId === r.id ? styles.selected : ''} ${picked ? styles.picked : ''}`}
              onClick={() => onSelect(r.id)}
            >
              {/* Флажок не открывает карточку: клик не всплывает до строки. Зона нажатия — вся ячейка (44 px). */}
              <label className={styles.pick} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={picked}
                  disabled={!picked && selection.limitReached}
                  onChange={() => selection.toggle(r.id)}
                  aria-label={ru.requests.bulk.selectRow(r.fio)}
                />
              </label>
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
                <AssistantTag note={r.assistant} />
                {r.responsible && <span className={styles.inWork}>{ru.requests.inWorkBy(r.responsible)}</span>}
              </div>
              <div className={styles.prop}>
                <Pill tone={r.bucket === 'cancelled' ? 'plain' : r.bucket}>{BUCKET_LABEL[r.bucket]}</Pill>
                <div className={styles.propText}>
                  {text ?? <span className={styles.note}>{r.noPlan?.reason ?? ''}</span>}
                  {r.proposal && r.bucket !== 'done' && <SavedTag saved={r.proposal.saved} dataChanged={r.proposal.dataChanged} />}
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
