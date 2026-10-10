import { logger } from '../../logger.js';

export interface AutoMatchingOptions {
  intervalMs: number;
  /** Включён ли автоматический подбор: читается на каждом проходе, поэтому переключатель действует без перезапуска. */
  isEnabled: () => Promise<boolean>;
  run: (actor: string) => Promise<unknown>;
}

/** Кем записан автоматический запуск в журнале. */
export const AUTO_ACTOR = 'авто';

/**
 * Раз в `intervalMs` подбирает новые заявки, если переключатель включён. Один проход за раз:
 * если предыдущий не закончился (медленная база), следующий пропускается, а не накладывается.
 * Ошибка не останавливает цикл — в журнал, и ждём следующего прохода.
 */
export function startAutoMatching(opts: AutoMatchingOptions): { stop: () => void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        if (await opts.isEnabled()) await opts.run(AUTO_ACTOR);
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : err }, 'домашние группы: автоматический подбор не удался');
      } finally {
        running = false;
      }
    })();
  }, opts.intervalMs);
  // Таймер не должен держать процесс живым при остановке.
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
