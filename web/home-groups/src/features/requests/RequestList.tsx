import type { RequestItem } from '@contracts';
import { BUCKET_LABEL } from '../../entities/buckets';
import { groupLabel, groupLine } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { AgeTag, ConfidenceDots, Pill, StrangeBadge } from '../../shared/ui';
import { DataChanges, useChangesDisclosure } from './DataChanges';
import { SavedTag } from './SavedTag';
import { AssistantTag } from './assistant/AssistantTag';
import { proposalOf } from './model';
import styles from './Requests.module.css';

function proposalText(r: RequestItem) {
  if (r.bucket === 'done') {
    if (r.finalGroup) return `→ ${groupLabel(r.finalGroup)} (${r.finalGroup.leader})`;
    return r.finalGroupText ? `→ ${r.finalGroupText}` : '';
  }
  const proposal = proposalOf(r);
  if (proposal) return groupLine(proposal.main.group);
  return null;
}

/**
 * Метка предложения в строке. Раскрытие подробностей у каждой строки своё, поэтому вынесено в компонент.
 * Панель останавливает клик: строка целиком открывает карточку, а выделить или прочитать текст изменений
 * не должно уводить с места.
 */
function RowTag({ proposal }: { proposal: NonNullable<RequestItem['proposal']> }) {
  const disclosure = useChangesDisclosure();
  return (
    <>
      <SavedTag
        saved={proposal.saved}
        dataChanged={proposal.dataChanged}
        changes={{ open: disclosure.open, onToggle: disclosure.toggle, panelId: disclosure.panelId }}
      />
      {proposal.dataChanged && disclosure.open && (
        <div id={disclosure.panelId} className={styles.changesPanel} onClick={(e) => e.stopPropagation()}>
          <DataChanges changes={proposal.changes} />
        </div>
      )}
    </>
  );
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
  /** null — выбирать нечего (вход «Только чтение»): флажков в строках нет. */
  selection: RowSelection | null;
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
          const proposal = proposalOf(r);
          const confidence = proposal && r.bucket !== 'done' ? (proposal.main.confidence ?? proposal.main.score) : null;
          const picked = selection?.isPicked(r.id) ?? false;
          return (
            <li
              key={r.id}
              className={`${styles.row} ${selectedId === r.id ? styles.selected : ''} ${picked ? styles.picked : ''}`}
              onClick={() => onSelect(r.id)}
            >
              {/* Флажок не открывает карточку: клик не всплывает до строки. Зона нажатия — вся ячейка (44 px). */}
              {selection ? (
                <label className={styles.pick} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={!picked && selection.limitReached}
                    onChange={() => selection.toggle(r.id)}
                    aria-label={ru.requests.bulk.selectRow(r.fio)}
                  />
                </label>
              ) : (
                <span />
              )}
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
                <StrangeBadge mark={r.strange} />
                {/* Закрытым незачем: пол нужен для подбора. */}
                {r.gender.value === null && r.bucket !== 'done' && r.bucket !== 'cancelled' && <Pill tone="warn">{ru.gender.filterMissing}</Pill>}
                {r.ageLabel && <AgeTag>{r.ageLabel}</AgeTag>}
                <span className={styles.place}>{r.place ?? ru.common.placeUnknown}</span>
                <AssistantTag note={r.assistant} />
                {r.responsible && <span className={styles.inWork}>{ru.requests.inWorkBy(r.responsible)}</span>}
              </div>
              <div className={styles.prop}>
                <Pill tone={r.bucket === 'cancelled' ? 'plain' : r.bucket}>{BUCKET_LABEL[r.bucket]}</Pill>
                <div className={styles.propText}>
                  {text ?? <span className={styles.note}>{r.noPlan?.reason ?? ''}</span>}
                  {proposal && r.bucket !== 'done' && <RowTag proposal={proposal} />}
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
