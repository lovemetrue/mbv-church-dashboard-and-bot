import type { Pool } from 'pg';

export interface StoredTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Сколько хранить: не дольше месяца и не больше двухсот сообщений на человека — чтобы таблица не росла без конца. */
const KEEP_DAYS = 30;
const KEEP_MESSAGES = 200;

/** История разговоров с помощником (см. миграцию 034). Ключ — логин того, кто спрашивал: чужую историю не увидеть. */
export class ChatHistoryRepo {
  constructor(private readonly db: Pool) {}

  /** Последние `n` сообщений человека в хронологическом порядке (старые первыми). */
  async recent(actor: string, n: number): Promise<StoredTurn[]> {
    const { rows } = await this.db.query<StoredTurn & { id: string }>(
      `SELECT id, role, content FROM assistant_chat_messages WHERE actor = $1 ORDER BY id DESC LIMIT $2`,
      [actor, n],
    );
    return rows.reverse().map(({ role, content }) => ({ role, content }));
  }

  /** Вопрос и ответ записываются вместе: пара не разъедется, если запись оборвётся посередине. */
  async append(actor: string, question: string, answer: string): Promise<void> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO assistant_chat_messages (actor, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
        [actor, question, answer],
      );
      await c.query(`DELETE FROM assistant_chat_messages WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
      await c.query(
        `DELETE FROM assistant_chat_messages WHERE actor = $1 AND id NOT IN
           (SELECT id FROM assistant_chat_messages WHERE actor = $1 ORDER BY id DESC LIMIT $2)`,
        [actor, KEEP_MESSAGES],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async clear(actor: string): Promise<number> {
    const r = await this.db.query(`DELETE FROM assistant_chat_messages WHERE actor = $1`, [actor]);
    return r.rowCount ?? 0;
  }
}
