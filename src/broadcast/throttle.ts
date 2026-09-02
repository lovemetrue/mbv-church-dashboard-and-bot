export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ограничитель частоты отправки: разносит вызовы на равные интервалы.
 * Один экземпляр на платформу, потому что лимиты у Telegram и MAX независимые.
 *
 * Часы и сон инжектируются, чтобы тесты не ждали настоящее время.
 */
export class RateLimiter {
  private nextAt = 0;
  private readonly intervalMs: number;

  constructor(
    perSecond: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {
    this.intervalMs = 1000 / perSecond;
  }

  async take(): Promise<void> {
    const t = this.now();
    // Долг за простой не копим: после паузы отправляем сразу.
    const at = Math.max(t, this.nextAt);
    this.nextAt = at + this.intervalMs;
    if (at > t) await this.sleep(at - t);
  }

  /** Сдвигает окно вперёд после ответа «слишком часто» от платформы. */
  pauseFor(ms: number): void {
    this.nextAt = Math.max(this.nextAt, this.now() + ms);
  }
}
