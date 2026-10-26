import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button } from '../../../shared/ui';
import styles from '../Requests.module.css';

/** «Карточка человека»: из заявки или обращения — в «Люди», где видны все его группы и заявки. */
export function PersonLink({ personKey, fio }: { personKey: string | null; fio: string }) {
  const nav = useAppNav();
  if (!personKey) return null;
  return (
    <div className={styles.personLink}>
      <Button size="sm" aria-label={ru.requests.openPersonAria(fio)} onClick={() => nav.openPerson(personKey)}>
        {ru.requests.openPerson}
      </Button>
    </div>
  );
}
