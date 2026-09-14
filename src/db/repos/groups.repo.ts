import type { Pool } from 'pg';
import type { GroupFormat, GroupStatus } from '../../core/groups.js';

/** Откуда взялась запись о группе. Видно в дашборде и определяет, что можно удалить. */
export type GroupSource = 'таблица' | 'бот' | 'ui';

/** Что заводит бот: короткий набор из диалога служителя. */
export interface HomeGroupInput {
  leader: string;
  phone?: string | null;
  district: string;
  format: GroupFormat;
  status: GroupStatus;
  people?: number | null;
}

/**
 * Полный набор полей группы — все столбцы листа «МАЛЫЕ ГРУППЫ (2026)».
 * Через форму дашборда можно заполнить любое из них.
 */
export interface GroupInput extends HomeGroupInput {
  no?: number | null;
  openToNew?: string | null;
  phones?: string[];
  age?: string | null;
  metro?: string | null;
  address?: string | null;
  composition?: string | null;
  day?: string | null;
  time?: string | null;
  coordinator?: string | null;
  feedbackAt?: string | null;
  comment?: string | null;
  training?: string | null;
  checked?: boolean | null;
  /** «40 дней»: редактируемое свойство, автоматически включается по совпадению
   *  телефона с завершённой регистрацией участника кампании (см. GroupsRepo). */
  campaignRegistered?: boolean | null;
}

export interface GroupRow {
  id: number;
  no: number | null;
  leader: string;
  open_to_new: string | null;
  phone: string | null;
  phones: string[];
  age: string | null;
  district: string;
  metro: string | null;
  address: string | null;
  composition: string | null;
  day: string | null;
  time: string | null;
  people: number | null;
  coordinator: string | null;
  feedback_at: string | null;
  comment: string | null;
  training: string | null;
  format: string;
  status: string;
  checked: boolean | null;
  campaign_registered: boolean;
  source: GroupSource;
  added_by: string | null;
  added_platform: string | null;
  created_at: Date;
}

/** Запись в том виде, в каком её ждёт дашборд: имена полей как в выгрузке таблицы. */
export interface DashboardGroup {
  /** Номер записи в базе: по нему её убирают со страницы. */
  id: number;
  no: number | null;
  leader: string;
  /** Телефон как записан (бывает с именами), phones — номера для ссылок «позвонить». */
  phone: string | null;
  phones: string[];
  open_to_new: string | null;
  age: string | null;
  district: string;
  metro: string | null;
  address: string | null;
  composition: string | null;
  day: string | null;
  time: string | null;
  people: number | null;
  coordinator: string | null;
  feedback_at: string | null;
  comment: string | null;
  training: string | null;
  format: string;
  status: string;
  checked: boolean | null;
  source: GroupSource;
  /** «40 дней»: редактируемое свойство, автоматически включается по совпадению
   *  телефона ведущего с завершённой регистрацией участника кампании. */
  campaign_registered: boolean;
}

const COLUMNS = `no, leader, open_to_new, phone, phones, age, district, metro, address,
                 composition, day, "time", people, coordinator, feedback_at, comment,
                 training, format, status, checked, campaign_registered, source, added_by,
                 added_platform`;

// Колонки типа date приходят строкой «2026-08-20» — так настроен пул (src/db/pool.ts).

export class GroupsRepo {
  constructor(private readonly db: Pool) {}

  /** Заведение из бота: заполнены только поля короткого диалога. */
  async add(input: HomeGroupInput, addedBy: string, platform: string): Promise<GroupRow> {
    return this.create({ ...input, phones: input.phone ? [input.phone] : [] }, 'бот', addedBy, platform);
  }

  /** Заведение с любым набором полей: используется формой дашборда и ботом. */
  async create(
    input: GroupInput,
    source: GroupSource,
    addedBy: string | null = null,
    platform: string | null = null,
  ): Promise<GroupRow> {
    const { rows } = await this.db.query<GroupRow>(
      `INSERT INTO groups (${COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        input.no ?? null,
        input.leader,
        input.openToNew ?? null,
        input.phone ?? null,
        input.phones ?? [],
        input.age ?? null,
        input.district,
        input.metro ?? null,
        input.address ?? null,
        input.composition ?? null,
        input.day ?? null,
        input.time ?? null,
        input.people ?? null,
        input.coordinator ?? null,
        input.feedbackAt ?? null,
        input.comment ?? null,
        input.training ?? null,
        input.format,
        input.status,
        input.checked ?? null,
        input.campaignRegistered ?? false,
        source,
        addedBy,
        platform,
      ],
    );
    const row = rows[0]!;
    // Ведущего могли выбрать из уже зарегистрированных участников (подбор в форме) —
    // тогда бейдж должен загореться сразу, не дожидаясь новой регистрации.
    return (await this.syncCampaignRegistered(row.id)) ?? row;
  }

  /**
   * Правка из дашборда.
   *
   * Правленая строка переходит под управление дашборда (source='ui'), даже если пришла
   * из выгрузки: импорт перезаливает всё, что помечено «таблица», и иначе затёр бы правку.
   * Убранную запись правка не поднимает — для этого её надо сначала вернуть.
   */
  async update(id: number, input: GroupInput): Promise<GroupRow | null> {
    const { rows } = await this.db.query<GroupRow>(
      `UPDATE groups SET
         no = $2, leader = $3, open_to_new = $4, phone = $5, phones = $6, age = $7,
         district = $8, metro = $9, address = $10, composition = $11, day = $12,
         "time" = $13, people = $14, coordinator = $15, feedback_at = $16, comment = $17,
         training = $18, format = $19, status = $20, checked = $21, campaign_registered = $22,
         source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
       WHERE id = $1 AND archived_at IS NULL
       RETURNING *`,
      [
        id,
        input.no ?? null,
        input.leader,
        input.openToNew ?? null,
        input.phone ?? null,
        input.phones ?? [],
        input.age ?? null,
        input.district,
        input.metro ?? null,
        input.address ?? null,
        input.composition ?? null,
        input.day ?? null,
        input.time ?? null,
        input.people ?? null,
        input.coordinator ?? null,
        input.feedbackAt ?? null,
        input.comment ?? null,
        input.training ?? null,
        input.format,
        input.status,
        input.checked ?? null,
        input.campaignRegistered ?? false,
      ],
    );
    const row = rows[0];
    if (!row) return null;
    // Номер могли поменять на совпадающий с уже зарегистрированным участником —
    // пересчитываем, но только в сторону «да» (см. syncCampaignRegistered).
    return (await this.syncCampaignRegistered(row.id)) ?? row;
  }

  async listActive(limit = 50): Promise<GroupRow[]> {
    const { rows } = await this.db.query<GroupRow>(
      `SELECT * FROM groups WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async countActive(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM groups WHERE archived_at IS NULL',
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Мягкое удаление: запись пропадает из дашборда, но остаётся в базе.
   * Как и правка, забирает строку из выгрузки под управление дашборда — иначе
   * следующий импорт вернул бы удалённое.
   */
  /**
   * Ведёт ли этот номер действующую домашнюю группу.
   *
   * Сверяем по phones — там номера в E.164, как их отдаёт normalizePhone. Колонка
   * phone для этого не годится: в ней номер записан как в таблице, вместе с именем
   * («8 (905) 263-73-89; Раиса»). Закрытые и приостановленные группы не считаем:
   * у такого ведущего группы сейчас нет, и открыть новую ему никто не мешает.
   */
  async activeLeaderByPhone(phone: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM groups
        WHERE archived_at IS NULL AND status = 'Функционирует' AND $1 = ANY(phones)
        LIMIT 1`,
      [phone],
    );
    return rows.length > 0;
  }

  /**
   * «40 дней»: включает бейдж всем действующим группам с этим номером — вызывается
   * при завершении анкеты участника в боте. Только включает: ручную отметку «нет»
   * этим не перезаписать, а повторный вызов для уже отмеченной группы безвреден.
   */
  async markCampaignRegisteredByPhone(phone: string): Promise<void> {
    await this.db.query(
      `UPDATE groups SET campaign_registered = true
        WHERE archived_at IS NULL AND campaign_registered = false AND $1 = ANY(phones)`,
      [phone],
    );
  }

  /**
   * То же самое, но с другой стороны: после заведения или правки группы проверяет,
   * не совпал ли её номер с уже завершённой регистрацией участника (например,
   * ведущего выбрали из подбора зарегистрированных). Тоже только включает.
   */
  private async syncCampaignRegistered(id: number): Promise<GroupRow | null> {
    const { rows } = await this.db.query<GroupRow>(
      `UPDATE groups g SET campaign_registered = true
        WHERE g.id = $1 AND g.campaign_registered = false
          AND EXISTS (SELECT 1 FROM users u WHERE u.complete = true AND u.phone = ANY(g.phones))
        RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  }

  async archive(id: number): Promise<GroupRow | null> {
    const { rows } = await this.db.query<GroupRow>(
      `UPDATE groups
          SET archived_at = now(),
              source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
        WHERE id = $1 AND archived_at IS NULL
        RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Все группы для дашборда. Сортировка по номеру в реестре: так порядок совпадает
   * с таблицей церкви, а заведённые позже (без номера) идут в конце.
   */
  async forDashboard(): Promise<DashboardGroup[]> {
    const { rows } = await this.db.query<GroupRow>(
      `SELECT * FROM groups WHERE archived_at IS NULL
        ORDER BY no NULLS LAST, created_at, id`,
    );
    return rows.map((r) => ({
      id: r.id,
      no: r.no,
      leader: r.leader,
      phone: r.phone,
      phones: r.phones ?? [],
      open_to_new: r.open_to_new,
      age: r.age,
      district: r.district,
      metro: r.metro,
      address: r.address,
      composition: r.composition,
      day: r.day,
      time: r.time,
      people: r.people,
      coordinator: r.coordinator,
      feedback_at: r.feedback_at,
      comment: r.comment,
      training: r.training,
      format: r.format,
      status: r.status,
      checked: r.checked,
      source: r.source,
      campaign_registered: r.campaign_registered,
    }));
  }
}
