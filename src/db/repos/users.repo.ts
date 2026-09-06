import type { Pool } from 'pg';
import type { MdgStatus, ProfilePatch } from '../../core/fsm.js';
import type { PlatformName } from '../../core/platform.js';

export interface UserRow {
  id: number;
  platform: PlatformName;
  platform_user_id: string;
  chat_id: string;
  username: string | null;
  phone: string | null;
  full_name: string | null;
  church: string | null;
  mdg_status: MdgStatus | null;
  location: string | null;
  /** Возрастная категория («25-40»), а не число: так спрашивает анкета. */
  age: string | null;
  companions: string | null;
  leader_name: string | null;
  consent_at: Date | null;
  registration_no: number | null;
  /** Анкета доведена до конца, а не завершена досрочно. */
  complete: boolean;
  registered_at: Date | null;
  /** id служителя, если регистрировал не сам участник. */
  registered_by: string | null;
  preferred_contact: string | null;
  admin_comment: string | null;
  kit_issued_at: Date | null;
  kit_issued_by: string | null;
  blocked_at: Date | null;
  created_at: Date;
}

export interface Recipient {
  id: number;
  chat_id: string;
}

/** Соответствие полей анкеты колонкам: список закрытый, поэтому SQL собирается безопасно. */
const COLUMNS: Record<keyof ProfilePatch, string> = {
  fio: 'full_name',
  phone: 'phone',
  church: 'church',
  mdgStatus: 'mdg_status',
  location: 'location',
  age: 'age',
  leaderName: 'leader_name',
};

export class UsersRepo {
  constructor(private readonly db: Pool) {}

  /** Находит или создаёт пользователя. Chat id и username обновляем: они могут меняться. */
  async ensure(u: {
    platform: PlatformName;
    platformUserId: string;
    chatId: string;
    username?: string;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (platform, platform_user_id, chat_id, username)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, platform_user_id) DO UPDATE
         SET chat_id  = EXCLUDED.chat_id,
             username = COALESCE(EXCLUDED.username, users.username)
       RETURNING *`,
      [u.platform, u.platformUserId, u.chatId, u.username ?? null],
    );
    return rows[0]!;
  }

  async saveConsent(userId: number): Promise<void> {
    await this.db.query('UPDATE users SET consent_at = COALESCE(consent_at, now()) WHERE id = $1', [userId]);
  }

  /** Пишет ответы анкеты по шагам: брошенная анкета всё равно оставляет церкви контакт. */
  async savePatch(userId: number, patch: ProfilePatch): Promise<void> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined && value !== null);
    if (entries.length === 0) return;

    const sets: string[] = [];
    const values: unknown[] = [userId];
    for (const [key, value] of entries) {
      const column = COLUMNS[key as keyof ProfilePatch];
      if (!column) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return;

    await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, values);
  }

  /**
   * Присваивает номер регистрации и отмечает участника зарегистрированным.
   * Номер берём из последовательности, поэтому одновременные анкеты не получат одинаковый.
   * Повторный вызов номер не меняет.
   */
  async finishRegistration(userId: number, complete: boolean): Promise<number> {
    const { rows } = await this.db.query<{ registration_no: number }>(
      `UPDATE users
          SET registration_no = COALESCE(registration_no, nextval('registration_no_seq')::int),
              registered_at   = COALESCE(registered_at, now()),
              complete        = $2,
              blocked_at      = NULL
        WHERE id = $1
        RETURNING registration_no`,
      [userId, complete],
    );
    return rows[0]!.registration_no;
  }

  async markBlocked(userId: number): Promise<void> {
    await this.db.query('UPDATE users SET blocked_at = now() WHERE id = $1 AND blocked_at IS NULL', [userId]);
  }

  async findById(userId: number): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    return rows[0] ?? null;
  }

  /** Кто из перечисленных id уже писал боту: только им доходят уведомления. */
  async findByPlatformIds(platform: PlatformName, ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<UserRow>(
      'SELECT * FROM users WHERE platform = $1 AND platform_user_id = ANY($2)',
      [platform, ids],
    );
    return rows;
  }

  async findByRegistrationNo(no: number): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE registration_no = $1', [no]);
    return rows[0] ?? null;
  }

  /** Поиск по ФИО для выдачи набора: служитель может не знать номера. */
  async searchByName(query: string, limit = 10): Promise<UserRow[]> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users
        WHERE registration_no IS NOT NULL AND full_name ILIKE '%' || $1 || '%'
        ORDER BY full_name
        LIMIT $2`,
      [query.trim(), limit],
    );
    return rows;
  }

  /**
   * Участник, которого заводит служитель: своего чата с ботом у него нет,
   * поэтому platform_user_id синтетический, а chat_id пустой.
   */
  async createManual(input: {
    platform: PlatformName;
    byAdminId: string;
    fio: string;
    phone: string;
    church?: string;
    mdgStatus?: MdgStatus;
    location?: string;
    age?: string;
    preferredContact?: string;
    comment?: string;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, church, mdg_status,
                          location, age, preferred_contact, admin_comment, registered_by,
                          registration_no, registered_at, complete, consent_at)
       VALUES ($1, 'manual:' || nextval('registration_no_seq')::text, '', $2, $3, $4, $5, $6, $7, $8, $9, $10,
               nextval('registration_no_seq')::int, now(), true, now())
       RETURNING *`,
      [
        input.platform,
        input.fio,
        input.phone,
        input.church ?? null,
        input.mdgStatus ?? null,
        input.location ?? null,
        input.age ?? null,
        input.preferredContact ?? null,
        input.comment ?? null,
        input.byAdminId,
      ],
    );
    return rows[0]!;
  }

  async markKitIssued(userId: number, byAdminId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET kit_issued_at = now(), kit_issued_by = $2 WHERE id = $1 AND kit_issued_at IS NULL`,
      [userId, byAdminId],
    );
  }

  /** Участники, которым идёт рассылка: номер присвоен и бот не заблокирован. */
  async recipients(platform: PlatformName): Promise<Recipient[]> {
    const { rows } = await this.db.query<Recipient>(
      `SELECT id, chat_id FROM users
        WHERE platform = $1 AND registration_no IS NOT NULL AND blocked_at IS NULL
          -- Участник, которого заводил служитель, чата с ботом не имеет: писать некуда.
          AND chat_id <> ''
        ORDER BY id`,
      [platform],
    );
    return rows;
  }

  async stats(): Promise<
    {
      platform: PlatformName;
      registered: number;
      complete: number;
      incomplete: number;
      mdg_open: number;
      mdg_home: number;
      mdg_join: number;
      mdg_member: number;
      mdg_leader: number;
      kits_issued: number;
      blocked: number;
      unfinished: number;
    }[]
  > {
    const { rows } = await this.db.query(
      `SELECT platform,
              count(*) FILTER (WHERE registration_no IS NOT NULL)::int              AS registered,
              count(*) FILTER (WHERE registration_no IS NOT NULL AND complete)::int AS complete,
              count(*) FILTER (WHERE registration_no IS NOT NULL AND NOT complete)::int AS incomplete,
              count(*) FILTER (WHERE mdg_status = 'open')::int                      AS mdg_open,
              count(*) FILTER (WHERE mdg_status = 'home')::int                      AS mdg_home,
              count(*) FILTER (WHERE mdg_status = 'join')::int                      AS mdg_join,
              count(*) FILTER (WHERE mdg_status = 'member')::int                    AS mdg_member,
              count(*) FILTER (WHERE mdg_status = 'leader')::int                    AS mdg_leader,
              count(*) FILTER (WHERE kit_issued_at IS NOT NULL)::int                AS kits_issued,
              count(*) FILTER (WHERE blocked_at IS NOT NULL)::int                   AS blocked,
              count(*) FILTER (WHERE registration_no IS NULL)::int                  AS unfinished
         FROM users
        GROUP BY platform
        ORDER BY platform`,
    );
    return rows;
  }

  /** Выгрузка для церкви: все, кому присвоен номер регистрации. */
  async exportRows(): Promise<UserRow[]> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE registration_no IS NOT NULL ORDER BY registration_no`,
    );
    return rows;
  }
}
