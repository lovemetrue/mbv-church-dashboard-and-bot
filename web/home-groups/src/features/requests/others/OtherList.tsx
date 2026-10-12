import type { OtherItem } from '@contracts';
import { formatPhone } from '../../../entities/format';
import { ru } from '../../../shared/i18n/ru';
import { AgeTag, Pill, type PillTone } from '../../../shared/ui';
import styles from './Others.module.css';

const o = ru.requests.others;

export const STATE_LABEL: Record<OtherItem['state'], string> = {
  open: o.stateOpen,
  done: o.stateDone,
  cancelled: o.stateCancelled,
};
/** Цвет только подсвечивает: смысл всегда сказан словом на плашке. */
export const STATE_TONE: Record<OtherItem['state'], PillTone> = { open: 'warn', done: 'ok', cancelled: 'plain' };

/**
 * Список «Других обращений». Строка: человек, тип с меткой состояния, телефон и срок ожидания; второй строкой — суть
 * обращения (не больше двух строк, остальное обрезается: целиком она в карточке).
 * Флажков для массовых действий нет: обращений мало, и каждое требует отдельного решения.
 */
export function OtherList({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly OtherItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className={styles.listbox}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span>{o.colPerson}</span>
        <span>{o.colType}</span>
        <span>{o.colPhone}</span>
      </div>
      <ul className={styles.rows} aria-label={o.listLabel}>
        {items.map((it) => (
          <li
            key={it.id}
            className={`${styles.row} ${selectedId === it.id ? styles.selected : ''}`}
            onClick={() => onSelect(it.id)}
          >
            <div className={styles.who}>
              <button
                type="button"
                className={styles.nameBtn}
                aria-current={selectedId === it.id ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(it.id);
                }}
              >
                {it.fio}
              </button>
              {it.ageLabel && <AgeTag>{it.ageLabel}</AgeTag>}
              <span className={styles.place}>{it.place ?? ru.common.placeUnknown}</span>
              {it.responsible && <span className={styles.inWork}>{ru.requests.inWorkBy(it.responsible)}</span>}
            </div>
            <div className={styles.kind}>
              <span className={styles.type}>{it.typeLabel}</span>
              <span className={styles.pills}>
                <Pill tone={STATE_TONE[it.state]}>{STATE_LABEL[it.state]}</Pill>
                {it.state === 'open' && it.callback && <Pill tone="callback">{o.callback}</Pill>}
              </span>
            </div>
            <div className={styles.contact}>
              {it.phone ? <span className="num">{formatPhone(it.phone)}</span> : <span className={styles.note}>{o.noPhone}</span>}
              {it.state === 'open' && it.waitingDays != null && <span className={styles.note}>{o.waits(it.waitingDays)}</span>}
            </div>
            {it.gist && <p className={styles.gist}>{it.gist}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
