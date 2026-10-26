/**
 * Демо-состояние пола человека. На сервере пол выводится из ФИО (`src/core/gender.ts`), а поставленный служителем или
 * моделью его перекрывает. В демо вывод упрощён: первое слово ФИО на «-а»/«-я» — женщина, иначе мужчина. Станислав Ким
 * (заявка № 8) оставлен без пола нарочно — так виден «Пол не указан». Правки живут в модуле, как метка «Странный человек».
 */
import type { GenderInfo } from '@contracts';

/** Без пола «с самого начала»: показать подсветку и прогон моделью. */
const UNKNOWN = new Set(['r8']);
/** Что «подсказала модель» в прошлый раз: Дарья Ефимова (u1). */
const SEED_AI: Record<string, 'м' | 'ж'> = { u1: 'ж' };

const edits = new Map<string, { value: 'м' | 'ж'; by: 'manual' | 'ai' } | null>();

export function resetDemoGender(): void {
  edits.clear();
}

export function demoGenderOf(key: string, fio: string): GenderInfo {
  const own = edits.get(key);
  if (own) return own;
  if (SEED_AI[key] && !edits.has(key)) return { value: SEED_AI[key]!, by: 'ai' };
  if (UNKNOWN.has(key)) return { value: null, by: null };
  const first = fio.trim().split(/\s+/)[0] ?? '';
  return { value: /[ая]$/i.test(first) ? 'ж' : 'м', by: 'fio' };
}

/** Поставить пол (null — снова из ФИО). */
export function setDemoGender(key: string, value: 'м' | 'ж' | null): void {
  edits.set(key, value ? { value, by: 'manual' } : null);
}

/** «Прогон моделью» в демо: тем, у кого пола нет, модель «подсказывает» мужской. */
export function fillDemoGenderWithAi(unknownKeys: readonly string[]): number {
  for (const k of unknownKeys) edits.set(k, { value: 'м', by: 'ai' });
  return unknownKeys.length;
}
