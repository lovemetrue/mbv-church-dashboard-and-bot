import type { Pool } from 'pg';
import type { TeamRoleKind } from './coordinators.repo.js';

export interface TeamRoleRow {
  id: number;
  name: string;
  kind: TeamRoleKind | null;
  /** Сколько действующих людей в справочнике команды с этой ролью. */
  members: number;
}

export const TEAM_ROLE_KINDS: readonly TeamRoleKind[] = ['distributor', 'coordinator', 'senior'];

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string } | null)?.code === '23505';

/** Справочник ролей команды (миграция 049). Правит его только полный вход, в «Настройках». */
export class TeamRolesRepo {
  constructor(private readonly db: Pool) {}

  async list(): Promise<TeamRoleRow[]> {
    const { rows } = await this.db.query<TeamRoleRow>(
      `SELECT r.id::int AS id, r.name, r.kind,
              (SELECT count(*)::int FROM coordinator_roles cr JOIN coordinators c ON c.id = cr.coordinator_id
                WHERE cr.role_id = r.id AND c.archived_at IS NULL) AS members
         FROM team_roles r
        ORDER BY r.name`,
    );
    return rows;
  }

  /** Какие из этих ролей есть в справочнике. */
  async existing(ids: readonly number[]): Promise<number[]> {
    const { rows } = await this.db.query<{ id: number }>('SELECT id::int AS id FROM team_roles WHERE id = ANY($1::bigint[])', [ids]);
    return rows.map((r) => r.id);
  }

  /** null — такое название уже есть (без учёта регистра и пробелов по краям). */
  async create(name: string, kind: TeamRoleKind | null): Promise<number | null> {
    try {
      const { rows } = await this.db.query<{ id: number }>(
        'INSERT INTO team_roles (name, kind) VALUES ($1, $2) RETURNING id::int AS id', [name, kind],
      );
      return rows[0]!.id;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /** 'missing' — роли нет; 'taken' — название занято другой ролью. Переименование видно сразу у всех с этой ролью. */
  async update(id: number, name: string, kind: TeamRoleKind | null): Promise<'ok' | 'missing' | 'taken'> {
    try {
      const { rowCount } = await this.db.query('UPDATE team_roles SET name = $2, kind = $3 WHERE id = $1', [id, name, kind]);
      return (rowCount ?? 0) > 0 ? 'ok' : 'missing';
    } catch (err) {
      if (isUniqueViolation(err)) return 'taken';
      throw err;
    }
  }

  /**
   * Удалить можно только роль, на которую никто не ссылается, включая удалённых из справочника (их строки
   * остаются в базе со ссылкой). 'in_use' — роль ещё у кого-то есть.
   */
  async delete(id: number): Promise<'ok' | 'missing' | 'in_use'> {
    const { rows } = await this.db.query<{ used: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM coordinator_roles WHERE role_id = $1) AS used', [id],
    );
    if (rows[0]?.used) return 'in_use';
    try {
      const { rowCount } = await this.db.query('DELETE FROM team_roles WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0 ? 'ok' : 'missing';
    } catch (err) {
      // Между проверкой и удалением роль успели кому-то выставить: ссылка в базе этого не даст.
      if ((err as { code?: string } | null)?.code === '23503') return 'in_use';
      throw err;
    }
  }
}
