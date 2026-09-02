/**
 * Список дней кампании в человеческом виде: «1–3, 5, 7–9».
 * Без этого «каких дней не хватает» превращается в простыню из сорока чисел.
 */
export function formatDayRanges(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;

  const flush = (): void => {
    // Пару подряд («4, 5») диапазоном не пишем: так не короче и читается хуже.
    if (prev - start >= 2) parts.push(`${start}–${prev}`);
    else for (let d = start; d <= prev; d += 1) parts.push(String(d));
  };

  for (const day of sorted.slice(1)) {
    if (day === prev + 1) {
      prev = day;
      continue;
    }
    flush();
    start = day;
    prev = day;
  }
  flush();

  return parts.join(', ');
}
