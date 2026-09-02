import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Тесты, работающие с одной и той же тестовой базой, не должны идти параллельно.
    fileParallelism: false,
    env: {
      LOG_LEVEL: 'silent',
      TIMEZONE: 'Europe/Moscow',
    },
  },
});
