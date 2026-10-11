import type { Pool } from 'pg';

export interface CoordinatorRow {
  id: number;
  name: string;
  role: string;
  source: string;
}

export interface CoordinatorInput {
  name: string;
  role: string;
}

export class CoordinatorsRepo {
  constructor(private readonly db: Pool) {}

  async listActive(): Promise<CoordinatorRow[]> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT id, name, role, source FROM coordinators
        WHERE archived_at IS NULL ORDER BY role, name`,
    );
    return rows;
  }

  /** Заведение из дашборда: тот же человек может числиться и координатором группы,
   *  и ответственным по заявке — это один и тот же список людей на обе роли. */
  async create(input: CoordinatorInput, source: 'ui' | 'бот' | 'таблица' = 'ui'): Promise<CoordinatorRow> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `INSERT INTO coordinators (name, role, source) VALUES ($1, $2, $3)
       RETURNING id, name, role, source`,
      [input.name, input.role, source],
    );
    return rows[0]!;
  }

  /** Правка переводит строку из выгрузки под управление дашборда — как у групп и заявок. */
  async update(id: number, input: CoordinatorInput): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `UPDATE coordinators SET
         name = $2, role = $3,
         source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, name, role, source`,
      [id, input.name, input.role],
    );
    return rows[0] ?? null;
  }

  async findActive(id: number): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<CoordinatorRow>(
      'SELECT id, name, role, source FROM coordinators WHERE id = $1 AND archived_at IS NULL', [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Правка с переименованием: имя координатора записано строкой в заявках («в работе у») и в группах,
   * поэтому при смене имени переписываем и их. Иначе нагрузка в сводке разошлась бы на «старое» и «новое» имя.
   */
  async rename(id: number, input: CoordinatorInput): Promise<CoordinatorRow | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query<{ name: string }>(
        'SELECT name FROM coordinators WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [id],
      );
      if (!before.rows[0]) { await client.query('ROLLBACK'); return null; }
      const { rows } = await client.query<CoordinatorRow>(
        `UPDATE coordinators SET name = $2, role = $3,
                source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
          WHERE id = $1 RETURNING id, name, role, source`,
        [id, input.name, input.role],
      );
      const old = before.rows[0].name;
      if (old !== input.name) {
        await client.query('UPDATE requests SET responsible = $2 WHERE responsible = $1', [old, input.name]);
        await client.query('UPDATE groups SET coordinator = $2 WHERE coordinator = $1', [old, input.name]);
      }
      await client.query('COMMIT');
      return rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Мягкое удаление: пропадает из дашборда, но остаётся в базе. */
  async archive(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE coordinators SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
