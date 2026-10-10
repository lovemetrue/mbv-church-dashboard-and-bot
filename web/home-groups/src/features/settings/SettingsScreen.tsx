import { useRef } from 'react';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { AuditSection } from './AuditSection';
import { ErrorsSection } from './ErrorsSection';
import { HealthSection } from './HealthSection';
import { PromptsSection } from './PromptsSection';
import { UsersSection } from './UsersSection';
import styles from './Settings.module.css';

export const SECTION_IDS = ['health', 'errors', 'audit', 'prompts', 'users'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
const DEFAULT_SECTION: SectionId = 'health';

export function parseSection(v: string | null): SectionId {
  return (SECTION_IDS as readonly string[]).includes(v ?? '') ? (v as SectionId) : DEFAULT_SECTION;
}

/** Разделы, которые после первого открытия не размонтируются, а прячутся: в них бывает несохранённая правка. */
const KEEP_MOUNTED: ReadonlySet<SectionId> = new Set(['prompts']);

const VIEWS: Record<SectionId, () => JSX.Element> = {
  health: HealthSection,
  errors: ErrorsSection,
  audit: AuditSection,
  prompts: PromptsSection,
  users: UsersSection,
};

/**
 * Раздел «Настройки»: слева (на телефоне сверху) вертикальный список разделов, рядом — выбранный.
 * Раздел запоминается в адресе (`sec`), как и вкладки: на него можно дать ссылку, а перезагрузка
 * не сбрасывает человека на первый.
 */
export function SettingsScreen() {
  const nav = useAppNav();
  const current = parseSection(nav.section);
  // Переход по списку разделов не должен стереть длинный набранный текст инструкции, поэтому
  // раздел с правками остаётся в дереве, пока человек в «Настройках». Опрос у него редкий.
  const visited = useRef(new Set<SectionId>());
  visited.current.add(current);
  return (
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label={ru.settings.navLabel}>
        {SECTION_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.navBtn}
            aria-current={id === current ? 'page' : undefined}
            onClick={() => nav.update({ sec: id === DEFAULT_SECTION ? null : id })}
          >
            {ru.settings.sections[id]}
          </button>
        ))}
      </nav>
      <div className={styles.content}>
        {SECTION_IDS.filter((id) => id === current || (KEEP_MOUNTED.has(id) && visited.current.has(id))).map((id) => {
          const View = VIEWS[id];
          return (
            <div key={id} hidden={id !== current}>
              <View />
            </div>
          );
        })}
      </div>
    </div>
  );
}
