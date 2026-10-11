import { useId, useMemo } from 'react';
import type { RequestItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { RESP_NOBODY } from '../../shared/nav';
import { responsibleNames } from './model';
import styles from './Requests.module.css';

/**
 * Список «В работе у». Имена берём из всех записей списка, а не из найденных: иначе выбор сам себя сужал бы.
 * Один и тот же для заявок и для «Других обращений»: отбор общий, он живёт в адресе (`resp`).
 */
export function ResponsibleSelect({
  items,
  value,
  onChange,
}: {
  items: readonly Pick<RequestItem, 'responsible'>[];
  value: string;
  onChange: (who: string) => void;
}) {
  const id = useId();
  const names = useMemo(() => responsibleNames(items), [items]);
  // Имя из старой ссылки, которого в очереди уже нет, оставляем в списке: иначе выбор показывал бы
  // «Все», а список при этом был бы пуст.
  const extra = value && value !== RESP_NOBODY && !names.includes(value) ? value : null;
  return (
    <div className={styles.respBox}>
      <label htmlFor={id} className={styles.respLabel}>
        {ru.requests.respFilterLabel}
      </label>
      <select id={id} className={styles.respSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{ru.requests.respFilterAll}</option>
        <option value={RESP_NOBODY}>{ru.requests.respFilterNobody}</option>
        {[...names, ...(extra ? [extra] : [])].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
