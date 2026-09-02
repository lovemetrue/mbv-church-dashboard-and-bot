/**
 * Нормализация телефона к формату E.164 (+7XXXXXXXXXX).
 * Принимает как строку из кнопки «поделиться контактом», так и ручной ввод.
 * Возвращает null, если это не похоже на номер — вызывающий код просит ввести заново.
 */
export function normalizePhone(raw: string): string | null {
  const hadPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;

  // Российский номер: 8XXXXXXXXXX, 7XXXXXXXXXX или XXXXXXXXXX (10 цифр без кода страны)
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`;
  }

  // Код 7 — это Россия и Казахстан, там всегда ровно 11 цифр. Значит, номер набран с ошибкой.
  if (digits.startsWith('7') || digits.startsWith('8')) return null;

  // Иностранный номер принимаем только если пользователь явно указал код страны через «+»
  if (hadPlus && digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return null;
}

/** Российский номер для показа человеку: +7 900 123-45-67. Остальные оставляем как есть. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = phone.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}
