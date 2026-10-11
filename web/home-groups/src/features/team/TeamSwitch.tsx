import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import styles from './Team.module.css';

export type TeamSectionId = 'requests' | 'campaign';

/** Раздел «Команды» из адреса (`sec`). Всё, кроме `campaign`, — сегодняшний экран «Заявки». */
export function parseTeamSection(v: string | null): TeamSectionId {
  return v === 'campaign' ? 'campaign' : 'requests';
}

const SECTIONS: readonly TeamSectionId[] = ['requests', 'campaign'];

/**
 * Сегмент «Заявки | Кампания «40 дней»» вверху «Команды». Это не новая вкладка, а выбор внутри вкладки,
 * поэтому состояние живёт в адресе (`sec=campaign`), а обычный экран — без параметра: ссылки на «Команду»,
 * сделанные раньше, открывают то же, что и прежде.
 */
export function TeamSwitch({ current }: { current: TeamSectionId }) {
  const nav = useAppNav();
  const t = ru.team.sections;
  return (
    <div className={styles.switch} role="group" aria-label={t.label}>
      {SECTIONS.map((id) => (
        <button
          key={id}
          type="button"
          className={styles.switchBtn}
          aria-pressed={id === current}
          onClick={() => nav.update({ sec: id === 'requests' ? null : id })}
        >
          {t[id]}
        </button>
      ))}
    </div>
  );
}
