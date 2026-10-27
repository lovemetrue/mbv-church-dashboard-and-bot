import type { Pool } from 'pg';
import type { GroupStatus } from '../../core/groups.js';

/** Откуда взялась запись о группе. Видно в дашборде и определяет, что можно удалить. */
export type GroupSource = 'таблица' | 'бот' | 'ui';

/** Человек из справочника «Люди», на которого ссылается позиция ведущего или соведущего (миграция 054). */
export type PersonRef = { kind: 'user' | 'person'; id: number };

/** Что заводит бот: короткий набор из диалога служителя. */
export interface HomeGroupInput {
  leader: string;
  phone?: string | null;
  district: string;
  /**
   * Направление словами («Основное служение», «Филиал «Серебристый»», миграция 052): находится по названию
   * (`group_direction_id`); прежние слова формата («Молодежная») ложатся на новые, незнакомое — на основное.
   */
  direction: string;
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
  coLeader?: string | null;
  coLeaderPhone?: string | null;
  feedbackAt?: string | null;
  /** Дата открытия; пусто — не менять и не задавать (дату поставит база при открытии группы). */
  openedOn?: string | null;
  comment?: string | null;
  training?: string | null;
  checked?: boolean | null;
  /** «40 дней»: редактируемое свойство, автоматически включается по совпадению
   *  телефона с завершённой регистрацией участника кампании (см. GroupsRepo). */
  campaignRegistered?: boolean | null;
  /** «Не направлять»: группа скрыта из подбора. undefined при правке — не менять. */
  doNotRefer?: boolean | null;
  /**
   * «Камерная группа» (служителей или отдельного служения): людей не направляют, адрес и телефоны видят только лидеры,
   * ответственный координатор и полный вход. undefined при правке — не менять.
   */
  chamber?: boolean | null;
  /** «Работает только в кампанию» (бывший статус «Кампания»). undefined при правке — не менять. */
  campaignOnly?: boolean | null;
  /** Мест в группе; null — общее значение по умолчанию. undefined при правке — не менять (старый дашборд поля не знает). */
  capacity?: number | null;
  /** Человек на позиции ведущего и соведущего; null — отвязать, undefined при правке — не менять. */
  leaderRef?: PersonRef | null;
  coLeaderRef?: PersonRef | null;
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
  co_leader: string | null;
  co_leader_phone: string | null;
  feedback_at: string | null;
  /** Когда группа открылась: от этой даты считаются первые четыре месяца «новой» (миграция 040). null — неизвестно. */
  opened_on: string | null;
  comment: string | null;
  training: string | null;
  /** Направление (название из справочника `group_directions`) и его номер. */
  direction: string;
  direction_id: number;
  status: string;
  checked: boolean | null;
  campaign_registered: boolean;
  /** «Работает только в кампанию» (миграция 047, бывший статус «Кампания»). */
  campaign_only: boolean;
  do_not_refer: boolean;
  /** «Камерная группа» (миграция 052). */
  chamber: boolean;
  /** Мест в группе; null — общее значение по умолчанию. */
  capacity: number | null;
  /** Регистрация ведущего (users.id), если обращение «уже веду группу» сверено со справочником. */
  leader_user_id: number | null;
  /** Ведущий и соведущий как люди из справочника (миграция 054): регистрация или карточка, внесённая вручную. */
  leader_person_id?: number | null;
  co_leader_user_id?: number | null;
  co_leader_person_id?: number | null;
  /** Обращение «хочу открыть группу», из которого заведена эта потенциальная группа (миграция 032). */
  source_request_id?: number | null;
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
  co_leader: string | null;
  co_leader_phone: string | null;
  feedback_at: string | null;
  opened_on: string | null;
  comment: string | null;
  training: string | null;
  /** Направление словами (справочник `group_directions`). */
  direction: string;
  direction_id: number;
  status: string;
  checked: boolean | null;
  source: GroupSource;
  /** «40 дней»: редактируемое свойство, автоматически включается по совпадению
   *  телефона ведущего с завершённой регистрацией участника кампании. */
  campaign_registered: boolean;
  /** «Работает только в кампанию» (миграция 047, бывший статус «Кампания»). */
  campaign_only: boolean;
  /** «Не направлять»: из подбора такая группа скрыта. */
  do_not_refer: boolean;
  /** «Камерная группа»: из подбора скрыта, адрес и телефоны видят не все (см. `contactsVisible` в home-groups). */
  chamber: boolean;
  /** Мест в группе; null — общее значение по умолчанию. */
  capacity: number | null;
  /** Регистрация ведущего (users.id): связь появляется при разборе обращения «уже веду группу» или выбором в форме правки. */
  leader_user_id: number | null;
  /** Ведущий — карточка, внесённая вручную (persons.id); соведущий — регистрация или карточка (миграция 054). */
  leader_person_id: number | null;
  co_leader_user_id: number | null;
  co_leader_person_id: number | null;
  /** Обращение «хочу открыть группу», из которого заведена эта потенциальная группа (миграция 032). */
  source_request_id: number | null;
}

const COLUMNS = `no, leader, open_to_new, phone, phones, age, district, metro, address,
                 composition, day, "time", people, coordinator, feedback_at, comment,
                 training, direction_id, status, checked, campaign_registered, source, added_by,
                 added_platform, co_leader, co_leader_phone, do_not_refer, opened_on, capacity, campaign_only, chamber`;

/** Строка группы с названием направления: `RETURNING *` его не знает, поэтому запросы оборачиваются в этот выбор. */
const withDirection = (from: string): string =>
  `SELECT g.*, g.direction_id::int AS direction_id, d.name AS direction FROM ${from} g JOIN group_directions d ON d.id = g.direction_id`;

/** Параметры «менять ли, users.id, persons.id» для одной позиции: undefined — не менять, null — отвязать. */
const refParams = (ref: PersonRef | null | undefined): [boolean, number | null, number | null] =>
  ref === undefined ? [false, null, null] : [true, ref?.kind === 'user' ? ref.id : null, ref?.kind === 'person' ? ref.id : null];

const idOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

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
      `WITH ins AS (
         INSERT INTO groups (${COLUMNS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,group_direction_id($18),$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         RETURNING *
       ) ${withDirection('ins')}`,
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
        input.direction,
        input.status,
        input.checked ?? null,
        // Потенциальная группа по умолчанию участвует в «40 днях» (просьба служителей); заданное явно — как задали.
        input.campaignRegistered ?? input.status === 'Потенциальная',
        source,
        addedBy,
        platform,
        input.coLeader ?? null,
        input.coLeaderPhone ?? null,
        input.doNotRefer ?? false,
        input.openedOn ?? null,
        input.capacity ?? null,
        input.campaignOnly ?? false,
        input.chamber ?? false,
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
      `WITH upd AS (
         UPDATE groups SET
           no = $2, leader = $3, open_to_new = $4, phone = $5, phones = $6, age = $7,
           district = $8, metro = $9, address = $10, composition = $11, day = $12,
           "time" = $13, people = $14, coordinator = $15, feedback_at = $16, comment = $17,
           training = $18, direction_id = group_direction_id($19), status = $20, checked = $21, campaign_registered = $22,
           co_leader = $23, co_leader_phone = $24,
           do_not_refer = COALESCE($25, do_not_refer),
           chamber = COALESCE($30, chamber),
           campaign_only = COALESCE($29, campaign_only),
           opened_on = $26,
           capacity = CASE WHEN $27::boolean THEN $28::integer ELSE capacity END,
           leader_user_id      = CASE WHEN $31::boolean THEN $32::bigint ELSE leader_user_id END,
           leader_person_id    = CASE WHEN $31::boolean THEN $33::bigint ELSE leader_person_id END,
           co_leader_user_id   = CASE WHEN $34::boolean THEN $35::bigint ELSE co_leader_user_id END,
           co_leader_person_id = CASE WHEN $34::boolean THEN $36::bigint ELSE co_leader_person_id END,
           source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
         WHERE id = $1 AND archived_at IS NULL
         RETURNING *
       ) ${withDirection('upd')}`,
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
        input.direction,
        input.status,
        input.checked ?? null,
        input.campaignRegistered ?? false,
        input.coLeader ?? null,
        input.coLeaderPhone ?? null,
        input.doNotRefer ?? null,
        input.openedOn ?? null,
        input.capacity !== undefined,
        input.capacity ?? null,
        input.campaignOnly ?? null,
        input.chamber ?? null,
        ...refParams(input.leaderRef),
        ...refParams(input.coLeaderRef),
      ],
    );
    const row = rows[0];
    if (!row) return null;
    // Номер могли поменять на совпадающий с уже зарегистрированным участником —
    // пересчитываем, но только в сторону «да» (см. syncCampaignRegistered).
    return (await this.syncCampaignRegistered(row.id)) ?? row;
  }

  /** Одна живая (не убранная) группа по номеру. */
  /**
   * Можно ли завести группу по заявке: 'missing' — заявки нет (или удалена), число — по ней уже заведена действующая
   * группа (её номер), 'free' — можно.
   */
  async requestLinkState(requestId: number): Promise<'missing' | 'free' | number> {
    const { rows } = await this.db.query<{ request: boolean; group_id: number | null }>(
      `SELECT EXISTS (SELECT 1 FROM requests WHERE id = $1 AND archived_at IS NULL) AS request,
              (SELECT id::int FROM groups WHERE source_request_id = $1 AND archived_at IS NULL) AS group_id`,
      [requestId],
    );
    const row = rows[0]!;
    return !row.request ? 'missing' : row.group_id ?? 'free';
  }

  /**
   * Связать только что заведённую группу с заявкой: ведущий — человек из заявки (его регистрация, если есть), а
   * заявка помнит свою группу. Удалённая раньше группа по той же заявке связь отпускает: уникальность в базе общая.
   * false — по заявке успели завести другую действующую группу.
   */
  async linkToRequest(groupId: number, requestId: number): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE groups SET source_request_id = NULL WHERE source_request_id = $1 AND archived_at IS NOT NULL', [requestId]);
      await client.query(
        `UPDATE groups g SET source_request_id = $2,
                leader_user_id = COALESCE(g.leader_user_id, (SELECT user_id FROM requests WHERE id = $2))
          WHERE g.id = $1`,
        [groupId, requestId],
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string } | null)?.code === '23505') return false;
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * ФИО человека из «Людей» по ссылке; null — такого нет: незавершённой регистрации в «Людях» нет, а удалённую карточку
   * база приняла бы ссылкой молча. ФИО нужно, чтобы имя в группе совпадало с карточкой.
   */
  async personName(ref: PersonRef): Promise<string | null> {
    const { rows } = ref.kind === 'user'
      ? await this.db.query<{ name: string | null }>('SELECT full_name AS name FROM users WHERE id = $1 AND registration_no IS NOT NULL', [ref.id])
      : await this.db.query<{ name: string | null }>('SELECT full_name AS name FROM persons WHERE id = $1 AND archived_at IS NULL', [ref.id]);
    if (!rows[0]) return null;
    return rows[0].name?.trim() || 'Без имени';
  }

  /**
   * Поставить людей на позиции ведущего и соведущего у только что заведённой группы. Позицию, где уже есть ссылка
   * (ведущий из заявки — `linkToRequest`), не трогаем: undefined — не менять.
   */
  async setLinksIfEmpty(id: number, leader: PersonRef | undefined, coLeader: PersonRef | undefined): Promise<void> {
    const [lc, lu, lp] = refParams(leader);
    const [cc, cu, cp] = refParams(coLeader);
    await this.db.query(
      `UPDATE groups SET
         leader_user_id      = CASE WHEN $2::boolean AND leader_user_id IS NULL AND leader_person_id IS NULL THEN $3::bigint ELSE leader_user_id END,
         leader_person_id    = CASE WHEN $2::boolean AND leader_user_id IS NULL AND leader_person_id IS NULL THEN $4::bigint ELSE leader_person_id END,
         co_leader_user_id   = CASE WHEN $5::boolean AND co_leader_user_id IS NULL AND co_leader_person_id IS NULL THEN $6::bigint ELSE co_leader_user_id END,
         co_leader_person_id = CASE WHEN $5::boolean AND co_leader_user_id IS NULL AND co_leader_person_id IS NULL THEN $7::bigint ELSE co_leader_person_id END
       WHERE id = $1`,
      [id, lc, lu, lp, cc, cu, cp],
    );
  }

  /** Есть ли у группы человек на позиции ведущего (регистрация или карточка). */
  async hasLeaderLink(id: number): Promise<boolean> {
    const { rows } = await this.db.query<{ linked: boolean }>(
      'SELECT (leader_user_id IS NOT NULL OR leader_person_id IS NOT NULL) AS linked FROM groups WHERE id = $1', [id],
    );
    return rows[0]?.linked === true;
  }

  /**
   * Человек заявки («r» — старый ключ): заявка ссылается на регистрацию или карточку (миграция 057), на неё и ссылаемся.
   * Заявку без человека (старая, заведённая до триггера) связываем тут же — тем же правилом, что миграция. null — заявки нет.
   */
  async personFromRequest(requestId: number, _by: string): Promise<PersonRef | null> {
    const read = async () => (await this.db.query<{ user_id: number | null; person_id: number | null }>(
      'SELECT user_id::int AS user_id, person_id::int AS person_id FROM requests WHERE id = $1 AND archived_at IS NULL', [requestId],
    )).rows[0];
    let r = await read();
    if (!r) return null;
    if (r.user_id === null && r.person_id === null) {
      await this.db.query('SELECT request_link_person($1)', [requestId]);
      r = await read();
      if (!r) return null;
    }
    return r.user_id !== null ? { kind: 'user', id: r.user_id } : r.person_id !== null ? { kind: 'person', id: r.person_id } : null;
  }

  async findActive(id: number): Promise<GroupRow | null> {
    const { rows } = await this.db.query<GroupRow>(`${withDirection('groups')} WHERE g.id = $1 AND g.archived_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  async listActive(limit = 50): Promise<GroupRow[]> {
    const { rows } = await this.db.query<GroupRow>(
      `${withDirection('groups')} WHERE g.archived_at IS NULL ORDER BY g.created_at DESC, g.id DESC LIMIT $1`,
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
      `WITH upd AS (
         UPDATE groups g SET campaign_registered = true
          WHERE g.id = $1 AND g.campaign_registered = false
            AND EXISTS (SELECT 1 FROM users u WHERE u.complete = true AND u.phone = ANY(g.phones))
          RETURNING g.*
       ) ${withDirection('upd')}`,
      [id],
    );
    return rows[0] ?? null;
  }

  async archive(id: number): Promise<GroupRow | null> {
    const { rows } = await this.db.query<GroupRow>(
      `WITH upd AS (
         UPDATE groups
            SET archived_at = now(),
                source = CASE WHEN source = 'таблица' THEN 'ui' ELSE source END
          WHERE id = $1 AND archived_at IS NULL
          RETURNING *
       ) ${withDirection('upd')}`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Все группы для дашборда. Сортировка по номеру в реестре: так порядок совпадает
   * с таблицей церкви, а заведённые позже (без номера) идут в конце.
   */
  async forDashboard(): Promise<DashboardGroup[]> {
    // Имя ведущего и соведущего — из карточки связанного человека: ФИО правят в «Людях», и группа показывает его сразу.
    // Текст в самой группе — запасной: пока человек не выбран (группа из таблицы) или его карточку удалили.
    const { rows } = await this.db.query<GroupRow & { linked_leader: string | null; linked_co_leader: string | null }>(
      `SELECT x.*,
              COALESCE(NULLIF(btrim(lu.full_name), ''), NULLIF(btrim(lp.full_name), '')) AS linked_leader,
              COALESCE(NULLIF(btrim(cu.full_name), ''), NULLIF(btrim(cp.full_name), '')) AS linked_co_leader
         FROM (${withDirection('groups')} WHERE g.archived_at IS NULL) x
         LEFT JOIN users lu ON lu.id = x.leader_user_id AND lu.registration_no IS NOT NULL
         LEFT JOIN persons lp ON lp.id = x.leader_person_id AND lp.archived_at IS NULL
         LEFT JOIN users cu ON cu.id = x.co_leader_user_id AND cu.registration_no IS NOT NULL
         LEFT JOIN persons cp ON cp.id = x.co_leader_person_id AND cp.archived_at IS NULL
        ORDER BY x.no NULLS LAST, x.created_at, x.id`,
    );
    return rows.map((r) => ({
      id: r.id,
      no: r.no,
      leader: r.linked_leader ?? r.leader,
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
      co_leader: r.linked_co_leader ?? r.co_leader,
      co_leader_phone: r.co_leader_phone,
      feedback_at: r.feedback_at,
      opened_on: r.opened_on,
      comment: r.comment,
      training: r.training,
      direction: r.direction,
      direction_id: Number(r.direction_id),
      status: r.status,
      checked: r.checked,
      source: r.source,
      campaign_registered: r.campaign_registered,
      campaign_only: r.campaign_only,
      do_not_refer: r.do_not_refer,
      chamber: r.chamber,
      capacity: r.capacity ?? null,
      leader_user_id: idOrNull(r.leader_user_id),
      leader_person_id: idOrNull(r.leader_person_id),
      co_leader_user_id: idOrNull(r.co_leader_user_id),
      co_leader_person_id: idOrNull(r.co_leader_person_id),
      source_request_id: r.source_request_id === null || r.source_request_id === undefined ? null : Number(r.source_request_id),
    }));
  }
}
