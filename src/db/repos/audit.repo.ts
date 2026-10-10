import type { Pool } from 'pg';

export interface AuditRow {
  entity_id: number;
  at: Date;
  actor: string;
  action: string;
  after: Record<string, unknown> | null;
  note: string | null;
}

/** Журнал действий (чтение). Пишут в него репозитории, которые меняют данные, в той же транзакции. */
export class AuditRepo {
  constructor(private readonly db: Pool) {}

  /** Действия над заявками — для ленты в карточке. */
  async requestEntries(): Promise<AuditRow[]> {
    const { rows } = await this.db.query<AuditRow>(
      `SELECT entity_id::int AS entity_id, at, actor, action, after, note
         FROM audit_log WHERE entity_type = 'request' ORDER BY at, id`,
    );
    return rows;
  }
}
