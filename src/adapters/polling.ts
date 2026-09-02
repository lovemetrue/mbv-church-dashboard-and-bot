import type { Logger } from '../logger.js';

/**
 * Задержки перед перезапуском опроса: 5с, 10с, 20с, 40с, минута и дальше по минуте.
 *
 * Первая короткая — обычные сбои разовые (шлюз платформы отдал HTML вместо JSON,
 * оборвалась сеть), и молчать полминуты из-за этого не нужно. Потолок нужен, чтобы
 * при долгой недоступности платформы не долбить её API без остановки.
 */
export const POLL_RETRY_DELAYS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

/** Прогон дольше потолка считаем удачным: следующий сбой снова начнёт с 5 секунд. */
const SETTLED_AFTER = POLL_RETRY_DELAYS.at(-1)!;

export interface PollingSupervisor {
  /** Запускает опрос. Возвращает управление, только когда опрос прекратился. */
  poll: () => Promise<void>;
  /**
   * Сбрасывает состояние библиотеки перед новым запуском.
   *
   * Для MAX это `bot.stop()`: после смерти цикла флаг `pollingIsStarted` остаётся
   * поднятым, и без сброса повторный `bot.start()` молча выходит, ничего не запуская.
   */
  reset: () => void | Promise<void>;
  /** Остановка штатная (бот выключается) — тогда перезапускать не надо. */
  stopped: () => boolean;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Держит цикл опроса живым, пока бота не остановили штатно.
 *
 * Библиотеки опроса завершают цикл на ошибке — одни бросают её наружу, другие просто
 * выходят из while. И то и другое означает «сообщения больше не приходят», но процесс
 * при этом жив, и ни docker, ни healthcheck ничего не заметят. Поэтому перезапускаем
 * сами: и после падения, и после молчаливого выхода.
 */
export async function supervisePolling(deps: PollingSupervisor): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  let attempt = 0;

  while (!deps.stopped()) {
    const startedAt = now();

    try {
      await deps.poll();
      if (deps.stopped()) return;
      deps.log.error('опрос завершился сам, без ошибки — перезапускаю');
    } catch (err) {
      if (deps.stopped()) return;
      deps.log.error({ err }, 'опрос упал — перезапускаю');
    }

    if (now() - startedAt >= SETTLED_AFTER) attempt = 0;
    const delay = POLL_RETRY_DELAYS[Math.min(attempt, POLL_RETRY_DELAYS.length - 1)]!;
    attempt += 1;

    await sleep(delay);
    if (deps.stopped()) return;
    await deps.reset();
  }
}
