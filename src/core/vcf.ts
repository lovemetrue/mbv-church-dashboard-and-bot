import { normalizePhone } from './phone.js';

/**
 * Достаёт телефон из визитки VCF: в MAX кнопка «поделиться контактом»
 * присылает именно её, а не готовое поле с номером.
 */
export function parseVcfPhone(vcf: string): string | null {
  // Строка телефона бывает в разных видах: TEL:, TEL;TYPE=CELL:, item1.TEL;type=VOICE:
  for (const line of vcf.split(/\r?\n/)) {
    const match = line.match(/(?:^|\.)TEL[^:]*:(.+)$/i);
    if (!match) continue;
    const phone = normalizePhone(match[1]!.trim());
    if (phone) return phone;
  }
  return null;
}
