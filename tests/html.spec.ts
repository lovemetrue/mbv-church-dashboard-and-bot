import { describe, expect, test } from 'vitest';
import { esc } from '../src/core/html.js';
import { formatPhone } from '../src/core/phone.js';

describe('esc', () => {
  test('экранирует угловые скобки, чтобы текст участника не сломал разметку', () => {
    expect(esc('<b>жирный</b>')).toBe('&lt;b&gt;жирный&lt;/b&gt;');
  });

  test('экранирует амперсанд', () => {
    expect(esc('Пётр & Павел')).toBe('Пётр &amp; Павел');
  });

  test('обычный русский текст не портит', () => {
    expect(esc('Когда выдают материалы?')).toBe('Когда выдают материалы?');
  });

  test('пустое и отсутствующее значение превращает в пустую строку', () => {
    expect(esc('')).toBe('');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  test('числа приводит к строке', () => {
    expect(esc(34)).toBe('34');
  });

  test('амперсанд экранируется первым, а не поверх готовых сущностей', () => {
    expect(esc('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});

describe('formatPhone', () => {
  test('российский номер разбивает по группам', () => {
    expect(formatPhone('+79001234567')).toBe('+7 900 123-45-67');
  });

  test('иностранный номер оставляет как есть', () => {
    expect(formatPhone('+375291234567')).toBe('+375291234567');
  });

  test('пустое значение отдаёт пустую строку', () => {
    expect(formatPhone(null)).toBe('');
  });
});
