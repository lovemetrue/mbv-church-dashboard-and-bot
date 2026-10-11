import { describe, expect, test } from 'vitest';
import { ru } from './ru';

/** Все строки текстов, в том числе из функций-шаблонов (их вызываем с пробными аргументами). */
function allTexts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    try {
      const result = (node as (...a: unknown[]) => unknown)('x', 'x', 'x');
      if (typeof result === 'string') out.push(result);
    } catch {
      /* шаблон ждёт другие аргументы: его вид нас здесь не интересует */
    }
  } else if (Array.isArray(node)) node.forEach((n) => allTexts(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => allTexts(n, out));
  return out;
}

describe('тексты интерфейса', () => {
  test('нигде не упоминается старый дашборд: он больше не часть работы', () => {
    const offenders = allTexts(ru).filter((t) => /старо\w*\s+дашборд|legacy/i.test(t));
    expect(offenders).toEqual([]);
  });
});
