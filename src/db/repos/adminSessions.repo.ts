import type { Pool } from 'pg';

/** Шаг мини-диалога служителя: чего бот ждёт следующим сообщением. */
export type AdminState =
  | 'idle'
  | 'setday:day'
  | 'setday:text'
  | 'getday:day'
  | 'sendday:day'
  | 'sendday:confirm'
  | 'broadcast:text'
  | 'broadcast:confirm'
  // Выдача набора: служитель вводит номер регистрации или ФИО.
  | 'kit:query'
  // Очистка базы на время тестов: подтверждается отдельной кнопкой.
  | 'reset:confirm';

export interface AdminDialog {
  state: AdminState;
  data: { day?: number; body?: string };
}

export class AdminSessionsRepo {
  constructor(private readonly db: Pool) {}

  async get(userId: number): Promise<AdminDialog> {
    const { rows } = await this.db.query<AdminDialog>('SELECT state, data FROM admin_sessions WHERE user_id = $1', [
      userId,
    ]);
    return rows[0] ?? { state: 'idle', data: {} };
  }

  async set(userId: number, state: AdminState, data: AdminDialog['data'] = {}): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_sessions (user_id, state, data, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
         SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
      [userId, state, JSON.stringify(data)],
    );
  }

  async reset(userId: number): Promise<void> {
    await this.set(userId, 'idle', {});
  }
}
