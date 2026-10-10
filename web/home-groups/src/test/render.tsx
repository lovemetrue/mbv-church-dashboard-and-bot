import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { fixtureResponse } from '../fixtures';
import { ThemeProvider } from '../shared/theme/ThemeProvider';

/** Показывает текущий адрес, чтобы тесты могли проверять состояние, записанное в `?`-параметры. */
export function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

export function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 1, refetchOnWindowFocus: false } } });
}

/** Подменяет fetch ответами фикстур: проходит весь настоящий путь клиента API. */
export function stubFetchWithFixtures(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.replace(/^.*\/api\/v1\//, '');
    const override = overrides[path];
    if (override) return override();
    return new Response(JSON.stringify(fixtureResponse(path)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderAt(ui: ReactElement, url = '/', client: QueryClient = makeClient()) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

export const currentSearch = (): URLSearchParams => {
  const el = document.querySelector('[data-testid="location"]');
  return new URLSearchParams(el?.textContent ?? '');
};
