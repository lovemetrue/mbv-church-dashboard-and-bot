import type { Pool } from 'pg';
import type { MdgStatus, RequestType } from '../../core/fsm.js';
import type { PlatformName } from '../../core/platform.js';
import { logger } from '../../logger.js';

/**
 * Статусы заявки — один набор и для того, что создаёт бот, и для того, что пришло
 * из листа ЗАЯВКИ. Заявка открыта, пока её не исполнили и не аннулировали.
 */
export const REQUEST_STATUSES = [
  'Новая',
  'В ожидании',
  'В работе',
  'На контроле',
  'Исполнена',
  'Аннулирована',
  'Не указан',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** По этим статусам заявка больше не в работе. */
export const CLOSED_STATUSES: readonly RequestStatus[] = ['Исполнена', 'Аннулирована'];

const OPEN_CONDITION = "status NOT IN ('Исполнена', 'Аннулирована') AND archived_at IS NULL";

export interface RequestWithUser {
  id: number;
  type: RequestType;
  text: string | null;
  status: RequestStatus;
  created_at: Date;
  /** null у заявок из таблицы церкви: там человека в боте нет. */
  user_id: number | null;
  platform: PlatformName;
  chat_id: string;
  phone: string | null;
  full_name: string | null;
  username: string | null;
  location: string | null;
  age: number | null;
  church: string | null;
  mdg_status: MdgStatus | null;
  companions: string | null;
  leader_name: string | null;
  registration_no: number | null;
  preferred_contact: string | null;
  /** Необязательные ответы анкеты, как написал человек. */
  schedule: string | null;
  address: string | null;
  origin: 'таблица' | 'бот' | 'ui';
}

// Человек заявки — регистрация или карточка в «Людях» (миграция 057); данные берутся из его записи, а поля самой
// заявки — только если человека нет (старая заявка). LEFT JOIN: у заявки из таблицы церкви участника в боте нет.
const WITH_USER = `
  SELECT r.id, r.type, r.text, r.status, r.created_at, r.origin,
         u.id AS user_id, u.platform, u.chat_id,
         coalesce(u.phone, p.phone, r.phone) AS phone,
         coalesce(u.full_name, p.full_name, r.fio) AS full_name,
         u.username,
         coalesce(u.location, p.place, r.place) AS location,
         coalesce(u.age, p.age) AS age, u.church, u.mdg_status,
         u.companions, u.leader_name, u.registration_no, u.preferred_contact,
         coalesce(u.schedule_raw, p.schedule) AS schedule, coalesce(u.address_raw, p.address) AS address
    FROM requests r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN persons p ON p.id = r.person_id`;


/** Заявка в том виде, в каком её ждёт дашборд: имена полей как в листе ЗАЯВКИ. */
export interface DashboardRequest {
  id: number;
  /** Человек заявки — регистрация (участник в боте или склеенный с ним по телефону, миграция 057)… */
  user_id: number | null;
  /** …или карточка в «Людях»; одно из двух. Оба null — только у старой удалённой заявки. */
  person_id: number | null;
  /**
   * Заявка «как пришла»: снимок из таблицы церкви, формы или анкеты бота. Текущие данные человека (поля выше) — из его
   * записи, а это для сверки.
   */
  raw: { fio: string | null; phone: string | null; phones: string[]; age: string | null; place: string | null; schedule: string | null; address: string | null };
  group_id: number | null;
  fio: string | null;
  responsible: string | null;
  status: RequestStatus;
  /** Дата заявки: из листа, а если её нет — дата появления записи. */
  date: string | null;
  phone: string | null;
  phones: string[];
  age: string | null;
  place: string | null;
  source: string | null;
  ministry: string | null;
  note: string | null;
  extra: string | null;
  recommended: string | null;
  recommended_at: string | null;
  final_group: string | null;
  cancel_reason: string | null;
  attendance: string | null;
  /** Что человек просит: вопрос, хочет открыть группу, хочет присоединиться. */
  type: RequestType;
  /** Текст вопроса, если заявка пришла из бота. */
  text: string | null;
  origin: 'таблица' | 'бот' | 'ui';
  /** Ответы из анкеты бота: какую церковь посещает и что выбрал про Малую группу. */
  church: string | null;
  mdg_status: MdgStatus | null;
  /** Кто ведущий у человека, если он уже состоит в группе или уже ведёт её — из анкеты бота. */
  leader_name: string | null;
  /** Удобные дни и время и адрес из анкеты бота — как написал человек. */
  schedule: string | null;
  address: string | null;
  /** Координатор отметил «нужен звонок» (новый интерфейс); у остальных false. */
  callback: boolean;
  /** Правки координатора: улица и удобное время свободным текстом (перекрывают анкету). */
  manual_street: string | null;
  manual_schedule: string | null;
  hobby: string | null;
  profession: string | null;
  family: string | null;
}

/** Поле человека: из регистрации, иначе из карточки, иначе (старая заявка без человека) — из самой заявки. */
const PERSON = (userCol: string, personCol: string, requestCol: string): string =>
  `CASE WHEN u.id IS NOT NULL THEN u.${userCol} WHEN p.id IS NOT NULL THEN p.${personCol} ELSE ${requestCol} END`;

/** Что можно заполнить в форме дашборда. */
export interface RequestInput {
  fio: string;
  type: RequestType;
  status: RequestStatus;
  groupId?: number | null;
  phone?: string | null;
  phones?: string[];
  age?: string | null;
  place?: string | null;
  responsible?: string | null;
  source?: string | null;
  ministry?: string | null;
  note?: string | null;
  extra?: string | null;
  recommended?: string | null;
  recommendedAt?: string | null;
  finalGroup?: string | null;
  cancelReason?: string | null;
  attendance?: string | null;
  requestedAt?: string | null;
  /** Улица и дом, удобное время, хобби, профессия, семья — те же поля, что правятся в карточке («Править данные»). */
  street?: string | null;
  schedule?: string | null;
  hobby?: string | null;
  profession?: string | null;
  family?: string | null;
}

// Колонки типа date приходят строкой (см. src/db/pool.ts); created_at — timestamptz,
// и его к дате приводит сам запрос через ::date.

export class RequestsRepo {
  constructor(private readonly db: Pool) {}

  /**
   * `origin` по умолчанию — 'бот': этим методом заводит заявку router.ts на каждый
   * ответ анкеты. Ручная регистрация из дашборда — тот же человек, тот же тип
   * заявки, но пришла она не из чата, поэтому передаёт 'ui' явно.
   */
  async create(userId: number, type: RequestType, text?: string, origin: 'таблица' | 'бот' | 'ui' = 'бот'): Promise<RequestWithUser> {
    const { rows } = await this.db.query<{ id: number }>(
      'INSERT INTO requests (user_id, type, text, origin) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, type, text ?? null, origin],
    );
    await this.afterCreate(rows[0]!.id, type, true);
    const created = await this.findById(rows[0]!.id);
    return created!;
  }

  /**
   * Что делается с только что созданной заявкой: «хочу в группу» получает распределителя (если ответственного не указали),
   * «хочу открыть» — потенциальную группу в справочнике. Это дополнения: если они не удались (например, база отвечает
   * ошибкой), заявка человека всё равно уже записана и не должна пропасть из-за них.
   */
  private async afterCreate(requestId: number, type: RequestType, mayAssign: boolean): Promise<void> {
    try {
      if (type === 'join_group' && mayAssign) await this.assignDistributor(requestId);
      if (type === 'lead_group') {
        await this.db.query('SELECT ensure_potential_group($1)', [requestId]);
        // Адрес и время, названные до регистрации, ложатся в группу сразу.
        await this.db.query('SELECT sync_potential_group(user_id) FROM requests WHERE id = $1 AND user_id IS NOT NULL', [requestId]);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, requestId }, 'заявка создана, но автоматическое назначение или потенциальная группа не удались');
    }
  }

  /**
   * Новой заявке «хочу в группу» назначается ответственный из «Команды»: тот, у кого роль «Распределитель» и сейчас меньше
   * всего открытых заявок. Так заявки раздаются поровну, а распределитель, зайдя под своим именем, сразу видит «свои».
   * Распределителей нет — заявка остаётся без ответственного, как раньше. Выбор идёт под замком: две заявки, пришедшие
   * одновременно, иначе достались бы одному и тому же человеку (оба видели бы его как «наименее загруженного»).
   */
  async assignDistributor(requestId: number): Promise<string | null> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('hg_auto_assign'))`);
      const { rows } = await c.query<{ name: string }>(
        `SELECT c.name
           FROM coordinators c
          WHERE c.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM coordinator_roles cr JOIN team_roles tr ON tr.id = cr.role_id
                         WHERE cr.coordinator_id = c.id AND tr.kind = 'distributor')
          ORDER BY (SELECT count(*) FROM requests r
                     WHERE r.responsible = c.name AND r.archived_at IS NULL AND r.status NOT IN ('Исполнена', 'Аннулирована')),
                   c.id
          LIMIT 1`,
      );
      const name = rows[0]?.name ?? null;
      if (name === null) { await c.query('COMMIT'); return null; }
      const done = await c.query(`UPDATE requests SET responsible = $2 WHERE id = $1 AND responsible IS NULL`, [requestId, name]);
      if ((done.rowCount ?? 0) > 0) {
        await c.query(
          `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
           VALUES ('авто-распределение', 'home-groups', 'request.assign', 'request', $1, $2::jsonb)`,
          [requestId, JSON.stringify({ responsible: name, auto: true })],
        );
      }
      await c.query('COMMIT');
      return done.rowCount ? name : null;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }


  /** Заведение заявки из формы дашборда: участника в боте у неё нет. */
  async createFromDashboard(input: RequestInput): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, phone, phones, age, place, responsible, source,
                             ministry, note, extra, recommended, recommended_at, final_group,
                             cancel_reason, attendance, requested_at, group_id,
                             manual_street, manual_schedule, hobby, profession, family_status, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'ui')
       RETURNING id`,
      [
        input.type,
        input.status,
        input.fio,
        input.phone ?? null,
        input.phones ?? [],
        input.age ?? null,
        input.place ?? null,
        input.responsible ?? null,
        input.source ?? null,
        input.ministry ?? null,
        input.note ?? null,
        input.extra ?? null,
        input.recommended ?? null,
        input.recommendedAt ?? null,
        input.finalGroup ?? null,
        input.cancelReason ?? null,
        input.attendance ?? null,
        input.requestedAt ?? null,
        input.groupId ?? null,
        input.street ?? null,
        input.schedule ?? null,
        input.hobby ?? null,
        input.profession ?? null,
        input.family ?? null,
      ],
    );
    await this.afterCreate(rows[0]!.id, input.type, !input.responsible);
    return rows[0]!.id;
  }

  /**
   * Ведение заявки из дашборда: смена статуса и ответственного.
   *
   * Переход в закрытый статус отмечается как обработка — так же, как это делала
   * команда /close в боте. Автором ставим «дашборд»: там вход по паролю, а не по id
   * служителя, и приписывать действие конкретному человеку было бы выдумкой.
   */
  /**
   * Быстрая смена статуса из списка — самое частое действие служителя.
   * Отдельно от полной правки, чтобы не гонять двадцать полей ради одного.
   *
   * `responsible`/`groupId` — необязательные параметры на случай вызова без них
   * (тогда поле не трогаем), а не просто «может быть null»: форма дашборда шлёт
   * их всегда, и пустой <select> — это явный null, означающий «снять выбор».
   * Раньше это писалось через coalesce($3, responsible), но coalesce не видит
   * разницы между «параметр не передали» и «передали null», и снятый в форме
   * выбор (группы или ответственного) молча возвращался к прежнему значению.
   * Различаем через отдельный флаг «поле присутствует» ($6/$7).
   */
  async setStatus(
    id: number,
    status: RequestStatus,
    responsible?: string | null,
    groupId?: number | null,
  ): Promise<boolean> {
    const closing = (CLOSED_STATUSES as readonly string[]).includes(status);
    const { rowCount } = await this.db.query(
      `UPDATE requests
          SET status = $2,
              responsible = CASE WHEN $6 THEN $3 ELSE responsible END,
              group_id = CASE WHEN $7 THEN $5 ELSE group_id END,
              handled_by = CASE WHEN $4 THEN 'дашборд' ELSE handled_by END,
              handled_at = CASE WHEN $4 THEN now() ELSE handled_at END
        WHERE id = $1 AND archived_at IS NULL`,
      [id, status, responsible ?? null, closing, groupId ?? null, responsible !== undefined, groupId !== undefined],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Правка заявки из дашборда: любое поле, включая статус.
   *
   * Перевод в закрытый статус отмечается как обработка — так же, как это делала команда
   * /close в боте. Автором ставим «дашборд»: вход там по паролю, а не по id служителя,
   * и приписывать действие конкретному человеку было бы выдумкой.
   */
  async updateFromDashboard(id: number, patch: RequestInput): Promise<boolean> {
    const closing = (CLOSED_STATUSES as readonly string[]).includes(patch.status);
    const { rowCount } = await this.db.query(
      `UPDATE requests SET
         type = $2, status = $3, fio = $4, phone = $5, phones = $6, age = $7, place = $8,
         responsible = $9, source = $10, ministry = $11, note = $12, extra = $13,
         recommended = $14, recommended_at = $15, final_group = $16, cancel_reason = $17,
         attendance = $18, requested_at = $19, group_id = $20,
         handled_by = CASE WHEN $21 THEN 'дашборд' ELSE handled_by END,
         handled_at = CASE WHEN $21 THEN now() ELSE handled_at END
       WHERE id = $1 AND archived_at IS NULL`,
      [
        id,
        patch.type,
        patch.status,
        patch.fio,
        patch.phone ?? null,
        patch.phones ?? [],
        patch.age ?? null,
        patch.place ?? null,
        patch.responsible ?? null,
        patch.source ?? null,
        patch.ministry ?? null,
        patch.note ?? null,
        patch.extra ?? null,
        patch.recommended ?? null,
        patch.recommendedAt ?? null,
        patch.finalGroup ?? null,
        patch.cancelReason ?? null,
        patch.attendance ?? null,
        patch.requestedAt ?? null,
        patch.groupId ?? null,
        closing,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Мягкое удаление заявки: со страницы исчезает, в базе остаётся.
   * След обращения человека стирать нельзя — это не то же самое, что аннулировать.
   */
  async archive(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE requests SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Все заявки для дашборда — и пришедшие из таблицы церкви, и созданные ботом.
   * У ботовых имя и телефон берутся от участника, у остальных — из самой заявки.
   */
  async forDashboard(): Promise<DashboardRequest[]> {
    const { rows } = await this.db.query<Omit<DashboardRequest, 'raw'> & {
      raw_fio: string | null; raw_phone: string | null; raw_phones: string[] | null; raw_age: string | null; raw_place: string | null;
      raw_schedule: string | null; raw_address: string | null;
    }>(
      // Данные человека — из его записи (миграция 057): регистрации или карточки. Поля самой заявки — снимок «как
      // пришла» (raw_*): по нему координатор сверяет, как система поняла заявку, но текущие данные из него не берутся.
      `SELECT r.id, r.user_id, r.person_id::int AS person_id, r.group_id,
              ${PERSON('full_name', 'full_name', 'r.fio')} AS fio,
              r.responsible, r.status,
              coalesce(r.requested_at, r.created_at::date) AS date,
              ${PERSON('phone', 'phone', 'r.phone')} AS phone,
              CASE WHEN u.id IS NOT NULL THEN array_remove(ARRAY[u.phone], NULL)
                   WHEN p.id IS NOT NULL THEN array_remove(ARRAY[p.phone], NULL)
                   WHEN array_length(r.phones, 1) > 0 THEN r.phones ELSE array_remove(ARRAY[r.phone], NULL) END AS phones,
              ${PERSON('age', 'age', 'r.age')} AS age,
              ${PERSON('location', 'place', 'r.place')} AS place,
              r.source, r.ministry, r.note, r.extra, r.recommended, r.recommended_at,
              r.final_group, r.cancel_reason, r.attendance, r.type, r.text, r.origin,
              -- Ответы из анкеты бота: у заявок из таблицы церкви участника нет, будет null.
              u.church, u.mdg_status, u.leader_name,
              ${PERSON('schedule_raw', 'schedule', 'r.manual_schedule')} AS schedule,
              ${PERSON('address_raw', 'address', 'r.manual_street')} AS address, r.callback,
              -- Правки координатора больше не отдельный слой: улица и время — данные человека (миграция 057).
              NULL::text AS manual_street, NULL::text AS manual_schedule,
              ${PERSON('hobby', 'hobby', 'r.hobby')} AS hobby, ${PERSON('profession', 'profession', 'r.profession')} AS profession,
              ${PERSON('family_status', 'family_status', 'r.family_status')} AS family,
              coalesce(r.fio, u.full_name) AS raw_fio, coalesce(r.phone, u.phone) AS raw_phone, r.phones AS raw_phones,
              coalesce(r.age, u.age) AS raw_age, coalesce(r.place, u.location) AS raw_place,
              u.schedule_raw AS raw_schedule, u.address_raw AS raw_address
         FROM requests r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN persons p ON p.id = r.person_id
        WHERE r.archived_at IS NULL
        ORDER BY coalesce(r.requested_at, r.created_at::date) DESC, r.id DESC`,
    );
    return rows.map(({ raw_fio, raw_phone, raw_phones, raw_age, raw_place, raw_schedule, raw_address, ...r }) => ({
      ...r,
      phones: r.phones ?? [],
      raw: {
        fio: raw_fio, phone: raw_phone, phones: raw_phones ?? [], age: raw_age, place: raw_place, schedule: raw_schedule, address: raw_address,
      },
    }));
  }

  async findById(id: number): Promise<RequestWithUser | null> {
    const { rows } = await this.db.query<RequestWithUser>(`${WITH_USER} WHERE r.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async listNew(limit = 20): Promise<RequestWithUser[]> {
    const { rows } = await this.db.query<RequestWithUser>(
      `${WITH_USER} WHERE r.${OPEN_CONDITION} ORDER BY r.created_at LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Служитель обработал заявку: позвонил человеку и закрыл её. */
  async markHandled(id: number, adminId: string): Promise<void> {
    await this.db.query(
      `UPDATE requests SET status = 'Исполнена', handled_by = $2, handled_at = now() WHERE id = $1`,
      [id, adminId],
    );
  }

  /** Виды заявок этого человека, которые служители ещё не закрыли. */
  async openTypes(userId: number): Promise<RequestType[]> {
    const { rows } = await this.db.query<{ type: RequestType }>(
      `SELECT DISTINCT type FROM requests WHERE user_id = $1 AND ${OPEN_CONDITION}`,
      [userId],
    );
    return rows.map((r) => r.type);
  }

  /** Сколько вопросов человека служители ещё не закрыли. Нужно, чтобы ограничить поток. */
  async openCount(userId: number, type: RequestType): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM requests WHERE user_id = $1 AND type = $2 AND ${OPEN_CONDITION}`,
      [userId, type],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Ротация истории: удаляем только закрытые заявки старше срока.
   * Открытые не трогаем ни при каком возрасте — старая открытая заявка это не история,
   * а человек, которому забыли позвонить, и стирать единственный след обращения нельзя.
   */
  async deleteOldClosed(retentionDays: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM requests
        WHERE status = ANY($2) AND created_at < now() - ($1 || ' days')::interval`,
      [retentionDays, CLOSED_STATUSES],
    );
    return rowCount ?? 0;
  }

  async countNew(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requests WHERE status = 'Новая' AND archived_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  }
}
