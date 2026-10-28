import type { TeamRoleKind } from './coordinators.repo.js';
import type { Pool, PoolClient } from 'pg';
import type { Role } from '../../dashboard/sessions.js';

export interface StaffRow {
  id: number;
  login: string;
  full_name: string;
  /** null — заведён из справочника команды (миграция 048): почты нет, вход по логину и выданному паролю. */
  email: string | null;
  role: Role;
  password_hash: string | null;
  active: boolean;
  session_version: number;
  created_at: Date;
  password_set_at: Date | null;
  last_login_at: Date | null;
  /** Чья это запись в справочнике команды (`coordinators.id`); null — заведён вручную в «Пользователях». */
  coordinator_id: number | null;
  /** Человек из «Людей» (миграция 058): «u12» или «p7»; null — ФИО записи только строкой. */
  person_key: string | null;
}

/** Человек из «Людей» для учётной записи: регистрация или карточка; null — не связывать. */
export type StaffPersonRef = { userId: number } | { personId: number } | null;
const personColumns = (ref: StaffPersonRef | undefined): [number | null, number | null] =>
  !ref ? [null, null] : 'userId' in ref ? [ref.userId, null] : [null, ref.personId];

/** Человек из справочника команды и его учётная запись, если она есть. */
export interface TeamAccountRow {
  coordinator_id: number;
  name: string;
  team_role: string;
  staff_id: number | null;
  login: string | null;
  active: boolean | null;
  has_password: boolean;
  last_login_at: Date | null;
}

export interface StaffListRow extends StaffRow {
  has_pending_link: boolean;
  /** Выданный пароль хранится зашифрованным (миграция 063) и его можно открыть. */
  password_viewable: boolean;
  /** ФИО человека из «Людей», к которому привязана запись. */
  person_name: string | null;
  /** Участник команды: по связи `coordinator_id`, а без неё — по тому же ФИО (как `TEAM_ACCOUNT`). */
  team_coordinator_id: number | null;
  team_role: string | null;
}

export type TokenPurpose = 'invite' | 'reset';

/** Логин или почта заняты: уникальные индексы без учёта регистра. */
export class StaffConflict extends Error {
  constructor(readonly field: 'login' | 'email') {
    super(`staff ${field} taken`);
  }
}

const PERSON_KEY = (t: string) => `CASE WHEN ${t}user_id IS NOT NULL THEN 'u' || ${t}user_id WHEN ${t}person_id IS NOT NULL THEN 'p' || ${t}person_id END AS person_key`;
const COLUMNS = `id::int AS id, login, full_name, email, role, password_hash, active, session_version,
                 created_at, password_set_at, last_login_at, coordinator_id::int AS coordinator_id, ${PERSON_KEY('')}`;

/**
 * Участник команды для учётной записи `staff` (подзапрос, `c.id`): по связи `coordinator_id`, а без неё — тот же человек
 * из «Людей» (миграции 056, 058), затем то же ФИО в любом порядке слов (`person_name_key`). Без запасных путей запись,
 * заведённая вручную в «Пользователях», теряла имя и роли из справочника: катализатор не видел всего, координатор — своих
 * заявок («В работе у» с его именем из справочника не совпадало с ФИО записи).
 */
const MEMBER_OF_STAFF = (s: string) => `SELECT c.id FROM coordinators c
   WHERE c.archived_at IS NULL
     AND (c.id = ${s}.coordinator_id
          OR (${s}.coordinator_id IS NULL AND (
                (${s}.user_id IS NOT NULL AND c.user_id = ${s}.user_id)
             OR (${s}.person_id IS NOT NULL AND c.person_id = ${s}.person_id)
             OR person_name_key(c.name) = person_name_key(${s}.full_name))))
   ORDER BY (c.id = ${s}.coordinator_id) DESC NULLS LAST,
            ((c.user_id IS NOT DISTINCT FROM ${s}.user_id AND ${s}.user_id IS NOT NULL)
             OR (c.person_id IS NOT DISTINCT FROM ${s}.person_id AND ${s}.person_id IS NOT NULL)) DESC,
            c.id
   LIMIT 1`;

/**
 * Учётная запись человека из справочника команды: сначала связанная (`coordinator_id`), иначе заведённая вручную
 * с тем же ФИО в любом порядке слов (`person_name_key`, миграция 045) — чтобы не завести второго «Давида Родионова».
 */
const TEAM_ACCOUNT = `SELECT s.* FROM staff s
                       WHERE s.coordinator_id = c.id
                          OR (s.coordinator_id IS NULL AND person_name_key(s.full_name) = person_name_key(c.name))
                       ORDER BY (s.coordinator_id = c.id) DESC NULLS LAST, s.id LIMIT 1`;

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
              EXISTS (SELECT 1 FROM staff_tokens t WHERE t.staff_id = staff.id AND t.used_at IS NULL AND t.expires_at > now()) AS has_pending_link,
              (password_sealed IS NOT NULL AND password_hash IS NOT NULL) AS password_viewable,
              COALESCE((SELECT NULLIF(btrim(u.full_name), '') FROM users u WHERE u.id = staff.user_id),
                       (SELECT NULLIF(btrim(p.full_name), '') FROM persons p WHERE p.id = staff.person_id AND p.archived_at IS NULL)) AS person_name,
              tc.team_cid AS team_coordinator_id, NULLIF(coordinator_role_names(tc.team_cid), '') AS team_role
         FROM staff
         LEFT JOIN LATERAL (SELECT m.id::int AS team_cid FROM (${MEMBER_OF_STAFF('staff')}) m) tc ON true
        ORDER BY lower(full_name), id`,
    );
    return rows;
  }

  /** Выданный пароль в зашифрованном виде; null — не выдан или выдан до миграции 063. */
  async sealedPassword(id: number): Promise<string | null> {
    const { rows } = await this.db.query<{ sealed: string | null }>(
      'SELECT password_sealed AS sealed FROM staff WHERE id = $1 AND password_hash IS NOT NULL',
      [id],
    );
    return rows[0]?.sealed ?? null;
  }

  /** Кто открыл чужой пароль — в журнал, без самого пароля. */
  async auditPasswordViewed(actor: string, id: number): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after) VALUES ($1, 'home-groups', 'staff.password_viewed', 'staff', $2, '{}'::jsonb)`,
      [actor, id],
    );
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

  /** Есть ли такой человек в «Людях»: регистрация или действующая карточка. */
  async personExists(ref: NonNullable<StaffPersonRef>): Promise<boolean> {
    const { rowCount } = 'userId' in ref
      ? await this.db.query('SELECT 1 FROM users WHERE id = $1 AND registration_no IS NOT NULL', [ref.userId])
      : await this.db.query('SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL', [ref.personId]);
    return (rowCount ?? 0) > 0;
  }

  async create(input: { login: string; fullName: string; email: string | null; role: Role; person?: StaffPersonRef }, actor: string): Promise<StaffRow> {
    return this.tx(async (c) => {
      let id: number;
      try {
        const { rows } = await c.query<{ id: number }>(
          `INSERT INTO staff (login, full_name, email, role, created_by, user_id, person_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::int AS id`,
          [input.login, input.fullName, input.email, input.role, actor, ...personColumns(input.person)],
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
    id: number, patch: { fullName?: string; email?: string | null; role?: Role; active?: boolean; person?: StaffPersonRef }, actor: string,
  ): Promise<StaffRow | null> {
    return this.tx(async (c) => {
      const { rows: before } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1 FOR UPDATE`, [id]);
      const old = before[0];
      if (!old) return null;
      const next = {
        full_name: patch.fullName ?? old.full_name,
        email: patch.email !== undefined ? patch.email : old.email,
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
        // Ссылка на человека меняется, только если её прислали (null — отвязать).
        if (patch.person !== undefined) {
          await c.query('UPDATE staff SET user_id = $2, person_id = $3 WHERE id = $1', [id, ...personColumns(patch.person)]);
        }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new StaffConflict('email');
        throw err;
      }
      const changed: Record<string, unknown> = {};
      if (next.role !== old.role) changed['role'] = { was: old.role, now: next.role };
      if (next.active !== old.active) changed['active'] = { was: old.active, now: next.active };
      if (next.full_name !== old.full_name) changed['full_name'] = true;
      if (next.email !== old.email) changed['email'] = true;
      if (patch.person !== undefined) changed['person'] = patch.person !== null;
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
              s.created_at, s.password_set_at, s.last_login_at, s.coordinator_id::int AS coordinator_id, ${PERSON_KEY('s.')}, t.purpose
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
  async setPasswordByToken(tokenHash: string, passwordHash: string, sealed: string | null = null): Promise<StaffRow | null> {
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
        `UPDATE staff SET password_hash = $2, password_sealed = $3, password_set_at = now(), session_version = session_version + 1 WHERE id = $1`,
        [token.staff_id, passwordHash, sealed],
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

  /**
   * Как зовут человека в справочнике команды и его роли там (участник команды — `MEMBER_OF_STAFF`: связь, общий человек
   * или ФИО), а если в команде его нет — ФИО учётной записи. Ролей бывает несколько: смыслы приходят списком без повторов.
   */
  async displayName(login: string): Promise<{ name: string; teamRole: string | null; teamKinds: TeamRoleKind[] } | null> {
    const { rows } = await this.db.query<{ name: string; team_role: string | null; team_kinds: TeamRoleKind[] }>(
      `SELECT COALESCE(c.name, s.full_name) AS name, coordinator_role_names(c.id) AS team_role,
              ARRAY(SELECT DISTINCT r.kind FROM coordinator_roles cr JOIN team_roles r ON r.id = cr.role_id
                     WHERE cr.coordinator_id = c.id AND r.kind IS NOT NULL ORDER BY r.kind) AS team_kinds
         FROM staff s
         LEFT JOIN coordinators c ON c.id = (${MEMBER_OF_STAFF('s')})
        WHERE lower(s.login) = lower($1)`,
      [login],
    );
    const row = rows[0];
    return row ? { name: row.name, teamRole: row.team_role, teamKinds: row.team_kinds } : null;
  }

  /** Команда из справочника (координаторы, распределители) и их учётные записи; без удалённых из справочника. */
  async team(): Promise<TeamAccountRow[]> {
    const { rows } = await this.db.query<TeamAccountRow>(
      `SELECT c.id::int AS coordinator_id, c.name, coalesce(coordinator_role_names(c.id), '') AS team_role,
              a.id::int AS staff_id, a.login, a.active, (a.password_hash IS NOT NULL) AS has_password, a.last_login_at
         FROM coordinators c
         LEFT JOIN LATERAL (${TEAM_ACCOUNT}) a ON true
        WHERE c.archived_at IS NULL
        ORDER BY team_role, c.name, c.id`,
    );
    return rows.map((r) => ({ ...r, has_password: r.has_password === true }));
  }

  /** Человек из справочника команды и его учётная запись (null — ещё не заведена); null целиком — нет такого в справочнике. */
  async teamMember(coordinatorId: number): Promise<{ name: string; account: StaffRow | null } | null> {
    const { rows } = await this.db.query<{ name: string; account_id: number | null }>(
      `SELECT c.name, a.id::int AS account_id
         FROM coordinators c LEFT JOIN LATERAL (${TEAM_ACCOUNT}) a ON true
        WHERE c.id = $1 AND c.archived_at IS NULL`,
      [coordinatorId],
    );
    const row = rows[0];
    if (!row) return null;
    return { name: row.name, account: row.account_id === null ? null : await this.byId(row.account_id) };
  }

  /** Учётная запись для человека из справочника команды: обычный доступ, без почты, пароль задаётся следом. */
  async createForTeam(input: { login: string; fullName: string; coordinatorId: number }, actor: string): Promise<StaffRow> {
    return this.tx(async (c) => {
      let id: number;
      try {
        const { rows } = await c.query<{ id: number }>(
          // Человек — тот же, что у участника команды (миграция 058).
          `INSERT INTO staff (login, full_name, email, role, created_by, coordinator_id, user_id, person_id)
           SELECT $1, $2, NULL, 'admin', $3, $4, c.user_id, c.person_id FROM coordinators c WHERE c.id = $4
           RETURNING id::int AS id`,
          [input.login, input.fullName, actor, input.coordinatorId],
        );
        id = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new StaffConflict('login');
        throw err;
      }
      await StaffRepo.audit(c, actor, 'staff.create', id, { login: input.login, role: 'admin', from: 'team' });
      const { rows } = await c.query<StaffRow>(`SELECT ${COLUMNS} FROM staff WHERE id = $1`, [id]);
      return rows[0]!;
    });
  }

  /**
   * Пароль, выданный администратором. Ссылки на пароль гасятся, прежние входы человека закрываются (версия сессий
   * растёт); найденная по ФИО запись заодно связывается с человеком из справочника. В журнал — кто и кому, без пароля.
   */
  async setPassword(id: number, passwordHash: string, actor: string, coordinatorId: number | null = null, sealed: string | null = null): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`UPDATE staff_tokens SET used_at = now() WHERE staff_id = $1 AND used_at IS NULL`, [id]);
      await c.query(
        `UPDATE staff SET password_hash = $2, password_sealed = $4, password_set_at = now(), session_version = session_version + 1,
                coordinator_id = COALESCE(coordinator_id, $3)
          WHERE id = $1`,
        [id, passwordHash, coordinatorId, sealed],
      );
      await StaffRepo.audit(c, actor, 'staff.password_generated', id, {});
    });
  }

  /** Сколько действующих людей уже задали пароль: без них включать личные входы нельзя. */
  async activeWithPassword(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM staff WHERE active AND password_hash IS NOT NULL`);
    return rows[0]!.n;
  }
}
