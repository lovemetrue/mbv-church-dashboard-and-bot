import { useId } from 'react';
import { ru } from '../../shared/i18n/ru';
import { SectionHead } from './SectionHead';
import styles from './Settings.module.css';

const t = ru.settings.users;

/** Заглушка: личные входы и права появятся позже, сейчас в разделе ничего не редактируется. */
export function UsersSection() {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <SectionHead id={titleId} title={t.title} />
      <p>{t.lead}</p>
      <ul className={styles.plainList}>
        <li>{t.basic}</li>
        <li>{t.full}</li>
      </ul>
      <p className={styles.muted}>{t.later}</p>
    </section>
  );
}
