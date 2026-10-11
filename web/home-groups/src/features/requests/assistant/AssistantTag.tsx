import type { AssistantNote } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import styles from '../Requests.module.css';

/**
 * Маленькая метка «Помощник» в строке списка: часть данных определил он, а не скрипт, их стоит проверить.
 * Только когда он что-то определил: одни вопросы без определённых полей на запись не влияют и строку не загромождают.
 */
export function AssistantTag({ note }: { note: AssistantNote | null }) {
  if (!note || note.filled.length === 0) return null;
  return (
    <span className={styles.assistantTag} title={ru.requests.assistant.tagHint}>
      {ru.requests.assistant.tag}
    </span>
  );
}
