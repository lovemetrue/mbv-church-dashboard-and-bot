import { useId } from 'react';
import type { Pairs } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { AgeTag, Button, Reasons } from '../../../shared/ui';
import styles from './Others.module.css';

const t = ru.requests.pairs;

/**
 * Кого с кем соединить: в карточке «даёт дом» — кто рядом хочет открыть группу (вести), в карточке «хочет открыть
 * группу» — дома рядом. Совпадение — та же оценка, что в подборе (место, возраст, время). Соединяют люди при звонке:
 * отсюда только переход в обращение второго человека.
 */
export function PairsBlock({ p }: { p: Pairs }) {
  const nav = useAppNav();
  const titleId = useId();
  const leaders = p.side === 'leaders';
  return (
    <section className={styles.prospects} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.prospectsTitle}>
        {leaders ? t.leadersTitle : t.homesTitle}
      </h3>
      <p className={styles.note}>{leaders ? t.leadersHint : t.homesHint}</p>
      {p.total === 0 ? (
        <p className={styles.prospectsCount}>{t.none}</p>
      ) : (
        <>
          <p className={styles.prospectsCount}>{t.count(p.total)}</p>
          <ul className={styles.prospectList} aria-label={leaders ? t.leadersTitle : t.homesTitle}>
            {p.items.map((x) => (
              <li key={x.requestId} className={styles.prospectRow}>
                <div className={styles.prospectMain}>
                  <b>{x.fio}</b> {x.ageLabel && <AgeTag>{x.ageLabel}</AgeTag>}
                  {x.place && <span className={styles.note}> · {x.place}</span>}
                  <span className={`${styles.prospectScore} num`} title={t.scoreTitle}>
                    {x.score}
                  </span>
                </div>
                <Reasons items={x.reasons} />
                <div className={styles.prospectFoot}>
                  <span className={styles.note}>{x.ownGroup ? t.ownGroup(x.ownGroup.code) : ''}</span>
                  <Button size="sm" aria-label={t.openAria(x.fio)} onClick={() => nav.selectRequest(x.requestId)}>
                    {t.open}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {p.total > p.items.length && <p className={styles.note}>{t.more(p.total - p.items.length)}</p>}
        </>
      )}
    </section>
  );
}
