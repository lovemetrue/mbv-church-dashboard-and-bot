import type { RequestItem } from './contracts.js';

/** Excel на русской локали ждёт точку с запятой, а кириллицу в UTF-8 без метки порядка байтов портит. */
const SEP = ';';
const BOM = '﻿';

/**
 * Ячейка CSV. Значение, начинающееся с `= + - @`, Excel исполнил бы как формулу (так из чужой заявки можно
 * протащить команду на компьютер того, кто откроет выгрузку), поэтому спереди ставим апостроф.
 */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'boolean' ? (value ? 'да' : 'нет') : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s)) s = `'${s}`;
  s = s.replace(/\r?\n/g, ' ');
  return s.includes(SEP) || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
}

const BUCKET_TEXT: Record<string, string> = {
  ready: 'готово к утверждению', callback: 'перезвонить', human: 'нужна помощь', done: 'готово', cancelled: 'отказ',
};

const HEADERS = ['№', 'ФИО', 'Телефон', 'Возраст', 'Район и метро', 'Район', 'Статус', 'Состояние', 'Откуда', 'В работе у', 'Ждёт, дней', 'Нужен звонок', 'Группа', 'Комментарий'];

/** Выгрузка заявок: с телефонами, поэтому отдаётся только полному входу и пишется в журнал (см. `server.ts`). */
export function requestsToCsv(items: readonly RequestItem[]): string {
  const lines = items.map((r) => [
    r.id, r.fio, r.phone, r.ageLabel, r.place, r.district, r.status, BUCKET_TEXT[r.bucket] ?? r.bucket, r.source,
    r.responsible, r.waitingDays, r.callback, r.finalGroup ? `${r.finalGroup.code}, ${r.finalGroup.leader}` : r.finalGroupText, r.note,
  ].map(cell).join(SEP));
  return BOM + [HEADERS.join(SEP), ...lines].join('\r\n') + '\r\n';
}
