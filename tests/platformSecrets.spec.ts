import { describe, expect, test } from 'vitest';
import { decryptSecret, encryptSecret, keyHint } from '../src/platform/settings/secrets.js';

const SECRET = 'пароль сервера, из которого получается ключ шифрования';

describe('хранение ключей в базе', () => {
  test('зашифрованное читается обратно тем же секретом', () => {
    const sealed = encryptSecret('sk-1234567890abcdef', SECRET);
    expect(decryptSecret(sealed, SECRET)).toBe('sk-1234567890abcdef');
  });

  test('в зашифрованном виде самого ключа нет, и каждый раз получается другой текст', () => {
    const a = encryptSecret('sk-1234567890abcdef', SECRET);
    const b = encryptSecret('sk-1234567890abcdef', SECRET);
    expect(a).not.toContain('1234567890');
    expect(a).not.toBe(b);
  });

  test('другим секретом (например, после смены пароля сервера) ключ не прочитать — вернётся null, а не мусор', () => {
    const sealed = encryptSecret('sk-abc', SECRET);
    expect(decryptSecret(sealed, 'другой секрет')).toBeNull();
  });

  test('повреждённое или чужое значение не роняет чтение', () => {
    expect(decryptSecret('что-то не то', SECRET)).toBeNull();
    expect(decryptSecret('v1:AAAA:BBBB:CCCC', SECRET)).toBeNull();
    const sealed = encryptSecret('sk-abc', SECRET);
    // Подмена хотя бы одного символа шифртекста ломает проверку подлинности.
    const parts = sealed.split(':');
    parts[3] = (parts[3]!.startsWith('A') ? 'B' : 'A') + parts[3]!.slice(1);
    expect(decryptSecret(parts.join(':'), SECRET)).toBeNull();
  });

  test('пустой секрет не принимается: шифровать «ничем» нельзя', () => {
    expect(() => encryptSecret('sk-abc', '')).toThrow();
  });

  test('подсказка показывает только последние четыре символа', () => {
    expect(keyHint('sk-1234567890abcdef')).toBe('cdef');
    expect(keyHint('abc')).toBeNull();
    expect(keyHint('  ')).toBeNull();
  });
});
