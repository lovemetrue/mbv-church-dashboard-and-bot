import type { Pool, PoolClient } from 'pg';

export interface StaffRow {
  id: number;
  login: string;
  full_name: string;
  email: string;
  role: 'admin' | 'super';
  password_hash: string | null;
  active: boolean;
  session_version: number;
  created_at: Date;
  password_set_at: Date | null;
  last_login_at: Date | null;
}

export interface StaffListRow extends StaffRow {
  has_pending_link: boolean;
}

export type TokenPurpose = 'invite' | 'reset';

/** Логин или почта заняты: уникальные индексы без учёта регистра. */
export class StaffConflict extends Error {
  constructor(readonly field: 'login' | 'email') {
    super(`staff ${field} taken`);
  }
}

const COLUMNS = `id::int AS id, login, full_name, email, role, password_hash, active, session_version,
                 created_at, password_set_at, last_login_at`;

/**
 * Личные входы: люди и их одноразовые ссылки на пароль. Всё, что меняет данные, пишет в журнал в той
 * же транзакции. В журнал не попадают ни почта, ни хеш пароля, ни токен.
 */
export class StaffRepo {
  constructor(private readonly db: Pool) {}

  private async tx<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const out = await work(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private static async audit(c: PoolClient, actor: string, action: string, staffId: number | null, after: unknown, note?: string): Promise<void> {
    await c.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after, note)
       VALUES ($1, 'home-groups', $2, 'staff', $3, $4::jsonb, $5)`,
      [actor, action, staffId, JSON.stringify(after), note ?? null],
    );
  }

  async list(): Promise<StaffListRow[]> {
    const { rows } = await this.db.query<StaffListRow>(
      `SELECT ${COLUMNS},
              EXISTS (SELECT 1 FROM staff_tokens t WHERE t.staff_id = staff.id AND t.used_at IS NULL AND t.expires_at > now()) AS has_pending_link
         FROM staff ORDER BY lower(full_name), id`,
    );
    return rows;
  }

  async byId(id: number): Promise<StaffRow | null> {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async byLogin(login: string): Promise<StaffRow | null> {
    const { rows } = await this.db.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE lower(login) = lower($1)`, [login]);
    return rows[0] ?? null;
  }

  async byLoginOrEmail(identifier: string): Promise<StaffRow | null> {
    const { rows } = await this.db.query<StaffRow>(
      `SELECT ${COLUMNS} FROM staff WHERE lower(login) = lower($1) OR lower(email) = lower($1) ORDER BY id LIMIT 1`,
      [identifier],
    );
    return rows[0] ?? null;
  }

  async logins(): Promise<Set<string>> {
    const { rows } = await this.db.query<{ login: string }>('SELECT login FROM staff');
    return new Set(rows.map((r) => r.login.toLowerCase()));
  }

  async create(input: { login: string; fullName: string; email: string; role: 'admin' | 'super' }, actor: string): Promise<StaffRow> {
    return this.tx(async (c) => {
      let id: number;
      try {
        const { rows } = await c.query<{ id: number }>(
          `INSERT INTO staff (login, full_name, email, role, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::int AS id`,
          [input.login, input.fullName, input.email, input.role, actor],
        );
        id = rows[0]!.id;
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505') throw new StaffConflict(e.constraint === 'staff_email_lower' ? 'email' : 'login');
        throw err;
      }
      await StaffRepo.audit(c, actor, 'staff.create', id, { login: input.login, role: input.role });
      const { rows } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1`, [id]);
      return rows[0]!;
    });
  }

  /** Правка данных. Отключение и смена роли повышают версию сессий: прежние входы человека закрываются. */
  async update(
    id: number, patch: { fullName?: string; email?: string; role?: 'admin' | 'super'; active?: boolean }, actor: string,
  ): Promise<StaffRow | null> {
    return this.tx(async (c) => {
      const { rows: before } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1 FOR UPDATE`, [id]);
      const old = before[0];
      if (!old) return null;
      const next = {
        full_name: patch.fullName ?? old.full_name,
        email: patch.email ?? old.email,
        role: patch.role ?? old.role,
        active: patch.active ?? old.active,
      };
      const closeSessions = next.active !== old.active || next.role !== old.role;
      try {
        await c.query(
          `UPDATE staff SET full_name = $2, email = $3, role = $4, active = $5,
                  session_version = session_version + CASE WHEN $6 THEN 1 ELSE 0 END
            WHERE id = $1`,
          [id, next.full_name, next.email, next.role, next.active, closeSessions],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new StaffConflict('email');
        throw err;
      }
      const changed: Record<string, unknown> = {};
      if (next.role !== old.role) changed['role'] = { was: old.role, now: next.role };
      if (next.active !== old.active) changed['active'] = { was: old.active, now: next.active };
      if (next.full_name !== old.full_name) changed['full_name'] = true;
      if (next.email !== old.email) changed['email'] = true;
      if (Object.keys(changed).length > 0) {
        await StaffRepo.audit(c, actor, next.active !== old.active ? (next.active ? 'staff.enable' : 'staff.disable') : 'staff.update', id, changed);
      }
      const { rows } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1`, [id]);
      return rows[0]!;
    });
  }

  /**
   * Выдать ссылку. Прежние неиспользованные ссылки этого человека гасятся: действует только последняя,
   * иначе потерянное старое письмо оставалось бы рабочим.
   */
  async issueToken(staffId: number, purpose: TokenPurpose, tokenHash: string, ttlSeconds: number, actor: string): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`UPDATE staff_tokens SET used_at = now() WHERE staff_id = $1 AND used_at IS NULL`, [staffId]);
      await c.query(
        `INSERT INTO staff_tokens (staff_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
        [staffId, tokenHash, purpose, ttlSeconds],
      );
      await StaffRepo.audit(c, actor, purpose === 'invite' ? 'staff.invite' : 'staff.reset_link', staffId, { purpose });
    });
  }

  /** Сколько ссылок на сброс выдано за последние `seconds`: ограничивает повторные запросы. */
  async recentTokens(staffId: number, seconds: number): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM staff_tokens WHERE staff_id = $1 AND created_at > now() - make_interval(secs => $2)`,
      [staffId, seconds],
    );
    return rows[0]!.n;
  }

  /** Человек по действующей ссылке (не использована, не истекла, пользователь не отключён); null — ссылка негодна. */
  async staffByToken(tokenHash: string): Promise<(StaffRow & { purpose: TokenPurpose }) | null> {
    const { rows } = await this.db.query<StaffRow & { purpose: TokenPurpose }>(
      `SELECT s.id::int AS id, s.login, s.full_name, s.email, s.role, s.password_hash, s.active, s.session_version,
              s.created_at, s.password_set_at, s.last_login_at, t.purpose
         FROM staff_tokens t JOIN staff s ON s.id = t.staff_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND s.active`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /**
   * Задать пароль по ссылке. Ссылка гасится в той же транзакции, под блокировкой: два нажатия разом
   * не зададут пароль дважды. Все прежние входы человека закрываются (версия сессий растёт).
   */
  async setPasswordByToken(tokenHash: string, passwordHash: string): Promise<StaffRow | null> {
    return this.tx(async (c) => {
      const { rows } = await c.query<{ id: number; staff_id: number; purpose: TokenPurpose }>(
        `SELECT t.id::int AS id, t.staff_id::int AS staff_id, t.purpose
           FROM staff_tokens t JOIN staff s ON s.id = t.staff_id
          WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND s.active
          FOR UPDATE OF t`,
        [tokenHash],
      );
      const token = rows[0];
      if (!token) return null;
      await c.query(`UPDATE staff_tokens SET used_at = now() WHERE staff_id = $1 AND used_at IS NULL`, [token.staff_id]);
      await c.query(
        `UPDATE staff SET password_hash = $2, password_set_at = now(), session_version = session_version + 1 WHERE id = $1`,
        [token.staff_id, passwordHash],
      );
      const { rows: staff } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1`, [token.staff_id]);
      await StaffRepo.audit(c, staff[0]!.login, 'staff.password_set', token.staff_id, { via: token.purpose });
      return staff[0]!;
    });
  }

  /** Событие без привязки к одной записи (включение режима, просьба о сбросе). */
  async auditEvent(actor: string, action: string, after: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, after) VALUES ($1, 'home-groups', $2, 'staff', $3::jsonb)`,
      [actor, action, JSON.stringify(after)],
    );
  }

  async recordLogin(id: number): Promise<void> {
    await this.db.query(`UPDATE staff SET last_login_at = now() WHERE id = $1`, [id]);
    await this.db.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, entity_id)
       SELECT login, 'home-groups', 'staff.login', 'staff', id FROM staff WHERE id = $1`,
      [id],
    );
  }

  /** Сколько действующих людей уже задали пароль: без них включать личные входы нельзя. */
  async activeWithPassword(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM staff WHERE active AND password_hash IS NOT NULL`);
    return rows[0]!.n;
  }
}
