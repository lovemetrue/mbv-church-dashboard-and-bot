import { useId, useState, type ChangeEvent } from 'react';
import type { RequestItem } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button } from '../../../shared/ui';
import { useFormMeta } from '../../create/useFormMeta';
import styles from './work.module.css';
import { WorkNoticeLine } from './WorkNotice';
import type { RequestWorkState } from './useRequestWork';

const w = ru.requests.work;

/** «В работе у»: сохраняется сразу по выбору, отдельной кнопки нет. */
export function AssignSelect({ r, work }: { r: RequestItem; work: RequestWorkState }) {
  const headId = useId();
  const meta = useFormMeta();
  // Выбранное, пока запрос идёт: без этого список на миг прыгал бы обратно на прежнего координатора.
  const [chosen, setChosen] = useState<string | null>(null);

  const current = r.responsible ?? '';
  const coordinators = meta.data?.coordinators ?? [];
  // Бывший координатор или имя из таблицы может отсутствовать в справочнике: показываем его как есть.
  const extra = current && !coordinators.includes(current) ? [current] : [];
  const value = chosen ?? current;

  const change = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setChosen(next);
    await work.assign(next || null);
    // После успеха список уже перечитан, после ошибки возвращаемся к прежнему.
    setChosen(null);
  };

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {w.assignLabel}
      </h4>
      <select
        className={styles.select}
        aria-labelledby={headId}
        value={value}
        disabled={work.pending || meta.isPending || meta.isError}
        onChange={(e) => void change(e)}
      >
        <option value="">{w.assignNobody}</option>
        {[...extra, ...coordinators].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {work.pending && chosen !== null && <p className={styles.hint}>{w.assignSaving}</p>}
      {meta.isPending && <p className={styles.hint}>{w.assignLoading}</p>}
      {meta.isError && (
        <div className={styles.row}>
          <p className={styles.hint}>{w.assignListFailed}</p>
          <Button onClick={() => void meta.refetch()}>{ru.states.retry}</Button>
        </div>
      )}
      <WorkNoticeLine notice={work.notice} block="assign" />
    </section>
  );
}
