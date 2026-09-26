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

export interface LeaderCandidate {
  id: number;
  full_name: string | null;
  phone: string | null;
  church: string | null;
  mdg_status: MdgStatus | null;
  location: string | null;
  age: string | null;
}

/** Что можно заполнить, регистрируя человека вручную — из дашборда или командой служителя. */
export interface ManualRegistrationInput {
  fio: string;
  phone: string;
  church?: string;
  mdgStatus?: MdgStatus;
  /** Кто ведущий у человека, если он уже состоит в группе — как в анкете бота. */
  leaderName?: string;
  location?: string;
  age?: string;
  preferredContact?: string;
  comment?: string;
}

/** Строка списка регистраций для дашборда: номер, ответы анкеты и статус выдачи набора. */
export interface RegisteredParticipant {
  id: number;
  registration_no: number;
  full_name: string | null;
  phone: string | null;
  church: string | null;
  mdg_status: MdgStatus | null;
  registered_at: Date;
  /** У кого чата с ботом нет — не бот, а служитель завёл. */
  has_chat: boolean;
  kit_issued_at: Date | null;
  age: string | null;
  location: string | null;
}

/**
 * Номер регистрации — случайный, 4 знака, без ведущего нуля (1000-9999).
 * Раньше был последовательным (1, 2, 3…) — по правкам церкви сменили на случайный;
 * уже выданные последовательные номера не трогаем, меняется только генерация новых.
 */
const RANDOM_REGISTRATION_MIN = 1000;
const RANDOM_REGISTRATION_MAX = 9999;
const randomRegistrationNo = (): number =>
  RANDOM_REGISTRATION_MIN + Math.floor(Math.random() * (RANDOM_REGISTRATION_MAX - RANDOM_REGISTRATION_MIN + 1));

/** Совпадение случайного номера с уже занятым (UNIQUE на registration_no) — знак повторить попытку. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
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
    // COALESCE не трогает уже присвоенный номер — повторная попытка нужна только
    // когда его ещё нет и случайный черновик совпал с чьим-то чужим (редкость).
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const { rows } = await this.db.query<{ registration_no: number }>(
          `UPDATE users
              SET registration_no = COALESCE(registration_no, $3),
                  registered_at   = COALESCE(registered_at, now()),
                  complete        = $2,
                  blocked_at      = NULL
            WHERE id = $1
            RETURNING registration_no`,
          [userId, complete, randomRegistrationNo()],
        );
        return rows[0]!.registration_no;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 29) throw err;
      }
    }
    throw new Error('не удалось подобрать свободный номер регистрации');
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

  /**
   * Куда писать этим людям: id чата по id человека на платформе.
   *
   * В Telegram у личной переписки id чата совпадает с id человека, а в MAX нет:
   * бот отвечает участнику 27637540 в чат 428149719. Поэтому уведомления
   * служителям уходили на id человека и падали «404: Chat not found». Чат мы
   * знаем только с того момента, как человек боту написал: в карте его не будет,
   * пока этого не случилось.
   */
  async chatIds(platform: PlatformName, ids: string[]): Promise<Map<string, string>> {
    const rows = await this.findByPlatformIds(platform, ids);
    return new Map(rows.filter((u) => u.chat_id !== '').map((u) => [u.platform_user_id, u.chat_id]));
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
   * поэтому platform_user_id синтетический, а chat_id пустой. Номер регистрации
   * такой же случайный, как и в боте (см. randomRegistrationNo); он же идёт
   * в platform_user_id, поэтому и то и другое подбирается в одной попытке.
   */
  async createManual(input: ManualRegistrationInput & { platform: PlatformName; byAdminId: string }): Promise<UserRow> {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const no = randomRegistrationNo();
        // Номер передаём двумя параметрами: один участвует в конкатенации с текстом
        // (platform_user_id), другой идёт в целочисленную колонку — тот же $N на
        // оба места pg-driver трактует как один тип и падает на несовпадении.
        const { rows } = await this.db.query<UserRow>(
          `INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, church, mdg_status, leader_name,
                              location, age, preferred_contact, admin_comment, registered_by,
                              registration_no, registered_at, complete, consent_at)
           VALUES ($1, 'manual:' || $12::text, '', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $13, now(), true, now())
           RETURNING *`,
          [
            input.platform,
            input.fio,
            input.phone,
            input.church ?? null,
            input.mdgStatus ?? null,
            input.leaderName ?? null,
            input.location ?? null,
            input.age ?? null,
            input.preferredContact ?? null,
            input.comment ?? null,
            input.byAdminId,
            no,
            no,
          ],
        );
        return rows[0]!;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 29) throw err;
      }
    }
    throw new Error('не удалось подобрать свободный номер регистрации');
  }

  async markKitIssued(userId: number, byAdminId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET kit_issued_at = now(), kit_issued_by = $2 WHERE id = $1 AND kit_issued_at IS NULL`,
      [userId, byAdminId],
    );
  }

  /**
   * Удалить регистрацию из дашборда — жёстко, по явному решению церкви, в отличие
   * от групп/участников/заявок (там archive() — мягкое удаление). ON DELETE CASCADE
   * у sessions/requests/deliveries сам подчистит всё, что ссылалось на этого users.id.
   */
  async delete(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM users WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
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

  /**
   * Кандидаты в ведущие новой группы: анкета завершена, человек отметил, что готов
   * открыть группу или предоставить дом, и не заблокировал бота. Используется
   * дашбордом при заведении новой домашней группы.
   */
  async leaderCandidates(): Promise<LeaderCandidate[]> {
    const { rows } = await this.db.query<LeaderCandidate>(
      `SELECT id, full_name, phone, church, mdg_status, location, age
         FROM users
        WHERE complete = true AND mdg_status IN ('open', 'home') AND blocked_at IS NULL
        ORDER BY full_name`,
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

  /** Список регистраций для дашборда: свежие сверху, чтобы только что заведённая была видна сразу. */
  async listRegistered(): Promise<RegisteredParticipant[]> {
    const { rows } = await this.db.query<RegisteredParticipant>(
      `SELECT id, registration_no, full_name, phone, church, mdg_status, registered_at,
              chat_id <> '' AS has_chat, kit_issued_at, age, location
         FROM users
        WHERE registration_no IS NOT NULL
        ORDER BY registration_no DESC`,
    );
    return rows;
  }
}
