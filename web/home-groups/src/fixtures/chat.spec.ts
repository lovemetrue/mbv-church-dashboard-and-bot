import { describe, expect, test } from 'vitest';
import { ApiError } from '../shared/api/client';
import { fixtureActionResponse, fixtureResponse } from './index';

const ask = (content: string) => ({ messages: [{ role: 'user', content }] });

describe('фикстуры чата помощника', () => {
  test('в демо кнопка «Помощник» доступна', () => {
    expect(fixtureResponse('me')).toMatchObject({ role: 'super', assistant: { available: true, enabled: true, chat: true } });
  });

  test('на «перебор» отвечает таблицей групп по районам и перечнем запросов', () => {
    const out = fixtureActionResponse('assistant/chat', ask('В каком районе перебор групп?')) as {
      ok: boolean;
      answer: string;
      queries: { sql: string; ok: boolean; rows: number }[];
      tables: { columns: string[]; rows: unknown[][]; truncated: boolean }[];
    };
    expect(out.ok).toBe(true);
    expect(out.answer).not.toBe('');
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0]!.rows.length).toBeGreaterThan(1);
    expect(out.tables[0]!.rows.every((r) => r.length === out.tables[0]!.columns.length)).toBe(true);
    expect(out.queries.length).toBeGreaterThan(0);
    expect(out.queries[0]!.rows).toBe(out.tables[0]!.rows.length);
  });

  test('на другие вопросы отвечает общим ответом с одной таблицей', () => {
    const out = fixtureActionResponse('assistant/chat', ask('Где не хватает групп?')) as { answer: string; tables: unknown[] };
    expect(out.tables).toHaveLength(1);
    expect(out.answer).not.toMatch(/перебор/i);
  });

  test('смотрит на последний вопрос, а не на первый', () => {
    const out = fixtureActionResponse('assistant/chat', {
      messages: [
        { role: 'user', content: 'перебор' },
        { role: 'assistant', content: 'ответ' },
        { role: 'user', content: 'Где не хватает?' },
      ],
    }) as { answer: string };
    expect(out.answer).not.toMatch(/перебор/i);
  });

  test('на вопрос со словом «ошибка» отвечает отказом 503 «Служба модели недоступна»', () => {
    expect(() => fixtureActionResponse('assistant/chat', ask('Покажи ошибка'))).toThrowError(ApiError);
    try {
      fixtureActionResponse('assistant/chat', ask('Покажи ошибка'));
    } catch (e) {
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).code).toBe('unavailable');
      expect((e as ApiError).message).toMatch(/недоступн/);
    }
  });
});
