import { describe, expect, test } from 'vitest';
import { answerCopyText, cellText, toTurns, type Entry } from './model';

const user = (id: number, text: string): Entry => ({ id, kind: 'user', text });
const answer = (id: number, text: string): Entry => ({
  id,
  kind: 'answer',
  answer: text,
  queries: [{ sql: 'select 1', ok: true, rows: 1 }],
  tables: [{ columns: ['a'], rows: [[1]], truncated: false }],
});
const failure = (id: number): Entry => ({ id, kind: 'error', text: 'Помощник выключен', hint: null });

describe('история для сервера', () => {
  test('уходят только роль и текст: таблицы и запросы в тело не попадают', () => {
    const turns = toTurns([user(1, 'Вопрос'), answer(2, 'Ответ'), user(3, 'Ещё')]);
    expect(turns).toEqual([
      { role: 'user', content: 'Вопрос' },
      { role: 'assistant', content: 'Ответ' },
      { role: 'user', content: 'Ещё' },
    ]);
    for (const t of turns) expect(Object.keys(t).sort()).toEqual(['content', 'role']);
  });

  test('уходят последние 12 ходов, самые старые отбрасываются', () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 10; i += 1) entries.push(user(i * 2, `в${i}`), answer(i * 2 + 1, `о${i}`));
    entries.push(user(100, 'последний'));
    const turns = toTurns(entries);
    expect(turns).toHaveLength(12);
    expect(turns[11]).toEqual({ role: 'user', content: 'последний' });
    expect(turns[0]).toEqual({ role: 'assistant', content: 'о4' });
  });

  test('вопрос, на который пришла ошибка, в историю не идёт, а сама ошибка — тем более', () => {
    const turns = toTurns([user(1, 'Сорвался'), failure(2), user(3, 'Новый')]);
    expect(turns).toEqual([{ role: 'user', content: 'Новый' }]);
  });

  test('вопрос с ошибкой в конце (повтор) остаётся последним ходом', () => {
    expect(toTurns([user(1, 'Сорвался')])).toEqual([{ role: 'user', content: 'Сорвался' }]);
  });

  test('слишком длинный ответ обрезается до 2000 знаков: сервер больше не примет', () => {
    const turns = toTurns([user(1, 'в'), answer(2, 'я'.repeat(2500)), user(3, 'ещё')]);
    expect(turns[1]!.content).toHaveLength(2000);
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
