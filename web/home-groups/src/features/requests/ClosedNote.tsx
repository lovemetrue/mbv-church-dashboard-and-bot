import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Requests.module.css';

/**
 * Итог закрытия: «Заявка закрыта: Иван Петров, обработана.» Закрытая карточка уходит с экрана (аннулированная
 * заявка могла пропасть из списка вовсе), поэтому итог остаётся здесь, пока его не скроют.
 * Живая область есть всегда: скринридер объявляет только текст, появившийся в уже существующей области.
 */
export function ClosedNote({ note, onHide }: { note: string | null; onHide: () => void }) {
  return (
    <div role="status" className={note ? styles.closedNote : styles.closedNoteEmpty}>
      {note && (
        <>
          <p>{note}</p>
          <Button variant="ghost" onClick={onHide}>
            {ru.requests.close.hideNote}
          </Button>
        </>
      )}
    </div>
  );
}
