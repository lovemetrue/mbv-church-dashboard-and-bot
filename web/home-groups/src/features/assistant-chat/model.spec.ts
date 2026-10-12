import { describe, expect, test } from 'vitest';
import { answerCopyText, cellText, entriesFromHistory } from './model';

describe('история с сервера на экране', () => {
  test('роли становятся записями разговора по порядку, у ответов нет таблиц и запросов', () => {
    const entries = entriesFromHistory(
      [
        { role: 'user', content: 'Вопрос' },
        { role: 'assistant', content: 'Ответ' },
      ],
      10,
    );
    expect(entries).toEqual([
      { id: 10, kind: 'user', text: 'Вопрос' },
      { id: 11, kind: 'answer', answer: 'Ответ', queries: [], tables: [] },
    ]);
  });

  test('пустая история даёт пустой разговор', () => {
    expect(entriesFromHistory([], 1)).toEqual([]);
  });
});

describe('значения в таблице', () => {
  test('пустое значение показывается тире, число и текст как есть, логическое словами', () => {
    expect(cellText(null)).toBe('—');
    expect(cellText('')).toBe('—');
    expect(cellText(0)).toBe('0');
    expect(cellText('Приморский')).toBe('Приморский');
    expect(cellText(true)).toBe('да');
    expect(cellText(false)).toBe('нет');
  });
});

describe('копирование ответа', () => {
  test('копируется текст ответа, а под ним таблицы через табуляцию', () => {
    const text = answerCopyText('Перебор в Приморском.', [
      { columns: ['Район', 'Групп'], rows: [['Приморский', 7], ['Центр', null]], truncated: false },
    ]);
    expect(text).toBe('Перебор в Приморском.\n\nРайон\tГрупп\nПриморский\t7\nЦентр\t—');
  });

  test('без таблиц копируется только ответ', () => {
    expect(answerCopyText('Только текст', [])).toBe('Только текст');
  });
});
