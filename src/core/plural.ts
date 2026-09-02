/**
 * Согласование слов с числами по-русски: «1 год», «34 года», «47 лет».
 *
 * Правило: числа с 11 по 14 (и 111–114, и так далее) берут форму множественного числа,
 * дальше решает последняя цифра.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(n) % 100;
  const last = lastTwo % 10;

  if (lastTwo > 10 && lastTwo < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const withNumber = (n: number, one: string, few: string, many: string): string =>
  `${n} ${plural(n, one, few, many)}`;

export const years = (n: number): string => withNumber(n, 'год', 'года', 'лет');
export const participants = (n: number): string => withNumber(n, 'участник', 'участника', 'участников');
export const requests = (n: number): string => withNumber(n, 'заявка', 'заявки', 'заявок');
export const days = (n: number): string => withNumber(n, 'день', 'дня', 'дней');
/** Дательный падеж: «отправить 5 участникам». */
export const toParticipants = (n: number): string => withNumber(n, 'участнику', 'участникам', 'участникам');
