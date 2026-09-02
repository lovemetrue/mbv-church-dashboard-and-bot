/**
 * Варианты ответа на вопрос «Посещаете ли церковь МБВ?».
 *
 * Список задаётся переменной CHURCH_BRANCHES (через точку с запятой), потому что
 * филиалы добавляются и закрываются без участия разработчика. В ТЗ перечень был
 * не дописан («Филиал 3», «…»), поэтому по умолчанию стоят известные.
 */
const DEFAULT_BRANCHES = ['МБВ (Колизей)', 'МБВ (Филиал Серебристый)', 'МБВ (Филиал Купчино)', 'МБВ - Онлайн'];

/** Ответы, после которых вопрос про домашнюю группу не задаётся. */
export const OTHER_CHURCH = 'Другая церковь';
export const NO_CHURCH = 'Не посещаю церковь';

function branches(): string[] {
  const raw = process.env.CHURCH_BRANCHES?.trim();
  if (!raw) return DEFAULT_BRANCHES;
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Все варианты ответа по порядку: филиалы, затем «другая» и «не посещаю». */
export function churchOptions(): string[] {
  return [...branches(), OTHER_CHURCH, NO_CHURCH];
}

/** Человек из МБВ: только им задаём вопрос про домашнюю группу. */
export function attendsMbv(church: string | null | undefined): boolean {
  return !!church && church !== OTHER_CHURCH && church !== NO_CHURCH;
}

/** Вариант по индексу из callback-кнопки. Индекс, а не текст: в Telegram у callback лимит 64 байта. */
export function churchByIndex(index: number): string | null {
  return churchOptions()[index] ?? null;
}
