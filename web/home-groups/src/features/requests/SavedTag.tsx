import { ru } from '../../shared/i18n/ru';
import styles from './Requests.module.css';

interface SavedTagProps {
  saved: boolean;
  /** Данные заявки изменились после закрепления: «Закреплено» устарело, группа ещё не пересчитана. */
  dataChanged?: boolean;
  /** В карточке пояснение уже написано рядом полным текстом, второй раз его читать не нужно. */
  explained?: boolean;
}

/**
 * Метка «Закреплено»: закреплённое предложение не изменится само, свежий расчёт может поменяться.
 * Если после закрепления поправили район, возраст, время или улицу, вместо неё стоит «Данные
 * изменились»: группа считалась по прежним данным, и «Закреплено» вводило бы в заблуждение.
 */
export function SavedTag({ saved, dataChanged = false, explained = false }: SavedTagProps) {
  if (dataChanged) {
    const hint = ru.requests.rematch.changedHint;
    return (
      <span className={`${styles.savedTag} ${styles.changedTag}`} title={hint}>
        {ru.requests.rematch.changedTag}
        {!explained && <span className="visually-hidden">. {hint}</span>}
      </span>
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
