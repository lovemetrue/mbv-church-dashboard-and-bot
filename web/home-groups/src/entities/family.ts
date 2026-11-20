import type { FamilyKind } from '@contracts';
import { ru } from '../shared/i18n/ru';

/**
 * Семейное положение словами — по полу человека (`GenderInfo.value`): мужчине «Холост» / «Женат», женщине
 * «Не замужем» / «Замужем», при неизвестном поле — обе формы через «/». Нет варианта — «не указано».
 */
export function familyLabel(kind: FamilyKind | null, gender: 'м' | 'ж' | null): string {
  return kind ? ru.family.option[kind][gender ?? 'any'] : ru.family.notSet;
}

/** Подписи пунктов выбора в форме правки человека. */
export function familyOptionLabels(gender: 'м' | 'ж' | null): Record<FamilyKind, string> {
  return { single: familyLabel('single', gender), married: familyLabel('married', gender) };
}
