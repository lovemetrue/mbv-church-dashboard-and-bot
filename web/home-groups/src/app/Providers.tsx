import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { BASE_URL } from '../shared/api/base';
import { ThemeProvider } from '../shared/theme/ThemeProvider';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: true } },
  });
}

/** Провайдеры боевого приложения. Тесты собирают свои (MemoryRouter и клиент без повторов). */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <BrowserRouter basename={BASE_URL.replace(/\/$/, '') || '/'}>{children}</BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
