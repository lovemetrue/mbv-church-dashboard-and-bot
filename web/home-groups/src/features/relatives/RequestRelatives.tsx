import type { PersonRelative } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button, DrawerSection } from '../../shared/ui';
import list from '../manage/members/Members.module.css';

const t = ru.relatives;

/**
 * Родственники человека заявки — коротким списком со ссылками на их карточки в «Людях» (связывают там же). Список
 * приходит в самой заявке (`RequestItem.relatives`): экран заявок справочник «Людей» не читает. Нет — блока нет.
 */
export function RequestRelatives({ relatives }: { relatives: readonly PersonRelative[] }) {
  const nav = useAppNav();
  if (relatives.length === 0) return null;
  return (
    <DrawerSection title={t.inRequest}>
      <ul className={list.list} aria-label={t.inRequest}>
        {relatives.map((r) => (
          <li key={r.id} className={list.row}>
            <span className={list.who}>
              <span className={list.name}>{r.fio}</span>
              <span className={list.meta}>{t.kind[r.kind]}</span>
            </span>
            <span className={list.rowActions}>
              <Button size="sm" aria-label={t.openAria(r.fio)} onClick={() => nav.openPerson(r.key)}>
                {t.open}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}
