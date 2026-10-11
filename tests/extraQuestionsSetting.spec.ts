import { describe, expect, test, vi } from 'vitest';
import { createExtraQuestionsSource, EXTRA_QUESTIONS_KEY } from '../src/core/rollout.js';

const store = (value: unknown, fail = false) => ({
  calls: 0,
  async get<T>(key: string): Promise<T | null> {
    this.calls += 1;
    if (fail) throw new Error('база недоступна');
    return key === EXTRA_QUESTIONS_KEY ? (value as T) : null;
  },
});

describe('настройка «новые вопросы анкеты»: откуда бот берёт значение', () => {
  test('пока в настройках ничего нет, действует значение из .env', async () => {
    expect(await createExtraQuestionsSource(store(null), 'off')()).toBe('off');
    expect(await createExtraQuestionsSource(store(null), 'all')()).toBe('all');
  });

  test('сохранённое в настройках важнее .env', async () => {
    expect(await createExtraQuestionsSource(store('all'), 'off')()).toBe('all');
    expect(await createExtraQuestionsSource(store('off'), 'all')()).toBe('off');
    expect(await createExtraQuestionsSource(store('max:7,5'), 'off')()).toBe('max:7,5');
  });

  test('значение не-строка в настройках игнорируется', async () => {
    expect(await createExtraQuestionsSource(store(42), 'off')()).toBe('off');
  });

  test('база не отвечает — бот не падает и берёт значение из .env', async () => {
    expect(await createExtraQuestionsSource(store('all', true), 'off')()).toBe('off');
  });

  test('значение кэшируется на короткое время, потом читается заново', async () => {
    vi.useFakeTimers();
    try {
      const s = store('all');
      const read = createExtraQuestionsSource(s, 'off', 15_000);
      await read(); await read(); await read();
      expect(s.calls).toBe(1);
      vi.advanceTimersByTime(16_000);
      await read();
      expect(s.calls).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
