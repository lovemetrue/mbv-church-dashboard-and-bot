import type { Pool, PoolClient } from 'pg';

/**
 * Контактные данные человека: одни и те же поля живут и в регистрации (`users`), и в заявках (`requests`),
 * причём в заявке они могут быть переписаны координатором. Правка с любой стороны должна доходить до обеих,
 * иначе карточка человека и заявка показывают разное.
 */
export interface ContactPatch {
  fio?: string;
  phone?: string | null;
  age?: string | null;
  place?: string | null;
  address?: string | null;
  schedule?: string | null;
}
export type ContactField = keyof ContactPatch;

export const CONTACT_FIELDS: readonly ContactField[] = ['fio', 'phone', 'age', 'place', 'address', 'schedule'];

/** Колонки регистрации. Возраст — текстом, а «место» хранится в `location`. */
const USER_COLUMNS: Record<ContactField, string> = {
  fio: 'full_name', phone: 'phone', age: 'age', place: 'location', address: 'address_raw', schedule: 'schedule_raw',
};
/** Колонки заявки: адрес и время — это правка координатора (`manual_*`), они главнее ответов анкеты. */
const REQUEST_COLUMNS: Record<ContactField, string> = {
  fio: 'fio', phone: 'phone', age: 'age', place: 'place', address: 'manual_street', schedule: 'manual_schedule',
};

const keysOf = (patch: ContactPatch): ContactField[] => CONTACT_FIELDS.filter((k) => patch[k] !== undefined);

/**
 * Записать в регистрацию и в её заявки. В заявках обновляется только то, что там переписано (не null):
 * пустое поле заявки и так читается из регистрации, а заводить в нём копию значит лишить его этой связи.
 * Закрытые заявки обновляются тоже: данные человека одни.
 */
export async function writeToUser(c: PoolClient, userId: number, patch: ContactPatch): Promise<void> {
  const keys = keysOf(patch);
  if (keys.length === 0) return;
  const userSets = keys.map((k, i) => `${USER_COLUMNS[k]} = $${i + 2}`);
  await c.query(`UPDATE users SET ${userSets.join(', ')} WHERE id = $1`, [userId, ...keys.map((k) => patch[k] ?? null)]);

  const sets = keys.map((k, i) => `${REQUEST_COLUMNS[k]} = CASE WHEN ${REQUEST_COLUMNS[k]} IS NOT NULL THEN $${i + 2} END`);
  const values: unknown[] = keys.map((k) => patch[k] ?? null);
  if (keys.includes('phone')) {
    sets.push(`phones = CASE WHEN array_length(phones, 1) > 0 THEN $${values.length + 2}::text[] ELSE phones END`);
    values.push(patch.phone ? [patch.phone] : []);
  }
  await c.query(
    `UPDATE requests SET ${sets.join(', ')},
            origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
      WHERE user_id = $1 AND archived_at IS NULL`,
    [userId, ...values],
  );
}

/** Записать прямо в заявку (у заявки без регистрации это единственное место, где лежат данные). */
export async function writeToRequest(c: PoolClient, requestId: number, patch: ContactPatch): Promise<void> {
  const keys = keysOf(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${REQUEST_COLUMNS[k]} = $${i + 2}`);
  const values: unknown[] = keys.map((k) => patch[k] ?? null);
  if (keys.includes('phone')) {
    sets.push(`phones = $${values.length + 2}::text[]`);
    values.push(patch.phone ? [patch.phone] : []);
  }
  await c.query(
    `UPDATE requests SET ${sets.join(', ')},
            origin = CASE WHEN origin = 'таблица' THEN 'ui' ELSE origin END
      WHERE id = $1`,
    [requestId, ...values],
  );
}

export type ContactOutcome = { ok: true } | { ok: false; error: 'not_found'; message: string };

export class ContactsRepo {
  constructor(private readonly db: Pool) {}

  /**
   * Правка человека из справочника. `u<id>` — регистрация: пишем в неё и в переписанные поля её заявок.
   * `r<id>` — заявка (у неё может не быть регистрации): пишем в саму заявку, а если регистрация есть — и в неё.
   * В журнал идут названия полей, без имён и телефонов.
   */
  async update(kind: 'u' | 'r', id: number, patch: ContactPatch, actor: string): Promise<ContactOutcome> {
    const keys = keysOf(patch);
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      if (kind === 'u') {
        const { rowCount } = await c.query('SELECT 1 FROM users WHERE id = $1 AND registration_no IS NOT NULL FOR UPDATE', [id]);
        if (!rowCount) {
          await c.query('ROLLBACK');
          return { ok: false, error: 'not_found', message: 'Человек не найден.' };
        }
        await writeToUser(c, id, patch);
      } else {
        const { rows } = await c.query<{ user_id: number | null }>(
          'SELECT user_id FROM requests WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [id],
        );
        if (!rows[0]) {
          await c.query('ROLLBACK');
          return { ok: false, error: 'not_found', message: 'Заявка не найдена.' };
        }
        await writeToRequest(c, id, patch);
        if (rows[0].user_id !== null) await writeToUser(c, rows[0].user_id, patch);
      }
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ($1, 'home-groups', 'person.contact', $2, $3, $4::jsonb)`,
        [actor, kind === 'u' ? 'user' : 'request', id, JSON.stringify({ fields: keys })],
      );
      await c.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}
