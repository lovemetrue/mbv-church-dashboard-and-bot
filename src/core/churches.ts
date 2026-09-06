/**
 * Варианты ответа на вопрос «Какую церковь вы посещаете?».
 *
 * Два уровня: сначала общий список, и если человек выбрал «Другая церковь» —
 * подсписок конкретных церквей, с которыми у нас есть общение.
 *
 * Оба списка настраиваются переменными окружения (через точку с запятой): церкви
 * добавляются и уточняются без участия разработчика. Названия «Созвездие» и
 * «Миссия Свет Христа» в правках стояли под вопросом — их можно поправить
 * в OTHER_CHURCHES, не трогая код.
 */
const DEFAULT_MBV = ['МБВ Колизей', 'МБВ Филиалы', 'МБВ онлайн'];

const DEFAULT_OTHER = [
  'Церковь «Иисуса Христа» г. Кингисепп',
  'Церковь «Созвездие»',
  'Церковь «Миссия Свет Христа»',
];

/** Ответы, после которых человек считается не из МБВ. */
export const OTHER_CHURCH = 'Другая церковь';
export const NO_CHURCH = 'Не посещаю церковь';
/** Последний пункт подсписка: церкви нет в перечне. */
export const OTHER_CHURCH_ELSE = 'Другая';

function fromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Первый экран: церкви МБВ, затем «другая» и «не посещаю». */
export function churchOptions(): string[] {
  return [...fromEnv('CHURCH_BRANCHES', DEFAULT_MBV), OTHER_CHURCH, NO_CHURCH];
}

/** Второй экран: показывается только тем, кто выбрал «Другая церковь». */
export function otherChurchOptions(): string[] {
  return [...fromEnv('OTHER_CHURCHES', DEFAULT_OTHER), OTHER_CHURCH_ELSE];
}

/**
 * Человек из МБВ: только ему предлагают вести или открывать группу.
 *
 * Остальным задают тот же вопрос, но с двумя вариантами — узнать про группы
 * и присоединиться: звать вести группу человека из другой церкви преждевременно.
 */
export function attendsMbv(church: string | null | undefined): boolean {
  return !!church && fromEnv('CHURCH_BRANCHES', DEFAULT_MBV).includes(church);
}

/** Вариант по индексу из callback-кнопки. Индекс, а не текст: в Telegram у callback лимит 64 байта. */
export function churchByIndex(index: number): string | null {
  return churchOptions()[index] ?? null;
}

export function otherChurchByIndex(index: number): string | null {
  return otherChurchOptions()[index] ?? null;
}
