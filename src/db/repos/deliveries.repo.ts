import type { Pool } from 'pg';
import type { PlatformName } from '../../core/platform.js';

export interface PendingDelivery {
  id: number;
  user_id: number;
  platform: PlatformName;
  chat_id: string;
  attempts: number;
}

/**
 * Рассылка и журнал доставки.
 *
 * Идемпотентность держится на двух вещах: broadcasts.key как первичный ключ
 * (одна рассылка на день кампании) и UNIQUE (broadcast_key, user_id) в deliveries.
 * Поэтому рестарт посреди рассылки продолжает работу, а не начинает её заново.
 */
export class DeliveriesRepo {
  constructor(private readonly db: Pool) {}

  /**
   * Создаёт рассылку и ставит в очередь участников включённых платформ.
   * Возвращает created=false, если такая рассылка уже создавалась: значит, её просто нужно дослать.
   *
   * Платформы фильтруются, чтобы при выключенном MAX его участники не висели
   * в очереди недоставленными и не мешали рассылке завершиться.
   */
  async open(key: string, body: string, platforms: PlatformName[]): Promise<{ created: boolean; queued: number }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO broadcasts (key, body) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        key,
        body,
      ]);
      const created = inserted.rowCount === 1;

      const queued = await client.query(
        `INSERT INTO deliveries (broadcast_key, user_id)
         SELECT $1, id FROM users
          WHERE registered_at IS NOT NULL AND blocked_at IS NULL AND platform = ANY($2)
         ON CONFLICT (broadcast_key, user_id) DO NOTHING`,
        [key, platforms],
      );
      await client.query('COMMIT');
      return { created, queued: queued.rowCount ?? 0 };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async body(key: string): Promise<string | null> {
    const { rows } = await this.db.query<{ body: string }>('SELECT body FROM broadcasts WHERE key = $1', [key]);
    return rows[0]?.body ?? null;
  }

  async exists(key: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM broadcasts WHERE key = $1', [key]);
    return rows.length > 0;
  }

  /** Незавершённые рассылки: их надо продолжить после рестарта. */
  async unfinishedKeys(): Promise<string[]> {
    const { rows } = await this.db.query<{ key: string }>(
      'SELECT key FROM broadcasts WHERE finished_at IS NULL ORDER BY created_at',
    );
    return rows.map((r) => r.key);
  }

  async nextPending(key: string, limit: number): Promise<PendingDelivery[]> {
    const { rows } = await this.db.query<PendingDelivery>(
      `SELECT d.id, d.user_id, d.attempts, u.platform, u.chat_id
         FROM deliveries d
         JOIN users u ON u.id = d.user_id
        WHERE d.broadcast_key = $1 AND d.status = 'pending'
        ORDER BY d.id
        LIMIT $2`,
      [key, limit],
    );
    return rows;
  }

  async pendingCount(key: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deliveries WHERE broadcast_key = $1 AND status = 'pending'`,
      [key],
    );
    return rows[0]?.n ?? 0;
  }

  async markSent(id: number): Promise<void> {
    await this.db.query(
      `UPDATE deliveries SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
      [id],
    );
  }

  async markBlocked(id: number, error: string): Promise<void> {
    await this.db.query(
      `UPDATE deliveries SET status = 'blocked', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
      [id, error],
    );
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db.query(
      `UPDATE deliveries SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
      [id, error],
    );
  }

  /** Оставляет в очереди для следующей попытки. */
  async retryLater(id: number, error: string): Promise<void> {
    await this.db.query(`UPDATE deliveries SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [id, error]);
  }

  async finish(key: string): Promise<void> {
    await this.db.query('UPDATE broadcasts SET finished_at = now() WHERE key = $1 AND finished_at IS NULL', [key]);
  }

  /** Получил ли конкретный человек эту рассылку: служителю сообщаем, что копия у него есть. */
  async wasDelivered(key: string, userId: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM deliveries WHERE broadcast_key = $1 AND user_id = $2 AND status = 'sent'`,
      [key, userId],
    );
    return rows.length > 0;
  }

  /**
   * Последние рассылки со сводкой доставки: дашборд показывает, дошло ли объявление.
   * Одним запросом, чтобы не дёргать summary по каждой рассылке отдельно.
   */
  async recent(limit = 10): Promise<
    { key: string; created_at: Date; finished: boolean; sent: number; pending: number; failed: number; blocked: number }[]
  > {
    const { rows } = await this.db.query<{
      key: string; created_at: Date; finished: boolean;
      sent: number; pending: number; failed: number; blocked: number;
    }>(
      `SELECT b.key, b.created_at, b.finished_at IS NOT NULL AS finished,
              count(d.*) FILTER (WHERE d.status = 'sent')::int    AS sent,
              count(d.*) FILTER (WHERE d.status = 'pending')::int AS pending,
              count(d.*) FILTER (WHERE d.status = 'failed')::int  AS failed,
              count(d.*) FILTER (WHERE d.status = 'blocked')::int AS blocked
         FROM broadcasts b
         LEFT JOIN deliveries d ON d.broadcast_key = b.key
        GROUP BY b.key, b.created_at, b.finished_at
        ORDER BY b.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async summary(key: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; n: number }>(
      'SELECT status, count(*)::int AS n FROM deliveries WHERE broadcast_key = $1 GROUP BY status',
      [key],
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
