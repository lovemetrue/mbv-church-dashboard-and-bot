/**
 * Логин по ФИО: первая буква имени, «_», фамилия латиницей — «Полина Иванова» → `p_ivanova`.
 * Порядок слов в ФИО у нас «Имя Фамилия» (так спрашивает бот); если слов больше двух, фамилия — последнее.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('').replace(/[^a-z0-9]/g, '');
}

/** Основа логина без проверки занятости; null — из ФИО не получилось (нет имени или фамилии). */
export function baseLogin(fullName: string): string | null {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const first = transliterate(words[0]!).slice(0, 1);
  const last = transliterate(words[words.length - 1]!);
  return first && last ? `${first}_${last}` : null;
}

/** Первый свободный логин: `p_ivanova`, затем `p_ivanova2`, `p_ivanova3`… */
export function freeLogin(base: string, taken: ReadonlySet<string>): string {
  const used = new Set([...taken].map((l) => l.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Допустимый логин: латиница, цифры, «_», «.», «-»; 3–40 знаков. */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,39}$/;
