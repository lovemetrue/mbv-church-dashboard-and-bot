import { AdminNotifier } from '../admin/notify.js';
import type { Deps } from '../deps.js';
import { dueBroadcast, localDate } from './schedule.js';

const TICK_MS = 30_000;

/**
 * Проверяет раз в полминуты, не пора ли отправить материал дня кампании.
 *
 * Ключ рассылки «day:N» и журнал доставки делают тик идемпотентным:
 * сколько раз ни сработай, участник получит материал один раз.
 * Поэтому бот, поднятый в середине дня, всё равно отправит утреннюю рассылку.
 */
export class CampaignScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly notifier: AdminNotifier;
  /** Дни, о незагруженном материале которых админов уже предупредили. */
  private readonly warned = new Set<number>();
  /** Дата последней чистки истории заявок: чистим раз в сутки, а не на каждом тике. */
  private lastRotation: string | null = null;

  constructor(
    private readonly deps: Deps,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.notifier = new AdminNotifier(deps);
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.deps.logger.error({ err }, 'ошибка в планировщике рассылки'));
    }, TICK_MS);
    // Первый тик сразу: досылаем то, что не ушло, пока бот был выключен.
    void this.tick().catch((err) => this.deps.logger.error({ err }, 'ошибка в планировщике рассылки'));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Раз в сутки удаляет закрытые заявки старше срока хранения. */
  private async rotateRequests(): Promise<void> {
    const today = localDate(this.now(), this.deps.schedule.timezone);
    if (this.lastRotation === today) return;
    this.lastRotation = today;

    const removed = await this.deps.requests.deleteOldClosed(this.deps.requestsRetentionDays);
    if (removed > 0) {
      this.deps.logger.info(
        { removed, retentionDays: this.deps.requestsRetentionDays },
        'история заявок почищена по сроку хранения',
      );
    }
  }

  async tick(): Promise<void> {
    // Рассылка может идти дольше тика, второй заход в это время не нужен.
    if (this.running) return;
    this.running = true;
    try {
      // Ротация истории идёт независимо от кампании: и до её старта, и после конца.
      await this.rotateRequests();

      const day = dueBroadcast(this.now(), this.deps.schedule);
      if (day === null) return;

      const content = await this.deps.campaign.getDay(day);
      if (!content) {
        if (!this.warned.has(day)) {
          this.warned.add(day);
          this.deps.logger.warn({ day }, 'материал дня не загружен, рассылка пропущена');
          await this.notifier.broadcast(
            `Материал дня ${day} не загружен, рассылка не ушла.\n\nЗагрузить: /setday ${day} текст`,
          );
        }
        return;
      }

      const key = `day:${day}`;
      const platforms = [...this.deps.platforms.keys()];
      const { created, queued } = await this.deps.deliveries.open(key, content.content, platforms);
      if (!created && queued === 0) return; // уже разослано, новых получателей нет

      const result = await this.deps.sender.run(key);
      this.deps.logger.info({ day, ...result }, 'рассылка дня отправлена');
    } finally {
      this.running = false;
    }
  }
}
