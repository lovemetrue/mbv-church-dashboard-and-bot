import type { Pool } from 'pg';

/**
 * Ключ человека в справочнике: u12 — участник (users), r345 — человек из заявки без регистрации, p7 — карточка,
 * внесённая вручную (persons). Один и тот же ключ у человека во всём интерфейсе: в «Людях» и в составах групп.
 */
export type PersonRef = { kind: 'u' | 'r' | 'p'; id: number };

export function parsePersonKey(key: unknown): PersonRef | null {
  if (typeof key !== 'string') return null;
  const m = /^([urp])(\d{1,15})$/.exec(key);
  return m ? { kind: m[1] as PersonRef['kind'], id: Number(m[2]) } : null;
}

export const personKey = (ref: PersonRef): string => `${ref.kind}${ref.id}`;

/** Строка состава с уже подставленными данными человека из справочника (имя и телефон не копируются, а читаются по ссылке). */
export interface MemberRow {
  id: number;
  group_id: number;
  personKey: string;
  full_name: string;
  phone: string | null;
  /** Дата вступления в виде «2026-09-01» (даты в этом проекте читаются строкой, см. pool.ts). */
  joined_on: string | null;
  note: string | null;
}

export interface PersonRow {
  id: number;
  full_name: string;
  phone: string | null;
  age: string | null;
  place: string | null;
  note: string | null;
  address: string | null;
  schedule: string | null;
  hobby: string | null;
  profession: string | null;
  family: string | null;
  created_at: Date;
}

export interface PersonInput {
  fio: string;
  phone: string | null;
  age: string | null;
  place: string | null;
  note: string | null;
  address?: string | null;
  schedule?: string | null;
  hobby?: string | null;
  profession?: string | null;
  family?: string | null;
}

export type AddResult = { ok: true; id: number; personKey: string } | { ok: false; reason: 'no_group' | 'no_person' | 'duplicate' };

const MEMBER_SELECT = `
  SELECT m.id::int AS id, m.group_id::int AS group_id,
         CASE WHEN m.user_id IS NOT NULL THEN 'u' || m.user_id WHEN m.request_id IS NOT NULL THEN 'r' || m.request_id ELSE 'p' || m.person_id END AS "personKey",
         coalesce(u.full_name, r.fio, p.full_name) AS full_name,
         coalesce(u.phone, r.phone, p.phone) AS phone,
         m.joined_on::text AS joined_on, m.note
    FROM group_members m
    JOIN groups g ON g.id = m.group_id AND g.archived_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN requests r ON r.id = m.request_id AND r.archived_at IS NULL
    LEFT JOIN persons p ON p.id = m.person_id AND p.archived_at IS NULL
   WHERE m.archived_at IS NULL
     AND (m.user_id IS NOT NULL AND u.id IS NOT NULL OR m.request_id IS NOT NULL AND r.id IS NOT NULL OR m.person_id IS NOT NULL AND p.id IS NOT NULL)`;

/** Состав групп и карточки людей, внесённые вручную. */
export class MembersRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<MemberRow[]> {
    const { rows } = await this.db.query<MemberRow>(`${MEMBER_SELECT} ORDER BY m.joined_on NULLS LAST, m.id`);
    return rows;
  }

  async findActive(id: number): Promise<MemberRow | null> {
    const { rows } = await this.db.query<MemberRow>(`${MEMBER_SELECT} AND m.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async allPersons(): Promise<PersonRow[]> {
    const { rows } = await this.db.query<PersonRow>(
      'SELECT id::int AS id, full_name, phone, age, place, note, address, schedule, hobby, profession, family_status AS family, created_at FROM persons WHERE archived_at IS NULL ORDER BY id',
    );
    return rows;
  }

  async findPerson(id: number): Promise<PersonRow | null> {
    const { rows } = await this.db.query<PersonRow>(
      'SELECT id::int AS id, full_name, phone, age, place, note, address, schedule, hobby, profession, family_status AS family, created_at FROM persons WHERE id = $1 AND archived_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  /** Человек из справочника существует и может быть в составе: участник кампании, человек из заявки без регистрации или карточка. */
  private async personExists(c: Pool | import('pg').PoolClient, ref: PersonRef): Promise<boolean> {
    const sql = ref.kind === 'u'
      ? 'SELECT 1 FROM users WHERE id = $1 AND registration_no IS NOT NULL'
      : ref.kind === 'r'
        ? `SELECT 1 FROM requests WHERE id = $1 AND type = 'join_group' AND user_id IS NULL AND archived_at IS NULL`
        : 'SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL';
    return ((await c.query(sql, [ref.id])).rowCount ?? 0) > 0;
  }

  /** Уже направлен в эту группу через сервис (заявка «Исполнена»): второй раз вручную его вносить не нужно. */
  private async placedIn(c: Pool | import('pg').PoolClient, groupId: number, ref: PersonRef): Promise<boolean> {
    // У карточки заявки тоже бывают (миграция 057): человек из таблицы церкви, направленный через сервис.
    const where = ref.kind === 'u' ? 'user_id = $2' : ref.kind === 'p' ? 'person_id = $2' : 'id = $2';
    const { rowCount } = await c.query(
      `SELECT 1 FROM requests WHERE group_id = $1 AND status = 'Исполнена' AND type = 'join_group' AND archived_at IS NULL AND ${where}`,
      [groupId, ref.id],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Добавить человека из справочника в состав. */
  async add(groupId: number, ref: PersonRef, input: { joinedOn: string | null; note: string | null }, by: string): Promise<AddResult> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const r = await this.insert(c, groupId, ref, input, by);
      await c.query(r.ok ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** Новый человек «по плюсу»: карточка создаётся в справочнике и сразу попадает в состав — одним действием. */
  async addNewPerson(
    groupId: number, person: PersonInput, input: { joinedOn: string | null; note: string | null }, by: string,
  ): Promise<AddResult> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const group = await c.query('SELECT 1 FROM groups WHERE id = $1 AND archived_at IS NULL', [groupId]);
      if ((group.rowCount ?? 0) === 0) { await c.query('ROLLBACK'); return { ok: false, reason: 'no_group' }; }
      const created = await c.query<{ id: number }>(
        'INSERT INTO persons (full_name, phone, age, place, note, address, schedule, hobby, profession, family_status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::int AS id',
        [person.fio, person.phone, person.age, person.place, person.note, person.address ?? null, person.schedule ?? null, person.hobby ?? null, person.profession ?? null, person.family ?? null, by],
      );
      const r = await this.insert(c, groupId, { kind: 'p', id: created.rows[0]!.id }, input, by);
      await c.query(r.ok ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private async insert(
    c: import('pg').PoolClient, groupId: number, ref: PersonRef, input: { joinedOn: string | null; note: string | null }, by: string,
  ): Promise<AddResult> {
    const group = await c.query('SELECT 1 FROM groups WHERE id = $1 AND archived_at IS NULL FOR SHARE', [groupId]);
    if ((group.rowCount ?? 0) === 0) return { ok: false, reason: 'no_group' };
    // Старый ключ «r» (человек заявки): в состав вносится сам человек — регистрация или карточка (миграция 057).
    if (ref.kind === 'r') {
      const { rows } = await c.query<{ user_id: number | null; person_id: number | null }>(
        'SELECT user_id::int AS user_id, person_id::int AS person_id FROM requests WHERE id = $1 AND archived_at IS NULL', [ref.id],
      );
      const r = rows[0];
      if (r?.user_id != null) ref = { kind: 'u', id: r.user_id };
      else if (r?.person_id != null) ref = { kind: 'p', id: r.person_id };
    }
    if (!(await this.personExists(c, ref))) return { ok: false, reason: 'no_person' };
    if (await this.placedIn(c, groupId, ref)) return { ok: false, reason: 'duplicate' };
    const col = ref.kind === 'u' ? 'user_id' : ref.kind === 'r' ? 'request_id' : 'person_id';
    const exists = await c.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND ${col} = $2 AND archived_at IS NULL`, [groupId, ref.id]);
    if ((exists.rowCount ?? 0) > 0) return { ok: false, reason: 'duplicate' };
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO group_members (group_id, ${col}, joined_on, note, created_by) VALUES ($1, $2, $3::date, $4, $5) RETURNING id::int AS id`,
      [groupId, ref.id, input.joinedOn, input.note, by],
    );
    return { ok: true, id: rows[0]!.id, personKey: `${ref.kind}${ref.id}` };
  }

  async update(id: number, input: { joinedOn: string | null; note: string | null }): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'UPDATE group_members SET joined_on = $2::date, note = $3 WHERE id = $1 AND archived_at IS NULL',
      [id, input.joinedOn, input.note],
    );
    return (rowCount ?? 0) > 0;
  }

  async archive(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE group_members SET archived_at = now() WHERE id = $1 AND archived_at IS NULL', [id]);
    return (rowCount ?? 0) > 0;
  }

  async createPerson(input: PersonInput, by: string): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      'INSERT INTO persons (full_name, phone, age, place, note, address, schedule, hobby, profession, family_status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::int AS id',
      [input.fio, input.phone, input.age, input.place, input.note, input.address ?? null, input.schedule ?? null, input.hobby ?? null, input.profession ?? null, input.family ?? null, by],
    );
    return rows[0]!.id;
  }

  async updatePerson(id: number, input: PersonInput): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'UPDATE persons SET full_name = $2, phone = $3, age = $4, place = $5, note = $6, address = $7, schedule = $8, hobby = $9, profession = $10, family_status = $11 WHERE id = $1 AND archived_at IS NULL',
      [id, input.fio, input.phone, input.age, input.place, input.note, input.address ?? null, input.schedule ?? null, input.hobby ?? null, input.profession ?? null, input.family ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async archivePerson(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE persons SET archived_at = now() WHERE id = $1 AND archived_at IS NULL', [id]);
    return (rowCount ?? 0) > 0;
  }
}
