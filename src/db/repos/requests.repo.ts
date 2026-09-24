import type { Pool } from 'pg';
import type { MdgStatus, RequestType } from '../../core/fsm.js';
import type { PlatformName } from '../../core/platform.js';

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
}

// LEFT JOIN, а не JOIN: у заявки из таблицы церкви участника в боте нет.
// coalesce берёт данные участника, если он есть, иначе то, что записано в самой заявке.
const WITH_USER = `
  SELECT r.id, r.type, r.text, r.status, r.created_at,
         u.id AS user_id, u.platform, u.chat_id,
         coalesce(u.phone, r.phone) AS phone,
         coalesce(u.full_name, r.fio) AS full_name,
         u.username,
         coalesce(u.location, r.place) AS location,
         u.age, u.church, u.mdg_status,
         u.companions, u.leader_name, u.registration_no, u.preferred_contact
    FROM requests r
    LEFT JOIN users u ON u.id = r.user_id`;


/** Заявка в том виде, в каком её ждёт дашборд: имена полей как в листе ЗАЯВКИ. */
export interface DashboardRequest {
  id: number;
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
}

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
}

// Колонки типа date приходят строкой (см. src/db/pool.ts); created_at — timestamptz,
// и его к дате приводит сам запрос через ::date.

export class RequestsRepo {
  constructor(private readonly db: Pool) {}

  async create(userId: number, type: RequestType, text?: string): Promise<RequestWithUser> {
    const { rows } = await this.db.query<{ id: number }>(
      'INSERT INTO requests (user_id, type, text) VALUES ($1, $2, $3) RETURNING id',
      [userId, type, text ?? null],
    );
    const created = await this.findById(rows[0]!.id);
    return created!;
  }


  /** Заведение заявки из формы дашборда: участника в боте у неё нет. */
  async createFromDashboard(input: RequestInput): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, phone, phones, age, place, responsible, source,
                             ministry, note, extra, recommended, recommended_at, final_group,
                             cancel_reason, attendance, requested_at, group_id, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ui')
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
      ],
    );
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
    const { rows } = await this.db.query<{
      id: number; group_id: number | null; fio: string | null; responsible: string | null; status: RequestStatus;
      date: string | null; phone: string | null; phones: string[]; age: string | null;
      place: string | null; source: string | null; ministry: string | null; note: string | null;
      extra: string | null; recommended: string | null; recommended_at: string | null;
      final_group: string | null; cancel_reason: string | null; attendance: string | null;
      type: RequestType; text: string | null; origin: 'таблица' | 'бот' | 'ui';
      church: string | null; mdg_status: MdgStatus | null;
    }>(
      `SELECT r.id, r.group_id,
              coalesce(r.fio, u.full_name) AS fio,
              r.responsible, r.status,
              coalesce(r.requested_at, r.created_at::date) AS date,
              coalesce(r.phone, u.phone) AS phone,
              CASE WHEN array_length(r.phones, 1) > 0 THEN r.phones
                   WHEN u.phone IS NOT NULL THEN ARRAY[u.phone]
                   ELSE '{}'::text[] END AS phones,
              coalesce(r.age, u.age::text) AS age,
              coalesce(r.place, u.location) AS place,
              r.source, r.ministry, r.note, r.extra, r.recommended, r.recommended_at,
              r.final_group, r.cancel_reason, r.attendance, r.type, r.text, r.origin,
              -- Ответы из анкеты бота: у заявок из таблицы церкви участника нет, будет null.
              u.church, u.mdg_status
         FROM requests r
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.archived_at IS NULL
        ORDER BY coalesce(r.requested_at, r.created_at::date) DESC, r.id DESC`,
    );
    return rows.map((r) => ({ ...r, phones: r.phones ?? [] }));
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
