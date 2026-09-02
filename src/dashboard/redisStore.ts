import { createClient, type RedisClientType } from 'redis';
import type { SessionStore } from './sessions.js';
import { logger } from '../logger.js';

/** Сессии в Redis: переживают перезапуск сервиса и позволяют выйти из системы. */
export class RedisSessionStore implements SessionStore {
  private readonly client: RedisClientType;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', (err) => logger.error({ err: (err as Error).message }, 'Redis: ошибка соединения'));
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    // Срок ставим только при первой ошибке, иначе блокировка продлевалась бы бесконечно.
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }
}
