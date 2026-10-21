import { useId } from 'react';
import type { Prospects } from '@contracts';
import { FORMS, plural } from '../../../entities/plural';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { AgeTag, Button, Reasons } from '../../../shared/ui';
import { GroupPreviewButton } from '../../reference/GroupPreview';
import styles from './Others.module.css';

const t = ru.requests.prospects;

/**
 * «Кого можно направить» у обращения «хочу открыть группу»: координатор при звонке говорит человеку «могли бы
 * направить к вам N человек» или «пока не видим людей рядом». Считаются все открытые «хочу в группу», кому будущая
 * группа подходит; кому подбор уже предложил другую — с её кодом. Направлять отсюда нельзя: это подсказка для
 * разговора, а распределяют в «Хотят в группу».
 */
export function ProspectsBlock({ p }: { p: Prospects }) {
  const nav = useAppNav();
  const titleId = useId();
  return (
    <section className={styles.prospects} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.prospectsTitle}>
        {t.title}
      </h3>
      {p.futureGroup && (
        <p className={styles.note}>
          {t.byGroup(p.futureGroup.code)} <GroupPreviewButton groupId={p.futureGroup.id} code={p.futureGroup.code} compact />
        </p>
      )}
      {p.unknownPlace ? (
        <p className={styles.note}>{t.unknownPlace}</p>
      ) : p.total === 0 ? (
        <p className={styles.prospectsCount}>{t.none}</p>
      ) : (
        <>
          <p className={styles.prospectsCount}>{t.count(plural(p.total, FORMS.person))}</p>
          <ul className={styles.prospectList}>
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
                  <span className={styles.note}>{x.proposed ? t.proposed(x.proposed) : t.notProposed}</span>
                  <Button size="sm" aria-label={t.openAria(x.fio)} onClick={() => nav.openRequest(x.requestId)}>
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
