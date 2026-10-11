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
});
