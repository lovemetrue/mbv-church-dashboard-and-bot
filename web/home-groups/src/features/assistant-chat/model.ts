import type { ChatQuery, ChatTable, ChatTurn } from '@contracts';
import { ru } from '../../shared/i18n/ru';

/** Предел сервера: вопрос длиннее он не примет (400), поэтому интерфейс укладывается сам. */
export const MAX_LENGTH = 2000;
/** С какого числа знаков показывать счётчик: раньше он только отвлекал бы. */
export const COUNTER_FROM = 1800;

/** Запись разговора на экране. Не то же самое, что ход в истории сервера: ошибка и таблицы там не хранятся. */
export type Entry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'answer'; answer: string; queries: ChatQuery[]; tables: ChatTable[] }
  | { id: number; kind: 'error'; text: string; hint: 'settings' | null };

/**
 * Прошлый разговор с сервера → записи для экрана. Сервер хранит только текст вопросов и ответов: таблиц и запросов
 * у старых ответов нет, и показываем одни слова. Номера записей продолжают счёт, чтобы не совпасть с новыми.
 */
export function entriesFromHistory(turns: readonly ChatTurn[], firstId: number): Entry[] {
  return turns.map((t, i): Entry =>
    t.role === 'user'
      ? { id: firstId + i, kind: 'user', text: t.content }
      : { id: firstId + i, kind: 'answer', answer: t.content, queries: [], tables: [] },
  );
}

/** Значение ячейки как на экране: пустое — тире, логическое — словами. */
export function cellText(value: string | number | boolean | null): string {
  if (value === null || value === '') return ru.chat.noValue;
  if (typeof value === 'boolean') return value ? ru.chat.yes : ru.chat.no;
  return String(value);
}

/** Текст для буфера обмена: ответ, а под ним таблицы через табуляцию (в таблицу мессенджера или Excel вставляется ровно). */
export function answerCopyText(answer: string, tables: ChatTable[]): string {
  const blocks = tables.map((t) => [t.columns.join('\t'), ...t.rows.map((r) => r.map(cellText).join('\t'))].join('\n'));
  return [answer, ...blocks].join('\n\n');
}
