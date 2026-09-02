import type { Pool } from 'pg';
import type { Draft, FsmState } from '../../core/fsm.js';

export interface Session {
  state: FsmState;
  draft: Draft;
}

/**
 * Состояние диалога. Единственная точка доступа: если когда-нибудь понадобится
 * перенести состояния в Redis, меняется только этот класс.
 */
export class SessionsRepo {
  constructor(private readonly db: Pool) {}

  async get(userId: number): Promise<Session> {
    const { rows } = await this.db.query<{ state: FsmState; data: Draft }>(
      'SELECT state, data FROM sessions WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    return row ? { state: row.state, draft: row.data } : { state: 'idle', draft: {} };
  }

  async set(userId: number, state: FsmState, draft: Draft): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (user_id, state, data, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
         SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
      [userId, state, JSON.stringify(draft)],
    );
  }
}
