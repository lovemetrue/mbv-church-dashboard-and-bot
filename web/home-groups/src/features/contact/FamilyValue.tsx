import type { FamilyKind } from '@contracts';
import { familyLabel } from '../../entities/family';
import { ru } from '../../shared/i18n/ru';
import styles from './ContactTools.module.css';

/**
 * Семейное положение в карточке: вариант словами по полу человека, а рядом — как написал сам человек
 * («как написано: «женат, двое детей»»): исходный текст не теряется. null — показывать нечего.
 */
export function familyValue(kind: FamilyKind | null, text: string | null, gender: 'м' | 'ж' | null) {
  if (!kind && !text) return null;
  return (
    <>
      {familyLabel(kind, gender)}
      {text && <span className={styles.familyOriginal}> · {ru.family.original(text)}</span>}
    </>
  );
}
