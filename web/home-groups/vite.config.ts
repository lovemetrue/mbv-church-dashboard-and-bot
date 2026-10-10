import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Сервис отдаёт собранные файлы со своего корня, но базовый путь берём из окружения:
// если интерфейс когда-нибудь переедет под префикс (например, /groups/app/), пересборка
// с VITE_BASE — единственная правка. Весь код строит адреса от import.meta.env.BASE_URL.
const base = normalizeBase(process.env.VITE_BASE);

function normalizeBase(raw: string | undefined): string {
  if (!raw) return '/';
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

// Dev-сервер проксирует api/вход/выход на настоящий сервис, чтобы кука и пути совпадали с боевыми.
const target = process.env.HG_DEV_API ?? 'http://localhost:8092';
const proxy = Object.fromEntries(
  ['api', 'login', 'logout'].map((p) => [`${base}${p}`, { target, changeOrigin: false }]),
);

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    // Контракт API лежит в src/home-groups/ и общий с сервером. Из него берутся только типы
    // (import type), поэтому в сборку он не попадает; алиас нужен лишь для короткого пути.
    alias: { '@contracts': fileURLToPath(new URL('../../src/home-groups/contracts.ts', import.meta.url)) },
  },
  server: { proxy },
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
