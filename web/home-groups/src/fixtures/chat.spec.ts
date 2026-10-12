import { afterEach, describe, expect, test } from 'vitest';
import { ApiError } from '../shared/api/client';
import { resetDemoChat } from './chat';
import { fixtureActionResponse, fixtureResponse } from './index';

/** Новый вид тела: одно сообщение, историю сервер знает сам. */
const ask = (message: string) => ({ message });
const history = () => (fixtureResponse('assistant/chat/history') as { messages: { role: string; content: string }[] }).messages;

afterEach(() => resetDemoChat());

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

  test('прежний вид тела с messages тоже понимает: смотрит на последний вопрос', () => {
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

describe('фикстуры чата помощника: история разговора', () => {
  test('в демо при открытии уже есть две реплики: вопрос и ответ', () => {
    expect(history().map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(history().every((t) => t.content.length > 0)).toBe(true);
  });

  test('ответ на вопрос дописывает в историю и вопрос, и ответ', () => {
    const out = fixtureActionResponse('assistant/chat', ask('Где не хватает групп?')) as { answer: string };
    const now = history();
    expect(now).toHaveLength(4);
    expect(now[2]).toEqual({ role: 'user', content: 'Где не хватает групп?' });
    expect(now[3]).toEqual({ role: 'assistant', content: out.answer });
  });

  test('отказ («ошибка») в историю не попадает, как и на сервере', () => {
    expect(() => fixtureActionResponse('assistant/chat', ask('ошибка'))).toThrowError(ApiError);
    expect(history()).toHaveLength(2);
  });

  test('«очистить» пустит историю, а следующее чтение вернёт пустой список', () => {
    expect(fixtureActionResponse('assistant/chat/clear', {})).toEqual({ ok: true });
    expect(history()).toEqual([]);
  });

  test('история не растёт дальше 40 сообщений: старые отбрасываются', () => {
    for (let i = 0; i < 30; i += 1) fixtureActionResponse('assistant/chat', ask(`вопрос ${i}`));
    expect(history()).toHaveLength(40);
    expect(history().at(-2)).toEqual({ role: 'user', content: 'вопрос 29' });
  });

  test('чтение отдаёт копию: правка ответа не портит демо-историю', () => {
    (fixtureResponse('assistant/chat/history') as { messages: unknown[] }).messages.length = 0;
    expect(history()).toHaveLength(2);
  });
});
