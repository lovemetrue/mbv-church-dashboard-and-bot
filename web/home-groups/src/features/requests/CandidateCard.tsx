import type { Candidate } from '@contracts';
import { groupLabel } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Button, Meter, Reasons } from '../../shared/ui';
import styles from './Requests.module.css';

interface CandidateCardProps {
  candidate: Candidate;
  /** Главное предложение подсвечивается рамкой и не имеет кнопки «Выбрать вместо». */
  main?: boolean;
}

/** Группа-кандидат: шкала уверенности (или совпадения), плашки причин, места. */
export function CandidateCard({ candidate, main = false }: CandidateCardProps) {
  const { group, reasons } = candidate;
  const value = candidate.confidence ?? candidate.score;
  const caption = candidate.confidence != null ? ru.requests.confidence : ru.requests.match;
  const where = [group.district, group.metro, group.whenText].filter(Boolean).join(' · ');
  return (
    <article className={`${styles.cand} ${main ? styles.candTop : ''}`}>
      <div className={styles.candHead}>
        <b>Группа {groupLabel(group)}</b>
        <span className={styles.note}>{[group.leader, group.format].filter(Boolean).join(' · ')}</span>
        <span className={`${styles.candScore} num`}>
          {value}
          <small>{caption}</small>
        </span>
      </div>
      <Meter value={value} label={`${caption}: ${value} из 100`} />
      <Reasons items={reasons} />
      <div className={styles.candFoot}>
        <span className={styles.free}>
          {where ? `${where} · ` : ''}мест: {group.free} из {group.capacity}
        </span>
        {!main && (
          <Button size="sm" soon>
            {ru.requests.pickInstead}
          </Button>
        )}
      </div>
    </article>
  );
}
