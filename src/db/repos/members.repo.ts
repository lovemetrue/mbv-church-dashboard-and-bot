import type { Pool } from 'pg';

export interface MemberRow {
  id: number;
  group_id: number;
  full_name: string;
  phone: string | null;
  /** Дата вступления в виде «2026-09-01» (даты в этом проекте читаются строкой, см. pool.ts). */
  joined_on: string | null;
  note: string | null;
}

export interface MemberInput {
  fio: string;
  phone: string | null;
  joinedOn: string | null;
  note: string | null;
}

/** Состав групп, внесённый вручную. Хранится отдельно от групп: у таблицы церкви здесь только число участников. */
export class MembersRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<MemberRow[]> {
    const { rows } = await this.db.query<MemberRow>(
      `SELECT m.id::int AS id, m.group_id::int AS group_id, m.full_name, m.phone, m.joined_on::text AS joined_on, m.note
         FROM group_members m JOIN groups g ON g.id = m.group_id
        WHERE m.archived_at IS NULL AND g.archived_at IS NULL
        ORDER BY m.joined_on NULLS LAST, m.id`,
    );
    return rows;
  }

  async findActive(id: number): Promise<MemberRow | null> {
    const { rows } = await this.db.query<MemberRow>(
      `SELECT id::int AS id, group_id::int AS group_id, full_name, phone, joined_on::text AS joined_on, note
         FROM group_members WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** null — такой группы нет (или она убрана). */
  async add(groupId: number, input: MemberInput, by: string): Promise<number | null> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO group_members (group_id, full_name, phone, joined_on, note, created_by)
       SELECT g.id, $2, $3, $4::date, $5, $6 FROM groups g WHERE g.id = $1 AND g.archived_at IS NULL
       RETURNING id::int AS id`,
      [groupId, input.fio, input.phone, input.joinedOn, input.note, by],
    );
    return rows[0]?.id ?? null;
  }

  async update(id: number, input: MemberInput): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE group_members SET full_name = $2, phone = $3, joined_on = $4::date, note = $5
        WHERE id = $1 AND archived_at IS NULL`,
      [id, input.fio, input.phone, input.joinedOn, input.note],
    );
    return (rowCount ?? 0) > 0;
  }

  async archive(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE group_members SET archived_at = now() WHERE id = $1 AND archived_at IS NULL', [id]);
    return (rowCount ?? 0) > 0;
  }
}
