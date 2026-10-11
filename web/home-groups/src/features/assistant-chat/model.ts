import type { ChatQuery, ChatTable, ChatTurn } from '@contracts';
import { ru } from '../../shared/i18n/ru';

/** Пределы сервера: больше он не примет (400), поэтому интерфейс укладывается сам. */
export const MAX_TURNS = 12;
export const MAX_LENGTH = 2000;
/** С какого числа знаков показывать счётчик: раньше он только отвлекал бы. */
export const COUNTER_FROM = 1800;

/** Запись разговора на экране. Не то же самое, что ход для сервера: ошибка и таблицы сервером не читаются. */
export type Entry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'answer'; answer: string; queries: ChatQuery[]; tables: ChatTable[] }
  | { id: number; kind: 'error'; text: string; hint: 'settings' | null };

/**
 * Ходы для сервера: только роль и текст, последние 12. Сервер историю не хранит, поэтому присылаем её целиком.
 * Таблицы и запросы не уходят: в них настоящие имена, а модель их видеть не должна.
 *
 * Вопрос, на который пришла ошибка, пропускаем: иначе подряд пошли бы два вопроса человека без ответа между ними.
 * При повторе ошибку из разговора убирают до отправки, поэтому повторяемый вопрос остаётся и идёт последним.
 */
export function toTurns(entries: Entry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  entries.forEach((e, i) => {
    if (e.kind === 'error') return;
    if (e.kind === 'user') {
      if (entries[i + 1]?.kind === 'error') return;
      turns.push({ role: 'user', content: e.text.slice(0, MAX_LENGTH) });
      return;
    }
    // Ответ длиннее предела сервер отклонил бы целиком: лучше потерять хвост старого ответа, чем весь вопрос.
    turns.push({ role: 'assistant', content: e.answer.slice(0, MAX_LENGTH) });
  });
  return turns.slice(-MAX_TURNS);
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
