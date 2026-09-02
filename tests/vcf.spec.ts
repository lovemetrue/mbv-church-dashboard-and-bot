import { describe, expect, test } from 'vitest';
import { parseVcfPhone } from '../src/core/vcf.js';

// В MAX номер из кнопки «поделиться контактом» приходит внутри визитки VCF.
const vcf = (tel: string) =>
  ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Иван Иванов', tel, 'END:VCARD'].join('\r\n');

describe('parseVcfPhone', () => {
  test('достаёт номер из простой строки TEL', () => {
    expect(parseVcfPhone(vcf('TEL:+79001234567'))).toBe('+79001234567');
  });

  test('понимает TEL с параметрами типа', () => {
    expect(parseVcfPhone(vcf('TEL;TYPE=CELL:+7 900 123-45-67'))).toBe('+79001234567');
  });

  test('понимает TEL с приставкой item и VOICE', () => {
    expect(parseVcfPhone(vcf('item1.TEL;type=VOICE;type=pref:89001234567'))).toBe('+79001234567');
  });

  test('берёт первый номер, если их несколько', () => {
    const card = ['BEGIN:VCARD', 'TEL:+79001111111', 'TEL:+79002222222', 'END:VCARD'].join('\r\n');
    expect(parseVcfPhone(card)).toBe('+79001111111');
  });

  test('без строки TEL возвращает null', () => {
    expect(parseVcfPhone(vcf('EMAIL:ivan@example.com'))).toBeNull();
  });

  test('мусор вместо визитки возвращает null', () => {
    expect(parseVcfPhone('не визитка')).toBeNull();
  });

  test('пустая строка возвращает null', () => {
    expect(parseVcfPhone('')).toBeNull();
  });
});
