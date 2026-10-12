import { ru } from '../../shared/i18n/ru';
import styles from './Requests.module.css';

/** Раскрытие «что именно изменилось» под меткой «Данные изменились»; без него метка остаётся просто подписью. */
export interface ChangesToggle {
  open: boolean;
  onToggle: () => void;
  /** Идентификатор панели с подробностями: на неё указывает aria-controls. */
  panelId: string;
}

interface SavedTagProps {
  saved: boolean;
  /** Данные заявки изменились после закрепления: «Закреплено» устарело, группа ещё не пересчитана. */
  dataChanged?: boolean;
  /** В карточке пояснение уже написано рядом полным текстом, второй раз его читать не нужно. */
  explained?: boolean;
  /** Если задано, «Данные изменились» — кнопка, которая раскрывает, что именно изменилось. */
  changes?: ChangesToggle;
}

/**
 * Метка «Закреплено»: закреплённое предложение не изменится само, свежий расчёт может поменяться.
 * Если после закрепления поправили район, возраст, время или улицу, вместо неё стоит «Данные
 * изменились»: группа считалась по прежним данным, и «Закреплено» вводило бы в заблуждение.
 * Человек или бот мог прислать новое, поэтому метку можно раскрыть и увидеть, что именно изменилось.
 */
export function SavedTag({ saved, dataChanged = false, explained = false, changes }: SavedTagProps) {
  if (dataChanged) {
    const hint = ru.requests.rematch.changedHint;
    const className = `${styles.savedTag} ${styles.changedTag}`;
    const hidden = !explained && <span className="visually-hidden">. {hint}</span>;
    if (!changes) {
      return (
        <span className={className} title={hint}>
          {ru.requests.rematch.changedTag}
          {hidden}
        </span>
      );
    }
    const hintId = `${changes.panelId}-hint`;
    return (
      <>
        <button
          type="button"
          className={`${className} ${styles.changedToggle}`}
          title={ru.requests.rematch.changes.toggleHint}
          aria-expanded={changes.open}
          aria-controls={changes.open ? changes.panelId : undefined}
          aria-describedby={explained ? undefined : hintId}
          // Строка списка открывает карточку по клику: раскрытие подробностей — не выбор заявки.
          onClick={(e) => {
            e.stopPropagation();
            changes.onToggle();
          }}
        >
          {ru.requests.rematch.changedTag}
          <span className={styles.changedCaret} aria-hidden="true">
            {changes.open ? '▴' : '▾'}
          </span>
        </button>
        {/* Пояснение вне кнопки: иначе оно вошло бы в её имя. */}
        {!explained && (
          <span id={hintId} className="visually-hidden">
            {hint}
          </span>
        )}
      </>
    );
  }
  return (
    <span
      className={`${styles.savedTag} ${saved ? styles.savedOn : ''}`}
      title={saved ? ru.requests.savedHint : ru.requests.unsavedHint}
    >
      {saved ? ru.requests.saved : ru.requests.unsaved}
      {/* Подсказка не только при наведении: на телефоне и со скринридером title не виден. */}
      <span className="visually-hidden">. {saved ? ru.requests.savedHint : ru.requests.unsavedHint}</span>
    </span>
  );
}
