import type { Pool } from 'pg';

/** Что роль значит для сервиса (см. миграцию 049): автоназначение заявок и отборы после личного входа. */
export type TeamRoleKind = 'distributor' | 'coordinator' | 'senior';

export interface CoordinatorRow {
  id: number;
  name: string;
  /** Название роли из справочника `team_roles` — для показа. */
  role: string;
  role_id: number;
  role_kind: TeamRoleKind | null;
  source: string;
}

/**
 * Роль — ссылка на справочник (`{ id }`, так выбирает новый интерфейс) или название (`{ name }`: старый дашборд и
 * перенос таблицы церкви, где роль пишут словами; незнакомое название заводится в справочнике).
 */
export type RoleRef = { id: number } | { name: string };

export interface CoordinatorInput {
  name: string;
  role: RoleRef;
}

/** Строка координатора вместе с ролью: роль живёт в `team_roles`, а не текстом в самой строке. */
const COLUMNS = `c.id::int AS id, c.name, r.name AS role, c.role_id::int AS role_id, r.kind AS role_kind, c.source`;
const FROM = `coordinators c JOIN team_roles r ON r.id = c.role_id`;
/** Параметры роли для SQL: `COALESCE($id, team_role_id($name))`. */
const roleParams = (role: RoleRef): [number | null, string | null] => ('id' in role ? [role.id, null] : [null, role.name]);
const ROLE_SQL = (idParam: number) => `COALESCE($${idParam}::bigint, team_role_id($${idParam + 1}))`;

export class CoordinatorsRepo {
  constructor(private readonly db: Pool) {}

  async listActive(): Promise<CoordinatorRow[]> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE c.archived_at IS NULL ORDER BY r.name, c.name`,
    );
    return rows;
  }

  /** Заведение из дашборда: тот же человек может числиться и координатором группы,
   *  и ответственным по заявке — это один и тот же список людей на обе роли. */
  async create(input: CoordinatorInput, source: 'ui' | 'бот' | 'таблица' = 'ui'): Promise<CoordinatorRow> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO coordinators (name, role_id, source) VALUES ($1, ${ROLE_SQL(2)}, $4) RETURNING id::int AS id`,
      [input.name, ...roleParams(input.role), source],
    );
    return (await this.byId(rows[0]!.id))!;
  }

  private async byId(id: number): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<CoordinatorRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1`, [id]);
    return rows[0] ?? null;
  }

  /** Правка переводит строку из выгрузки под управление дашборда — как у групп и заявок. */
  async update(id: number, input: CoordinatorInput): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<{ id: number }>(
      `UPDATE coordinators SET
         name = $2, role_id = ${ROLE_SQL(3)},
         source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id::int AS id`,
      [id, input.name, ...roleParams(input.role)],
    );
    return rows[0] ? this.byId(rows[0].id) : null;
  }

  async findActive(id: number): Promise<CoordinatorRow | null> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1 AND c.archived_at IS NULL`, [id],
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
      await client.query(
        `UPDATE coordinators SET name = $2, role_id = ${ROLE_SQL(3)},
                source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
          WHERE id = $1`,
        [id, input.name, ...roleParams(input.role)],
      );
      const { rows } = await client.query<CoordinatorRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1`, [id]);
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
