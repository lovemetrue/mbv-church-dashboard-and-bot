import type { Cell } from './filters';

/**
 * Разделитель «;»: русский Excel при открытии по двойному щелчку режет CSV именно по нему,
 * а запятая оставила бы всю строку в одной ячейке.
 */
const SEP = ';';

/**
 * Строка, начатая с «=», «+», «-», «@» или табуляции, откроется в Excel как формула. Имена и
 * комментарии вводят люди, так что такую ячейку метим апострофом. Числа сюда не попадают.
 */
const cell = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Текст CSV с BOM в начале: без него Excel читает UTF-8 как cp1251 и кириллица превращается в кракозябры. */
export function toCsv(headers: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [headers.map(cell), ...rows.map((r) => r.map(cell))].map((l) => l.join(SEP));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Отдаёт текст браузеру как скачиваемый файл. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
