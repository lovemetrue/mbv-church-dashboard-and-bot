import type { Pool, PoolClient } from 'pg';

/** Что роль значит для сервиса (см. миграцию 049): автоназначение заявок и отборы после личного входа. */
export type TeamRoleKind = 'distributor' | 'coordinator' | 'senior';

export interface CoordinatorRow {
  id: number;
  name: string;
  /** Роли человека словами через запятую, по алфавиту, — для показа. */
  role: string;
  /** Ссылки на роли в справочнике `team_roles` (миграция 049): ролей у человека бывает несколько. */
  role_ids: number[];
  /** Смыслы его ролей без повторов: у «Координатора малых групп» и «Распределителя» сразу — оба. */
  role_kinds: TeamRoleKind[];
  source: string;
}

/**
 * Роль — ссылка на справочник (`{ id }`, так выбирает новый интерфейс) или название (`{ name }`: старый дашборд и
 * перенос таблицы церкви, где роль пишут словами; незнакомое название заводится в справочнике).
 */
export type RoleRef = { id: number } | { name: string };

export interface CoordinatorInput {
  name: string;
  /** Хотя бы одна роль; повторы не страшны. */
  roles: RoleRef[];
}

/** Строка координатора вместе с ролями: роли живут в `coordinator_roles`, а не текстом в самой строке. */
const COLUMNS = `c.id::int AS id, c.name, coalesce(coordinator_role_names(c.id), '') AS role,
  ARRAY(SELECT cr.role_id::int FROM coordinator_roles cr JOIN team_roles r ON r.id = cr.role_id
         WHERE cr.coordinator_id = c.id ORDER BY r.name) AS role_ids,
  ARRAY(SELECT DISTINCT r.kind FROM coordinator_roles cr JOIN team_roles r ON r.id = cr.role_id
         WHERE cr.coordinator_id = c.id AND r.kind IS NOT NULL ORDER BY r.kind) AS role_kinds,
  c.source`;

export class CoordinatorsRepo {
  constructor(private readonly db: Pool) {}

  async listActive(): Promise<CoordinatorRow[]> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT ${COLUMNS} FROM coordinators c
        WHERE c.archived_at IS NULL ORDER BY role, c.name`,
    );
    return rows;
  }

  /** Заведение из дашборда: тот же человек может числиться и координатором группы,
   *  и ответственным по заявке — это один и тот же список людей на обе роли. */
  async create(input: CoordinatorInput, source: 'ui' | 'бот' | 'таблица' = 'ui'): Promise<CoordinatorRow> {
    const created = await this.inTransaction(async (c) => {
      const { rows } = await c.query<{ id: number }>(
        'INSERT INTO coordinators (name, source) VALUES ($1, $2) RETURNING id::int AS id', [input.name, source],
      );
      await setRoles(c, rows[0]!.id, input.roles);
      return byId(c, rows[0]!.id);
    });
    return created!;
  }

  /** Правка переводит строку из выгрузки под управление дашборда — как у групп и заявок. */
  async update(id: number, input: CoordinatorInput): Promise<CoordinatorRow | null> {
    return this.inTransaction(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE coordinators SET name = $2, source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
          WHERE id = $1 AND archived_at IS NULL`,
        [id, input.name],
      );
      if (!rowCount) return null;
      await setRoles(c, id, input.roles);
      return byId(c, id);
    });
  }

  async findActive(id: number): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT ${COLUMNS} FROM coordinators c WHERE c.id = $1 AND c.archived_at IS NULL`, [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Правка с переименованием: имя координатора записано строкой в заявках («в работе у») и в группах,
   * поэтому при смене имени переписываем и их. Иначе нагрузка в сводке разошлась бы на «старое» и «новое» имя.
   */
  async rename(id: number, input: CoordinatorInput): Promise<CoordinatorRow | null> {
    return this.inTransaction(async (c) => {
      const before = await c.query<{ name: string }>(
        'SELECT name FROM coordinators WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [id],
      );
      if (!before.rows[0]) return null;
      await c.query(
        `UPDATE coordinators SET name = $2, source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END WHERE id = $1`,
        [id, input.name],
      );
      await setRoles(c, id, input.roles);
      const old = before.rows[0].name;
      if (old !== input.name) {
        await c.query('UPDATE requests SET responsible = $2 WHERE responsible = $1', [old, input.name]);
        await c.query('UPDATE groups SET coordinator = $2 WHERE coordinator = $1', [old, input.name]);
      }
      return byId(c, id);
    });
  }

  /** Мягкое удаление: пропадает из дашборда, но остаётся в базе. */
  async archive(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE coordinators SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /** null из работы откатывает транзакцию: «не нашли» не должно оставлять половину правки. */
  private async inTransaction<T>(work: (c: PoolClient) => Promise<T | null>): Promise<T | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query(result === null ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function byId(c: PoolClient, id: number): Promise<CoordinatorRow | null> {
  const { rows } = await c.query<CoordinatorRow>(`SELECT ${COLUMNS} FROM coordinators c WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Роли человека целиком заменяются переданными. Роль словами находит или заводит `team_role_id` (миграция 049).
 * Ссылки и названия идут двумя массивами одной длины: в каждой паре заполнено что-то одно.
 */
async function setRoles(c: PoolClient, coordinatorId: number, roles: readonly RoleRef[]): Promise<void> {
  await c.query('DELETE FROM coordinator_roles WHERE coordinator_id = $1', [coordinatorId]);
  await c.query(
    `INSERT INTO coordinator_roles (coordinator_id, role_id)
     SELECT $1, COALESCE(x.id, team_role_id(x.name)) FROM unnest($2::bigint[], $3::text[]) AS x(id, name)
     ON CONFLICT DO NOTHING`,
    [coordinatorId, roles.map((r) => ('id' in r ? r.id : null)), roles.map((r) => ('id' in r ? null : r.name))],
  );
}
