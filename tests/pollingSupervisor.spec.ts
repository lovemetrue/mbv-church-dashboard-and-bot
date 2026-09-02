import { describe, expect, test, vi } from 'vitest';
import { supervisePolling, POLL_RETRY_DELAYS } from '../src/adapters/polling.js';
import type { Logger } from '../src/logger.js';

/**
 * Надзор за циклом опроса платформы.
 *
 * Почему он нужен: 29.08 бот в MAX замолчал на двое суток. Библиотека
 * @maxhub/max-bot-api завершает `Polling.loop` на любой ошибке — сетевую и 5xx она
 * «повторяет» через `return` из while, а остальное бросает наружу. Наш адаптер
 * запускал опрос через `void bot.start().catch(log)` и после первого же сбоя
 * сдавался: процесс жив, Telegram работает, docker считает контейнер здоровым,
 * а MAX ничего не получает.
 */
const silentLog = () => {
  const errors: unknown[] = [];
  const log = {
    error: (obj: unknown) => { errors.push(obj); },
    warn: () => {},
    info: () => {},
  } as unknown as Logger;
  return { log, errors };
};

/** Опрос, который отдаёт заранее заданные исходы, а потом висит вечно. */
const pollSequence = (outcomes: ('reject' | 'resolve')[]) => {
  let call = 0;
  const calls: number[] = [];
  const poll = async () => {
    const n = call++;
    calls.push(n);
    const outcome = outcomes[n];
    if (outcome === 'reject') throw new Error(`сбой опроса №${n}`);
    if (outcome === 'resolve') return;
    // Исходы кончились: рабочий цикл опроса не завершается никогда.
    await new Promise(() => {});
  };
  return { poll, calls };
};

describe('надзор за опросом платформы', () => {
  test('упавший опрос перезапускается, а не остаётся мёртвым', async () => {
    const { poll, calls } = pollSequence(['reject']);
    const { log, errors } = silentLog();
    const sleep = vi.fn(async () => {});

    void supervisePolling({ poll, reset: () => {}, stopped: () => false, log, sleep });
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(errors).toHaveLength(1);
  });

  test('опрос, завершившийся молча, тоже перезапускается', async () => {
    // Библиотека MAX именно так и «повторяет» сетевые сбои: ждёт 5 секунд и делает
    // return из while. Промис при этом успешно резолвится, ошибки нет — и без этой
    // ветки бот замолчал бы совсем незаметно, даже без строчки в логе.
    const { poll, calls } = pollSequence(['resolve']);
    const { log, errors } = silentLog();

    void supervisePolling({ poll, reset: () => {}, stopped: () => false, log, sleep: async () => {} });
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(errors).toHaveLength(1);
  });

  test('перед перезапуском состояние библиотеки сбрасывается', async () => {
    // Без этого перезапуск — пустышка: bot.start() видит флаг pollingIsStarted,
    // который после смерти цикла остался true, и молча выходит.
    const { poll, calls } = pollSequence(['reject', 'reject']);
    const order: string[] = [];
    const { log } = silentLog();

    void supervisePolling({
      poll: async () => { order.push('poll'); await poll(); },
      reset: () => { order.push('reset'); },
      stopped: () => false,
      log,
      sleep: async () => {},
    });

    await vi.waitFor(() => expect(calls.length).toBe(3));
    expect(order.slice(0, 5)).toEqual(['poll', 'reset', 'poll', 'reset', 'poll']);
  });

  test('задержки растут и упираются в потолок, а не долбят API', async () => {
    const { poll } = pollSequence(['reject', 'reject', 'reject', 'reject', 'reject', 'reject']);
    const waited: number[] = [];
    const { log } = silentLog();

    void supervisePolling({
      poll, reset: () => {}, stopped: () => false, log,
      sleep: async (ms) => { waited.push(ms); },
    });

    await vi.waitFor(() => expect(waited.length).toBe(6));
    expect(waited).toEqual([...POLL_RETRY_DELAYS, POLL_RETRY_DELAYS.at(-1)]);
  });

  test('после долгой работы задержки начинаются заново', async () => {
    // Двое суток опроса, потом разовый сбой — ждать минуту нет причин.
    const { poll } = pollSequence(['reject', 'reject']);
    const waited: number[] = [];
    const { log } = silentLog();
    let clock = 0;

    void supervisePolling({
      poll: async () => { clock += 3 * 24 * 3600_000; await poll(); },
      reset: () => {}, stopped: () => false, log,
      sleep: async (ms) => { waited.push(ms); },
      now: () => clock,
    });

    await vi.waitFor(() => expect(waited.length).toBe(2));
    expect(waited).toEqual([POLL_RETRY_DELAYS[0], POLL_RETRY_DELAYS[0]]);
  });

  test('после остановки бота перезапуска нет', async () => {
    const { poll, calls } = pollSequence(['reject']);
    const { log, errors } = silentLog();
    let stopped = false;

    void supervisePolling({
      poll: async () => { stopped = true; await poll(); },
      reset: () => {}, stopped: () => stopped, log, sleep: async () => {},
    });

    await vi.waitFor(() => expect(calls.length).toBe(1));
    // Штатная остановка — не авария: в логе ошибки быть не должно.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
