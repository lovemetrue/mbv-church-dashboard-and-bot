import type { Pool, PoolClient } from 'pg';
import { groupCode } from '../../core/groups.js';
import { ANSWERS_OF, type NoticeAnswer, type NoticeData, type NoticeRecipient } from '../../core/placementNotice.js';

/** Настройка «писать человеку и ведущему в MAX при утверждении». Пока не включена, утверждение никому не пишет. */
export const SETTING_NOTIFY = 'placement.notify';

/** Писать только в MAX: так решили для первого запуска, Telegram-участники считаются «не в боте». */
const NOTICE_PLATFORM = 'max';

/** Последние десять цифр: так одинаково выглядят +7…, 8… и номер без кода страны. Короче — не номер. */
const phoneKey = (raw: string | null | undefined): string | null => {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Регистрация в MAX, куда писать. Сначала прямая ссылка (заявка или группа указывает на регистрацию), потом —
 * регистрация с тем же телефоном: ведущий часто записан карточкой человека, а в боте он есть под своим номером.
 * Несколько регистраций с одним номером — берём закончившую анкету и самую свежую.
 */
async function findChatUser(c: PoolClient, directUserId: number | null, phones: readonly (string | null)[]): Promise<number | null> {
  if (directUserId !== null) {
    const { rows } = await c.query<{ id: number }>(
      `SELECT id FROM users WHERE id = $1 AND platform = $2 AND blocked_at IS NULL`, [directUserId, NOTICE_PLATFORM]);
    if (rows[0]) return Number(rows[0].id);
  }
  const keys = [...new Set(phones.map(phoneKey).filter((k): k is string => k !== null))];
  if (keys.length === 0) return null;
  const { rows } = await c.query<{ id: number }>(
    `SELECT id FROM users
      WHERE platform = $2 AND blocked_at IS NULL AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ANY($1::text[])
      ORDER BY registered_at DESC NULLS LAST, id DESC LIMIT 1`,
    [keys, NOTICE_PLATFORM],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Ставит сообщения в очередь в транзакции утверждения: утверждение откатилось — и сообщений нет. Отправляет бот
 * (`PlacementNoticeSender`). Не дошедшие с прошлого утверждения этой заявки снимаются: писать надо про последнюю группу.
 */
export async function enqueuePlacementNotices(c: PoolClient, requestId: number, groupId: number, actor: string): Promise<void> {
  await cancelQueuedNotices(c, requestId);
  const setting = await c.query<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1', [SETTING_NOTIFY]);
  if (setting.rows[0]?.value !== true) return;

  const { rows: [r] } = await c.query<{ user_id: number | null; phone: string | null; phones: string[] | null; person_phone: string | null; user_phone: string | null }>(
    `SELECT r.user_id, r.phone, r.phones, p.phone AS person_phone, u.phone AS user_phone
       FROM requests r LEFT JOIN persons p ON p.id = r.person_id LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = $1`,
    [requestId],
  );
  const { rows: [g] } = await c.query<{ leader_user_id: number | null; phones: string[] | null; person_phone: string | null; user_phone: string | null }>(
    `SELECT g.leader_user_id, g.phones, p.phone AS person_phone, u.phone AS user_phone
       FROM groups g LEFT JOIN persons p ON p.id = g.leader_person_id LEFT JOIN users u ON u.id = g.leader_user_id
      WHERE g.id = $1`,
    [groupId],
  );
  if (!r || !g) return;
  const person = await findChatUser(c, r.user_id === null ? null : Number(r.user_id), [r.user_phone, r.person_phone, ...(r.phones ?? []), r.phone]);
  // groups.phone не берём: там бывает несколько номеров с именами одной строкой, а phones — уже разобранные.
  const leader = await findChatUser(c, g.leader_user_id === null ? null : Number(g.leader_user_id), [g.user_phone, g.person_phone, ...(g.phones ?? [])]);
  for (const [recipient, userId] of [['person', person], ['leader', leader]] as const) {
    await c.query(
      `INSERT INTO placement_notices (request_id, group_id, recipient, user_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, groupId, recipient, userId, userId === null ? 'no_chat' : 'queued', actor],
    );
  }
}

/** Утверждение отменили (вернули в работу, утвердили заново) — недоотправленное уже неправда. */
export async function cancelQueuedNotices(c: PoolClient, requestId: number): Promise<void> {
  await c.query(`UPDATE placement_notices SET status = 'cancelled' WHERE request_id = $1 AND status = 'queued'`, [requestId]);
}

/**
 * Человек нажал «Группа не подходит»: заявка снова «В работе» с отметкой «нужен звонок» (в «Перезвонить» её увидят), а
 * группа записана отклонённой — заново её не предложат. Ответственный остаётся: он и перезвонит. То же, что ручной
 * «Вернуть в работу» (`PlacementRepo.reopen`) плюс отказ от группы; та же логика — в бэкфилле (миграция 067).
 * Только если заявка всё ещё утверждена именно в эту группу: переутверждённую в другую или уже возвращённую не трогаем.
 */
async function reopenDeclined(c: PoolClient, requestId: number, groupId: number): Promise<boolean> {
  const { rows } = await c.query<{ group_id: number; final_group: string | null }>(
    `SELECT group_id, final_group FROM requests
      WHERE id = $1 AND status = 'Исполнена' AND group_id = $2 AND archived_at IS NULL FOR UPDATE`,
    [requestId, groupId],
  );
  const r = rows[0];
  if (!r) return false;
  await c.query(
    `UPDATE requests SET status = 'В работе', group_id = NULL, final_group = NULL, cancel_reason = NULL, callback = true,
            origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
      WHERE id = $1`,
    [requestId],
  );
  await c.query(
    `INSERT INTO placement_proposals (request_id, group_id, source, status, reject_reason, reject_comment, decided_by, decided_at)
     VALUES ($1, $2, 'manual', 'rejected', 'declined', 'Человек нажал «Группа не подходит» в MAX', 'бот', now())`,
    [requestId, groupId],
  );
  await c.query(
    `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, before, after, note)
     VALUES ('бот', 'bot', 'request.reopen', 'request', $1, $2::jsonb, $3::jsonb, 'человек нажал «Группа не подходит» в MAX')`,
    [requestId, JSON.stringify({ status: 'Исполнена', group_id: groupId, final_group: r.final_group }), JSON.stringify({ status: 'В работе', callback: true })],
  );
  return true;
}

/** Сообщение к отправке: что писать и куда. */
export interface DueNotice extends NoticeData {
  platform: string;
  chatId: string;
  attempts: number;
}

/** След сообщений в заявке: для карточки в «Домашних группах». */
export interface NoticeTrace {
  requestId: number;
  groupId: number;
  recipient: NoticeRecipient;
  // Отменённые сюда не попадают: их выборка отсекает.
  status: 'queued' | 'sent' | 'failed' | 'no_chat';
  error: string | null;
  answer: NoticeAnswer | null;
  createdAt: string;
  sentAt: string | null;
  answeredAt: string | null;
}

export class PlacementNoticesRepo {
  constructor(private readonly db: Pool) {}

  /** Очередь бота: по порядку постановки, только те, чьё время пришло. */
  async due(limit: number): Promise<DueNotice[]> {
    const { rows } = await this.db.query<{
      id: number; recipient: NoticeRecipient; group_id: number; leader: string | null; leader_phone: string | null;
      day: string | null; time: string | null; fio: string | null; person_phone: string | null; person_age: string | null; person_schedule: string | null;
      platform: string; chat_id: string; attempts: number; resend: boolean;
    }>(
      `SELECT n.id, n.recipient, n.group_id, g.leader, g.day, g.time, n.attempts, n.resend, u.platform, u.chat_id,
              coalesce(g.phones[1], lp.phone, lu.phone) AS leader_phone,
              -- Данные человека — из его записи, как в карточке заявки (forDashboard, миграция 057): регистрации или
              -- карточки. Поля самой заявки — снимок «как пришла»; у заявок из бота ФИО и время там пустые, и ведущему
              -- уходило «направлен человек» с одним телефоном. Только у заявки без человека берём её собственные поля.
              CASE WHEN ru.id IS NOT NULL THEN ru.full_name WHEN rp.id IS NOT NULL THEN rp.full_name ELSE r.fio END AS fio,
              CASE WHEN ru.id IS NOT NULL THEN ru.phone WHEN rp.id IS NOT NULL THEN rp.phone
                   ELSE coalesce(r.phones[1], r.phone) END AS person_phone,
              CASE WHEN ru.id IS NOT NULL THEN ru.age WHEN rp.id IS NOT NULL THEN rp.age ELSE r.age END AS person_age,
              CASE WHEN ru.id IS NOT NULL THEN ru.schedule_raw WHEN rp.id IS NOT NULL THEN rp.schedule ELSE r.manual_schedule END AS person_schedule
         FROM placement_notices n
         JOIN users u    ON u.id = n.user_id
         JOIN groups g   ON g.id = n.group_id
         JOIN requests r ON r.id = n.request_id
         LEFT JOIN persons lp ON lp.id = g.leader_person_id
         LEFT JOIN users lu   ON lu.id = g.leader_user_id
         LEFT JOIN persons rp ON rp.id = r.person_id
         LEFT JOIN users ru   ON ru.id = r.user_id
        WHERE n.status = 'queued' AND n.next_try_at <= now()
        ORDER BY n.id LIMIT $1`,
      [limit],
    );
    return rows.map((x) => ({
      id: Number(x.id), recipient: x.recipient, groupCode: groupCode(Number(x.group_id)), leader: x.leader ?? '',
      leaderPhone: x.leader_phone, day: x.day, time: x.time, fio: x.fio, personPhone: x.person_phone, personAge: x.person_age, personSchedule: x.person_schedule,
      platform: x.platform, chatId: x.chat_id, attempts: x.attempts, resend: x.resend,
    }));
  }

  /** Условие status = 'queued': отменённое, пока бот отправлял, не превращается обратно в «дошло». */
  async markSent(id: number): Promise<void> {
    await this.db.query(`UPDATE placement_notices SET status = 'sent', sent_at = now(), error = NULL, attempts = attempts + 1 WHERE id = $1 AND status = 'queued'`, [id]);
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db.query(`UPDATE placement_notices SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1 AND status = 'queued'`, [id, error]);
  }

  async retryLater(id: number, error: string, delayMs: number): Promise<void> {
    await this.db.query(
      `UPDATE placement_notices SET error = $2, attempts = attempts + 1, next_try_at = now() + make_interval(secs => $3)
        WHERE id = $1 AND status = 'queued'`,
      [id, error, delayMs / 1000],
    );
  }

  /**
   * Ответ кнопкой. Засчитывается только тому, кому сообщение ушло, и только ответом его стороны: данные кнопки
   * может прислать кто угодно. Повторное нажатие переписывает ответ (передумал), каждое — строкой в журнале заявки.
   * «Группа не подходит» от человека возвращает заявку в работу (`reopenDeclined`): иначе она оставалась «Исполнена»,
   * и о ней никто не узнавал. null — кнопка чужая или сообщение не отправлялось.
   */
  async answer(noticeId: number, userId: number, answer: NoticeAnswer): Promise<{ requestId: number; reopened: boolean } | null> {
    const allowed = (Object.keys(ANSWERS_OF) as NoticeRecipient[]).filter((k) => ANSWERS_OF[k].includes(answer));
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query<{ request_id: number; group_id: number; recipient: NoticeRecipient }>(
        `UPDATE placement_notices SET answer = $3, answered_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'sent' AND recipient = ANY($4::text[])
          RETURNING request_id, group_id, recipient`,
        [noticeId, userId, answer, allowed],
      );
      const row = rows[0];
      if (!row) { await c.query('ROLLBACK'); return null; }
      // В журнал — кто и что нажал, без имён и телефонов: журнал читают все входы.
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ('бот', 'bot', 'request.bot_answer', 'request', $1, $2::jsonb)`,
        [row.request_id, JSON.stringify({ recipient: row.recipient, answer })],
      );
      const reopened = answer === 'not_fit' ? await reopenDeclined(c, Number(row.request_id), Number(row.group_id)) : false;
      await c.query('COMMIT');
      return { requestId: Number(row.request_id), reopened };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** Сколько сообщений ведущим ушло без ФИО (до исправления) и ещё не переотправлено — для кнопки в «Настройки → Подбор». */
  async fioResendPending(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM placement_notices n JOIN requests r ON r.id = n.request_id
        WHERE n.needs_fio_resend AND r.status = 'Исполнена' AND r.group_id = n.group_id AND r.archived_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * Переотправить ведущим сообщения, ушедшие без ФИО: новое сообщение в очередь (с пометкой «повторно» и своими кнопками),
   * старая пометка снимается. Только по заявкам, которые всё ещё утверждены в ту же группу: вернутую в работу или
   * переутверждённую незачем — о ней ведущему уже сказали иначе. Возвращает, сколько поставлено в очередь.
   */
  async resendWithoutFio(actor: string): Promise<number> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query<{ id: number }>(
        `INSERT INTO placement_notices (request_id, group_id, recipient, user_id, status, resend, created_by)
         SELECT n.request_id, n.group_id, 'leader', n.user_id, 'queued', true, $1
           FROM placement_notices n JOIN requests r ON r.id = n.request_id
          WHERE n.needs_fio_resend AND r.status = 'Исполнена' AND r.group_id = n.group_id AND r.archived_at IS NULL
         RETURNING id`,
        [actor],
      );
      // Снимаем со всех: и с переотправленных, и с тех, где повтор уже не нужен (заявку вернули или переутвердили).
      await c.query('UPDATE placement_notices SET needs_fio_resend = false WHERE needs_fio_resend');
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, after) VALUES ($1, 'home-groups', 'notices.resend_fio', 'notices', $2::jsonb)`,
        [actor, JSON.stringify({ queued: rows.length })],
      );
      await c.query('COMMIT');
      return rows.length;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** След по заявкам для карточек: последние сообщения каждой стороны идут последними. */
  async traces(): Promise<NoticeTrace[]> {
    const { rows } = await this.db.query<{
      request_id: number; group_id: number; recipient: NoticeRecipient; status: NoticeTrace['status']; error: string | null;
      answer: NoticeAnswer | null; created_at: Date; sent_at: Date | null; answered_at: Date | null;
    }>(
      `SELECT request_id, group_id, recipient, status, error, answer, created_at, sent_at, answered_at
         FROM placement_notices WHERE status <> 'cancelled' ORDER BY id`,
    );
    return rows.map((x) => ({
      requestId: Number(x.request_id), groupId: Number(x.group_id), recipient: x.recipient, status: x.status, error: x.error,
      answer: x.answer, createdAt: x.created_at.toISOString(), sentAt: x.sent_at?.toISOString() ?? null,
      answeredAt: x.answered_at?.toISOString() ?? null,
    }));
  }
}
