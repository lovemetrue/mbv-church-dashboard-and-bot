import type { Pool } from 'pg';
import { redactPersonal } from '../../platform/settings/redact.js';

export interface ErrorRow {
  id: number;
  at: Date;
  service: string;
  message: string;
  context: string | null;
}

const MESSAGE_LIMIT = 500;
const CONTEXT_LIMIT = 200;
/** Журнал не должен расти без конца: записи старше срока удаляются при записи новых. */
export const KEEP_DAYS = 90;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Журнал ошибок сервисов. Запись никогда не бросает: сбой журнала не должен ронять то, что он описывает. */
export class ErrorsRepo {
  constructor(private readonly db: Pool) {}

  async record(service: string, message: string, context?: string | null): Promise<void> {
    try {
      await this.db.query(
        'INSERT INTO system_errors (service, message, context) VALUES ($1, $2, $3)',
        [clip(service, 60), clip(redactPersonal(message), MESSAGE_LIMIT), context ? clip(redactPersonal(context), CONTEXT_LIMIT) : null],
      );
      // Чистка раз в несколько записей, а не на каждой: достаточно, чтобы журнал не рос.
      if (Math.random() < 0.05) {
        await this.db.query(`DELETE FROM system_errors WHERE at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
      }
    } catch {
      /* журнал недоступен — молчим, исходная ошибка уже в логе процесса */
    }
  }

  async recent(limit = 200): Promise<ErrorRow[]> {
    const { rows } = await this.db.query<ErrorRow>(
      'SELECT id::int AS id, at, service, message, context FROM system_errors ORDER BY at DESC, id DESC LIMIT $1',
      [limit],
    );
    return rows;
  }
}
