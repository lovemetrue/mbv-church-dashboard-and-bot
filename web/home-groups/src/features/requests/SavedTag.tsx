import { ru } from '../../shared/i18n/ru';
import styles from './Requests.module.css';

/** Метка «Закреплено»: закреплённое предложение не изменится само, свежий расчёт может поменяться. */
export function SavedTag({ saved }: { saved: boolean }) {
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
