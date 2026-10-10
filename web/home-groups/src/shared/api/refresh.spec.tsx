import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../test/render';
import { REFRESH_MS, useToday } from './queries';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
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
});
