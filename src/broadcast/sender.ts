import { SendError, type Platform, type PlatformName } from '../core/platform.js';
import type { DeliveriesRepo, PendingDelivery } from '../db/repos/deliveries.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { RateLimiter, realSleep, type Sleep } from './throttle.js';

export interface SenderDeps {
  deliveries: DeliveriesRepo;
  users: UsersRepo;
  platforms: Map<PlatformName, Platform>;
  limiters: Map<PlatformName, RateLimiter>;
  /** Сколько раз пробуем доставить одно сообщение, прежде чем списать в failed. */
  maxAttempts?: number;
  batchSize?: number;
  logger?: Logger;
  sleep?: Sleep;
}

export interface BroadcastResult {
  key: string;
  sent: number;
  failed: number;
  blocked: number;
  /** Осталось в очереди: платформа выключена, дошлём при следующем запуске. */
  pending: number;
}

/**
 * Отправка рассылки по журналу доставки.
 *
 * Источник истины это таблица deliveries, поэтому рестарт посреди рассылки
 * продолжает работу с того же места, а не начинает заново.
 */
export class BroadcastSender {
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly log: Logger;
  private readonly sleep: Sleep;

  constructor(private readonly deps: SenderDeps) {
    this.maxAttempts = deps.maxAttempts ?? 3;
    this.batchSize = deps.batchSize ?? 100;
    this.log = deps.logger ?? defaultLogger;
    this.sleep = deps.sleep ?? realSleep;
  }

  /** Досылает все незавершённые рассылки: вызывается при старте процесса. */
  async resumeUnfinished(): Promise<BroadcastResult[]> {
    const keys = await this.deps.deliveries.unfinishedKeys();
    const results: BroadcastResult[] = [];
    for (const key of keys) results.push(await this.run(key));
    return results;
  }

  async run(key: string): Promise<BroadcastResult> {
    const body = await this.deps.deliveries.body(key);
    if (body === null) throw new Error(`рассылка ${key} не найдена`);

    const result: BroadcastResult = { key, sent: 0, failed: 0, blocked: 0, pending: 0 };
    /** Чаты, к которым в этом прогоне возвращаться бесполезно: платформа отключена. */
    const skipped = new Set<number>();

    for (;;) {
      const batch = await this.deps.deliveries.nextPending(key, this.batchSize);
      const todo = batch.filter((d) => !skipped.has(d.id));
      if (todo.length === 0) break;

      for (const delivery of todo) {
        const platform = this.deps.platforms.get(delivery.platform);
        if (!platform) {
          // Такое бывает, если MAX выключили после постановки в очередь.
          // Оставляем в pending: дойдёт, когда платформу включат обратно.
          skipped.add(delivery.id);
          continue;
        }
        await this.deliverOne(delivery, platform, body, result);
      }
    }

    result.pending = await this.deps.deliveries.pendingCount(key);
    if (result.pending === 0) {
      await this.deps.deliveries.finish(key);
    }

    this.log.info({ broadcast: key, ...result }, 'рассылка обработана');
    return result;
  }

  private async deliverOne(
    delivery: PendingDelivery,
    platform: Platform,
    body: string,
    result: BroadcastResult,
  ): Promise<void> {
    const { deliveries, users } = this.deps;
    const limiter = this.deps.limiters.get(delivery.platform);
    await limiter?.take();

    try {
      await platform.sendMessage(delivery.chat_id, { text: body });
      await deliveries.markSent(delivery.id);
      result.sent += 1;
      return;
    } catch (err) {
      const sendError = err instanceof SendError ? err : new SendError('other', (err as Error).message, undefined, err);
      const lastTry = delivery.attempts + 1 >= this.maxAttempts;

      switch (sendError.kind) {
        case 'blocked':
        case 'not_found':
          // Человек заблокировал бота или удалил диалог: больше не пишем ему никогда.
          await deliveries.markBlocked(delivery.id, sendError.message);
          await users.markBlocked(delivery.user_id);
          result.blocked += 1;
          return;

        case 'rate_limited': {
          const waitMs = sendError.retryAfterMs ?? 5_000;
          limiter?.pauseFor(waitMs);
          if (lastTry) {
            await deliveries.markFailed(delivery.id, sendError.message);
            result.failed += 1;
          } else {
            await deliveries.retryLater(delivery.id, sendError.message);
            await this.sleep(waitMs);
          }
          return;
        }

        default:
          if (lastTry) {
            await deliveries.markFailed(delivery.id, sendError.message);
            result.failed += 1;
            this.log.warn(
              { delivery: delivery.id, user: delivery.user_id, err: sendError.message },
              'доставка списана после исчерпания попыток',
            );
          } else {
            await deliveries.retryLater(delivery.id, sendError.message);
          }
          return;
      }
    }
  }
}
