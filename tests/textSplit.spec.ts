import { describe, expect, test } from 'vitest';
import { splitLongText } from '../src/core/split.js';

describe('splitLongText', () => {
  test('короткий текст остаётся одним сообщением', () => {
    expect(splitLongText('Слово дня', 100)).toEqual(['Слово дня']);
  });

  test('длинный текст режется на части не больше лимита', () => {
    const parts = splitLongText('а'.repeat(250), 100);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
  });

  test('текст режется по переводу строки, а не посреди абзаца', () => {
    const text = `${'а'.repeat(60)}\n${'б'.repeat(60)}`;
    const parts = splitLongText(text, 80);
    expect(parts[0]).toBe('а'.repeat(60));
    expect(parts[1]).toBe('б'.repeat(60));
  });

  test('текст без переводов строки режется ровно по лимиту', () => {
    const parts = splitLongText('а'.repeat(150), 100);
    expect(parts[0]?.length).toBe(100);
    expect(parts[1]?.length).toBe(50);
  });

  test('ничего не теряется при разбиении', () => {
    const text = Array.from({ length: 40 }, (_, i) => `строка ${i}`).join('\n');
    const parts = splitLongText(text, 50);
    expect(parts.join('\n')).toBe(text);
  });

  test('пустой текст не превращается в пустое сообщение', () => {
    expect(splitLongText('', 100)).toEqual(['']);
  });
});
