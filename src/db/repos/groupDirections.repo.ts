import type { Pool } from 'pg';

export interface GroupDirectionRow {
  id: number;
  name: string;
  /** Сколько действующих групп с этим направлением. */
  groups: number;
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string } | null)?.code === '23505';

/**
 * Справочник направлений групп (миграция 052): «Основное служение», «Подростковое служение», «Молодёжное служение»,
 * филиалы. Правит его только полный вход, в «Настройках». Порядок — как добавляли: первым идёт основное, оно же
 * направление по умолчанию.
 */
export class GroupDirectionsRepo {
  constructor(private readonly db: Pool) {}

  async list(): Promise<GroupDirectionRow[]> {
    const { rows } = await this.db.query<GroupDirectionRow>(
      `SELECT d.id::int AS id, d.name,
              (SELECT count(*)::int FROM groups g WHERE g.direction_id = d.id AND g.archived_at IS NULL) AS groups
         FROM group_directions d
        ORDER BY d.position, d.id`,
    );
    return rows;
  }

  /** null — такое название уже есть (без учёта регистра и пробелов по краям). Новое встаёт в конец списка. */
  async create(name: string): Promise<number | null> {
    try {
      const { rows } = await this.db.query<{ id: number }>(
        `INSERT INTO group_directions (name, position)
         VALUES ($1, (SELECT coalesce(max(position), 0) + 1 FROM group_directions)) RETURNING id::int AS id`,
        [name],
      );
      return rows[0]!.id;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /** Переименование сразу видно у всех групп с этим направлением. */
  async rename(id: number, name: string): Promise<'ok' | 'missing' | 'taken'> {
    try {
      const { rowCount } = await this.db.query('UPDATE group_directions SET name = $2 WHERE id = $1', [id, name]);
      return (rowCount ?? 0) > 0 ? 'ok' : 'missing';
    } catch (err) {
      if (isUniqueViolation(err)) return 'taken';
      throw err;
    }
  }

  /** Удалить можно направление без групп, включая удалённые (их строки остаются в базе со ссылкой). */
  async delete(id: number): Promise<'ok' | 'missing' | 'in_use'> {
    const { rows } = await this.db.query<{ used: boolean }>('SELECT EXISTS (SELECT 1 FROM groups WHERE direction_id = $1) AS used', [id]);
    if (rows[0]?.used) return 'in_use';
    try {
      const { rowCount } = await this.db.query('DELETE FROM group_directions WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0 ? 'ok' : 'missing';
    } catch (err) {
      // Между проверкой и удалением направление успели поставить группе: ссылка в базе этого не даст.
      if ((err as { code?: string } | null)?.code === '23503') return 'in_use';
      throw err;
    }
  }
}
