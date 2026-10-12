import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { json, posts } from '../../test/calls';
import { stubFetchWithFixtures } from '../../test/render';
import { useChat } from './useChat';

afterEach(() => vi.unstubAllGlobals());

describe('разговор с помощником', () => {
  test('два вопроса подряд в одном такте шлют один запрос: второй, пока первый в пути, не принимается', async () => {
    const fetchMock = stubFetchWithFixtures({ 'assistant/chat': () => new Promise<Response>(() => {}) });
    const { result } = renderHook(() => useChat());
    let accepted: boolean[] = [];
    act(() => {
      accepted = [result.current.send('Первый'), result.current.send('Второй')];
    });
    expect(accepted).toEqual([true, false]);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(result.current.entries.map((e) => e.kind)).toEqual(['user']);
  });

  test('«Повторить» во время запроса ничего не шлёт', async () => {
    let calls = 0;
    const fetchMock = stubFetchWithFixtures({
      'assistant/chat': () => (++calls === 1 ? json({ ok: false, error: 'conflict', message: 'Подождите' }, 409) : new Promise<Response>(() => {})),
    });
    const { result } = renderHook(() => useChat());
    await act(async () => void result.current.send('Вопрос'));
    expect(result.current.entries.at(-1)?.kind).toBe('error');
    act(() => {
      result.current.retry();
      result.current.retry();
    });
    expect(posts(fetchMock)).toHaveLength(2);
  });

  test('«Повторить» шлёт тот же вопрос одним сообщением, без прошлых ходов', async () => {
    let calls = 0;
    const fetchMock = stubFetchWithFixtures({
      'assistant/chat': () => (++calls === 1 ? json({ ok: false, error: 'conflict', message: 'Подождите' }, 409) : json({ ok: true, answer: 'Ответ', queries: [], tables: [] })),
    });
    const { result } = renderHook(() => useChat());
    await act(async () => void result.current.send('Вопрос'));
    await act(async () => result.current.retry());
    expect(posts(fetchMock).map((p) => p.body)).toEqual([{ message: 'Вопрос' }, { message: 'Вопрос' }]);
    expect(result.current.entries.map((e) => e.kind)).toEqual(['user', 'answer']);
  });

  test('второе нажатие «Очистить», пока первое в пути, запроса не шлёт', async () => {
    const fetchMock = stubFetchWithFixtures({ 'assistant/chat/clear': () => new Promise<Response>(() => {}) });
    const { result } = renderHook(() => useChat());
    act(() => {
      void result.current.clear();
      void result.current.clear();
    });
    expect(posts(fetchMock).filter((p) => p.path === 'assistant/chat/clear')).toHaveLength(1);
    expect(result.current.clearing).toBe(true);
  });

  test('история читается один раз: повторный вызов, пока она грузится или уже показана, запроса не шлёт', async () => {
    const fetchMock = stubFetchWithFixtures();
    const { result } = renderHook(() => useChat());
    await act(async () => {
      void result.current.loadHistory();
      void result.current.loadHistory();
    });
    await act(async () => result.current.loadHistory());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/assistant/chat/history'))).toHaveLength(1);
    expect(result.current.history).toBe('ready');
    // демо-разговор из фикстур: пара реплик
    expect(result.current.entries.map((e) => e.kind)).toEqual(['user', 'answer']);
  });
});
