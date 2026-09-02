import { describe, expect, test } from 'vitest';
import { normalizePhone } from '../src/core/phone.js';

describe('normalizePhone', () => {
  test('оставляет как есть номер в каноническом виде', () => {
    expect(normalizePhone('+79001234567')).toBe('+79001234567');
  });

  test('добавляет плюс к номеру из кнопки контакта', () => {
    expect(normalizePhone('79001234567')).toBe('+79001234567');
  });

  test('приводит российский номер с восьмёрки к +7', () => {
    expect(normalizePhone('89001234567')).toBe('+79001234567');
  });

  test('чистит пробелы, скобки и дефисы ручного ввода', () => {
    expect(normalizePhone('+7 (900) 123-45-67')).toBe('+79001234567');
  });

  test('достраивает +7 к номеру из десяти цифр', () => {
    expect(normalizePhone('9001234567')).toBe('+79001234567');
  });

  test('отклоняет слишком короткий номер', () => {
    expect(normalizePhone('12345')).toBeNull();
  });

  test('отклоняет текст вместо номера', () => {
    expect(normalizePhone('мой номер спросите у жены')).toBeNull();
  });

  test('отклоняет пустую строку', () => {
    expect(normalizePhone('   ')).toBeNull();
  });

  test('отклоняет российский номер лишней длины', () => {
    expect(normalizePhone('+790012345678')).toBeNull();
  });

  test('сохраняет иностранный номер в формате E.164', () => {
    expect(normalizePhone('+375291234567')).toBe('+375291234567');
  });
});
