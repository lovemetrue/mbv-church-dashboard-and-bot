import { noticeMessage } from '../core/placementNotice.js';
import { SendError, type Platform, type PlatformName } from '../core/platform.js';
import type { PlacementNoticesRepo } from '../db/repos/placementNotices.repo.js';
import type { Logger } from '../logger.js';

/** Сколько раз пробовать при сбое сети или платформы, прежде чем записать «не дошло». */
const MAX_ATTEMPTS = 5;
const RETRY_MS = 60_000;
const BATCH = 20;

/**
 * Отправляет сообщения после «Утвердить» из очереди `placement_notices`. Очередь в базе, а не вызов из «Домашних
 * групп»: соединение с платформой есть только у бота, а утверждение не должно ждать сети и падать от неё.
 *
 * Доставка «хотя бы раз»: «отправлено» пишется после ответа платформы. Если бот упадёт ровно между ними, после
 * перезапуска сообщение уйдёт повторно — это лучше, чем потерять его молча.
 */
export class PlacementNoticeSender {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      notices: Pick<PlacementNoticesRepo, 'due' | 'markSent' | 'markFailed' | 'retryLater'>;
      platforms: Map<PlatformName, Platform>;
      logger: Logger;
    },
  ) {}

  start(intervalMs = 15_000): void {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  /** Один проход по очереди. Два прохода разом не идут: второй дождался бы первого и разослал бы то же. */
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain()
      .catch((err) => this.deps.logger.error({ err: err instanceof Error ? err.message : err }, 'сообщения после утверждения: сбой очереди'))
      .finally(() => { this.running = null; });
    return this.running;
  }

  private async drain(): Promise<void> {
    const due = await this.deps.notices.due(BATCH);
    for (const n of due) {
      const platform = this.deps.platforms.get(n.platform as PlatformName);
      if (!platform) {
        // Платформу выключили в ENABLED_PLATFORMS: ждать её бессмысленно, координатор увидит «не дошло».
        await this.deps.notices.markFailed(n.id, 'platform_off');
        continue;
      }
      try {
        await platform.sendMessage(n.chatId, noticeMessage(n));
        await this.deps.notices.markSent(n.id);
      } catch (err) {
        const kind = err instanceof SendError ? err.kind : 'other';
        if (kind === 'blocked' || kind === 'not_found') {
          await this.deps.notices.markFailed(n.id, kind);
        } else if (kind === 'rate_limited' || n.attempts + 1 < MAX_ATTEMPTS) {
          const wait = err instanceof SendError && err.retryAfterMs ? err.retryAfterMs : RETRY_MS;
          await this.deps.notices.retryLater(n.id, kind, wait);
        } else {
          await this.deps.notices.markFailed(n.id, kind);
        }
        // Без текста ошибки: в ответе платформы бывает текст сообщения, а в нём имя и телефон.
        this.deps.logger.warn({ notice: n.id, kind, attempt: n.attempts + 1 }, 'сообщение после утверждения не ушло');
      }
    }
  }
}
