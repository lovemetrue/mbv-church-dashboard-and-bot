import { useId, useState } from 'react';
import type { DataChange } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import styles from './Requests.module.css';

const c = ru.requests.rematch.changes;

/**
 * Что изменилось в данных заявки после того, как группу предложили.
 *
 * `null` (и отсутствие поля у сервера старой версии) — снимка данных на момент предложения нет: известно только, что
 * данные изменились. Пустой список — изменения были, но потом всё вернулось, так что пересчёт ничего не даст.
 * Значения выводим обычным текстом: это адрес и район человека, разметке в них не место.
 */
export function DataChanges({ changes }: { changes: readonly DataChange[] | null | undefined }) {
  if (!changes) return <p className={styles.changesNote}>{c.noDetails}</p>;
  if (changes.length === 0) return <p className={styles.changesNote}>{c.reverted}</p>;
  return (
    <ul className={styles.changesList} aria-label={c.listLabel}>
      {changes.map((ch, i) => (
        <li key={`${ch.field}-${i}`} className={styles.changesLine}>
          <span className={styles.changesField}>{ch.field}:</span>{' '}
          <span className="visually-hidden">{c.was} </span>
          <Value text={ch.before} old />
          <span aria-hidden="true" className={styles.changesArrow}>
            {' '}
            →{' '}
          </span>
          <span className="visually-hidden">{c.became} </span>
          <Value text={ch.after} />
        </li>
      ))}
    </ul>
  );
}

function Value({ text, old = false }: { text: string | null; old?: boolean }) {
  if (text === null || text === '') return <span className={styles.changesEmpty}>{c.empty}</span>;
  return <span className={old ? styles.changesWas : styles.changesNow}>{text}</span>;
}

/** Раскрытие подробностей: состояние и связь кнопки с панелью для a11y. Панель в дереве только пока открыта. */
export function useChangesDisclosure() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, toggle: () => setOpen((v) => !v), panelId: id };
}
