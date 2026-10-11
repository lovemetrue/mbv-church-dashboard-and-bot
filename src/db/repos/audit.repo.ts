import type { Pool } from 'pg';

export interface AuditRow {
  entity_id: number;
  at: Date;
  actor: string;
  action: string;
  after: Record<string, unknown> | null;
  note: string | null;
}

export interface AuditFullRow {
  id: number;
  at: Date;
  actor: string;
  service: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  before: unknown;
  after: unknown;
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

  /** Последние записи журнала по всем объектам — для раздела «Настройки». */
  async recent(limit = 200): Promise<AuditFullRow[]> {
    const { rows } = await this.db.query<AuditFullRow>(
      `SELECT id::int AS id, at, actor, service, action, entity_type, entity_id::int AS entity_id, before, after, note
         FROM audit_log ORDER BY at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Запись действия вне транзакции с данными (создание записей через интерфейс). */
  async write(actor: string, action: string, entityType: string, entityId: number | null, after: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after) VALUES ($1, 'home-groups', $2, $3, $4, $5::jsonb)`,
      [actor, action, entityType, entityId, JSON.stringify(after)],
    );
  }
}
