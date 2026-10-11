import { renderHook } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../test/render';
import { queryKeys, REFRESH_MS, useRequests, useToday } from './queries';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('обновление данных', () => {
  test('данные перезапрашиваются раз в минуту без участия человека', async () => {
    const fetchMock = stubFetchWithFixtures();
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    renderHook(() => useToday(), { wrapper });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(REFRESH_MS).toBe(60_000);
    await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  test('при возврате на вкладку браузера данные запрашиваются заново', async () => {
    const fetchMock = stubFetchWithFixtures();
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    renderHook(() => useToday(), { wrapper });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // данные считаются свежими 15 секунд, поэтому «вернулись» через 20
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  test('опрос «Заявок» и «Сегодня» включён раз в минуту и не идёт в фоновой вкладке', async () => {
    stubFetchWithFixtures();
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    renderHook(() => ({ requests: useRequests(), today: useToday() }), { wrapper });
    await vi.waitFor(() => expect(client.getQueryCache().find({ queryKey: queryKeys.requests })?.observers.length).toBe(1));
    for (const key of [queryKeys.requests, queryKeys.today]) {
      const options = client.getQueryCache().find({ queryKey: key })!.observers[0]!.options;
      expect(options.refetchInterval).toBe(60_000);
      // Бот принимает заявки постоянно, но скрытая вкладка не должна гонять запросы впустую.
      expect(options.refetchIntervalInBackground).toBe(false);
      expect(options.refetchOnWindowFocus).toBe(true);
    }
  });

  test('пока вкладка браузера скрыта, опрос молчит, а при возврате данные запрашиваются сразу', async () => {
    const fetchMock = stubFetchWithFixtures();
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    renderHook(() => useRequests(), { wrapper });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    focusManager.setFocused(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
