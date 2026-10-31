import type { Pool } from 'pg';
import { groupCode } from '../../core/groups.js';

/** Группа, ведущему которой можно (или нельзя) написать, кто его координатор. */
export interface CoordinatorContactTarget {
  groupId: number;
  groupCode: string;
  leader: string;
  /** Координатор: ФИО из записи человека (миграция 056), иначе — как записан в группе; null — не закреплён. */
  coordinator: string | null;
  coordinatorPhone: string | null;
  /** Регистрация ведущего в боте, куда писать; null — ведущего в боте нет. */
  leaderUserId: number | null;
}

export interface LeaderMessageFailureRow {
  userId: number;
  name: string;
  status: 'failed' | 'blocked';
  error: string;
  /** Заведён вручную: чата с ботом нет. */
  manual: boolean;
  groupIds: number[];
}

/** Ключ учёта «кому что ушло». */
export const sentKey = (userId: number, text: string): string => `${userId}\u0000${text}`;

/** Последние десять цифр: так одинаково выглядят +7…, 8… и номер без кода страны. */
const phoneKey = (raw: string | null | undefined): string | null => {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Кому из ведущих рассылать контакт координатора. Группы — действующие и на паузе (у потенциальной ведущего ещё нет).
 * Координатор группы записан именем (`groups.coordinator`) — ключ связи с «Координаторами», телефон — из записи
 * человека, к которой привязан участник команды. Ведущего ищем в боте на любой подключённой платформе: прямая ссылка,
 * иначе регистрация с тем же телефоном (ведущий часто записан карточкой). Это не сообщение после «Утвердить»: там
 * только MAX, а здесь главное — чтобы связь вообще появилась.
 */
export class CoordinatorContactsRepo {
  constructor(private readonly db: Pool) {}

  /**
   * Что уже доставлено ведущим этой рассылкой: «регистрация + текст». Повтор не уходит, пока текст тот же; сменился
   * координатор или его телефон — текст другой, и ведущий получит новый контакт. Учёт — в той же `deliveries`, что ведёт
   * рассыльщик: «доставлено» он ставит только после ответа платформы.
   */
  async alreadySent(prefix: 'coordinator' | 'leaders' = 'coordinator'): Promise<Set<string>> {
    // Префикс — своя рассылка: «сообщение ведущим» (`leaders:`) ведёт тот же учёт, но отдельно от контактов координатора.
    const { rows } = await this.db.query<{ user_id: number; body: string }>(
      `SELECT d.user_id, b.body FROM deliveries d JOIN broadcasts b ON b.key = d.broadcast_key
        WHERE b.key LIKE $1 AND d.status = 'sent'`,
      [`${prefix}:%`],
    );
    return new Set(rows.map((r) => sentKey(Number(r.user_id), r.body)));
  }

  /** `statuses` — какие группы брать: контакт координатора — действующим и на паузе, «сообщение ведущим» — только действующим. */
  /**
   * Кому не дошло последнее «сообщение ведущим» (тот же текст ни одной рассылкой так и не доставлен). Имя — из регистрации,
   * группы — те, где этот человек записан ведущим напрямую; причина — как её записал рассыльщик.
   */
  async leaderMessageFailures(): Promise<LeaderMessageFailureRow[]> {
    const { rows } = await this.db.query<LeaderMessageFailureRow>(
      `WITH last AS (SELECT body FROM broadcasts WHERE key LIKE 'leaders:%' ORDER BY created_at DESC, key LIMIT 1)
       SELECT DISTINCT ON (u.id) u.id::int AS "userId", coalesce(nullif(btrim(u.full_name), ''), '') AS name,
              d.status, coalesce(d.last_error, '') AS error, u.chat_id = '' AS manual,
              coalesce((SELECT array_agg(g.id ORDER BY g.id) FROM groups g
                         WHERE g.leader_user_id = u.id AND g.archived_at IS NULL), '{}')::int[] AS "groupIds"
         FROM deliveries d
         JOIN broadcasts b ON b.key = d.broadcast_key AND b.key LIKE 'leaders:%'
         JOIN last ON last.body = b.body
         JOIN users u ON u.id = d.user_id
        WHERE d.status IN ('failed', 'blocked')
          AND NOT EXISTS (SELECT 1 FROM deliveries s JOIN broadcasts sb ON sb.key = s.broadcast_key
                           WHERE s.user_id = d.user_id AND s.status = 'sent' AND sb.key LIKE 'leaders:%' AND sb.body = b.body)
        ORDER BY u.id, b.created_at DESC`,
    );
    return rows.map((r) => ({ ...r, userId: Number(r.userId), groupIds: (r.groupIds ?? []).map(Number) }));
  }

  async targets(platforms: readonly string[], statuses: readonly string[] = ['Функционирует', 'На паузе']): Promise<CoordinatorContactTarget[]> {
    const { rows } = await this.db.query<{
      id: number; leader: string | null; coordinator: string | null; coord_fio: string | null; coord_phone: string | null;
      leader_user_id: number | null; leader_user_platform: string | null; leader_user_blocked: boolean | null; leader_user_chat: boolean | null;
      leader_person_phone: string | null; leader_user_phone: string | null; phones: string[] | null;
    }>(
      `SELECT g.id, g.leader, nullif(btrim(g.coordinator), '') AS coordinator, g.phones,
              g.leader_user_id, lu.platform AS leader_user_platform, lu.blocked_at IS NOT NULL AS leader_user_blocked, lu.chat_id <> '' AS leader_user_chat,
              lu.phone AS leader_user_phone, lp.phone AS leader_person_phone,
              CASE WHEN cu.id IS NOT NULL THEN cu.full_name WHEN cp.id IS NOT NULL THEN cp.full_name END AS coord_fio,
              CASE WHEN cu.id IS NOT NULL THEN cu.phone WHEN cp.id IS NOT NULL THEN cp.phone END AS coord_phone
         FROM groups g
         LEFT JOIN users lu   ON lu.id = g.leader_user_id
         LEFT JOIN persons lp ON lp.id = g.leader_person_id
         LEFT JOIN LATERAL (
           SELECT user_id, person_id FROM coordinators c
            WHERE c.archived_at IS NULL AND lower(btrim(c.name)) = lower(btrim(g.coordinator))
            ORDER BY c.id LIMIT 1
         ) c ON true
         LEFT JOIN users cu   ON cu.id = c.user_id
         LEFT JOIN persons cp ON cp.id = c.person_id
        WHERE g.archived_at IS NULL AND g.status = ANY($1::text[])
        ORDER BY g.id`,
      [statuses],
    );
    // Регистрации на подключённых платформах — по последним цифрам телефона, свежая первой. Заведённых вручную
    // (регистрация в интерфейсе, `createManual`) не берём: платформа у них записана, а чата с ботом нет (`chat_id` пустой),
    // и рассыльщик трижды писал в пустой чат — так 31.10 часть ведущих попала в «не дошло». Такой ведущий — «нет в боте».
    const byPhone = new Map<string, number>();
    const { rows: users } = await this.db.query<{ id: number; phone: string | null }>(
      `SELECT id, phone FROM users
        WHERE platform = ANY($1::text[]) AND blocked_at IS NULL AND phone IS NOT NULL AND chat_id <> ''
        ORDER BY registered_at DESC NULLS LAST, id DESC`,
      [platforms],
    );
    for (const u of users) {
      const k = phoneKey(u.phone);
      if (k && !byPhone.has(k)) byPhone.set(k, Number(u.id));
    }
    return rows.map((g) => {
      const direct = g.leader_user_id !== null && g.leader_user_platform !== null && platforms.includes(g.leader_user_platform) && !g.leader_user_blocked
        && g.leader_user_chat
        ? Number(g.leader_user_id) : null;
      const viaPhone = [g.leader_user_phone, g.leader_person_phone, ...(g.phones ?? [])]
        .map(phoneKey).map((k) => (k ? byPhone.get(k) ?? null : null)).find((x) => x !== null) ?? null;
      return {
        groupId: Number(g.id), groupCode: groupCode(Number(g.id)), leader: g.leader ?? '',
        coordinator: g.coordinator ? (g.coord_fio?.trim() || g.coordinator) : null,
        coordinatorPhone: g.coordinator ? g.coord_phone : null,
        leaderUserId: direct ?? viaPhone,
      };
    });
  }
}
