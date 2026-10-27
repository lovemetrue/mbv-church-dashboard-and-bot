import type { Pool, PoolClient } from 'pg';

/**
 * Данные человека: ФИО, телефон, возраст, район, адрес, удобное время, хобби, профессия, семья. Они живут в одном
 * месте — в записи человека: регистрации (`users`) или карточке (`persons`). Заявка ссылается на человека
 * (миграция 057), а её собственные поля — только снимок «как пришла»: правка с любой стороны пишет в человека.
 */
export interface ContactPatch {
  fio?: string;
  phone?: string | null;
  age?: string | null;
  place?: string | null;
  address?: string | null;
  schedule?: string | null;
  hobby?: string | null;
  profession?: string | null;
  family?: string | null;
  /** Комментарий: у регистрации это `admin_comment` человека, у заявки — её собственный `note`. */
  note?: string | null;
}
export type ContactField = keyof ContactPatch;

export const CONTACT_FIELDS: readonly ContactField[] = ['fio', 'phone', 'age', 'place', 'address', 'schedule', 'hobby', 'profession', 'family', 'note'];

/** Колонки регистрации. Возраст — текстом, а «место» хранится в `location`. */
const USER_COLUMNS: Record<ContactField, string> = {
  fio: 'full_name', phone: 'phone', age: 'age', place: 'location', address: 'address_raw', schedule: 'schedule_raw',
  hobby: 'hobby', profession: 'profession', family: 'family_status', note: 'admin_comment',
};
/** Колонки карточки в «Людях». Комментарий карточки — её `note`. */
const PERSON_COLUMNS: Record<ContactField, string> = {
  fio: 'full_name', phone: 'phone', age: 'age', place: 'place', address: 'address', schedule: 'schedule',
  hobby: 'hobby', profession: 'profession', family: 'family_status', note: 'note',
};

const keysOf = (patch: ContactPatch): ContactField[] => CONTACT_FIELDS.filter((k) => patch[k] !== undefined);

/** Чья запись: регистрация или карточка. */
export type HumanRef = { userId: number } | { personId: number };

/** Записать в регистрацию. */
export async function writeToUser(c: PoolClient, userId: number, patch: ContactPatch): Promise<void> {
  const keys = keysOf(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${USER_COLUMNS[k]} = $${i + 2}`);
  await c.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, [userId, ...keys.map((k) => patch[k] ?? null)]);
}

/** Записать в карточку. */
export async function writeToPerson(c: PoolClient, personId: number, patch: ContactPatch): Promise<void> {
  const keys = keysOf(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${PERSON_COLUMNS[k]} = $${i + 2}`);
  await c.query(`UPDATE persons SET ${sets.join(', ')} WHERE id = $1`, [personId, ...keys.map((k) => patch[k] ?? null)]);
}

export async function writeToHuman(c: PoolClient, ref: HumanRef, patch: ContactPatch): Promise<void> {
  if ('userId' in ref) await writeToUser(c, ref.userId, patch);
  else await writeToPerson(c, ref.personId, patch);
}

/** Человек заявки (с блокировкой строки заявки); null — заявки нет или у неё нет человека. */
export async function humanOfRequest(c: PoolClient, requestId: number): Promise<HumanRef | null> {
  const { rows } = await c.query<{ user_id: number | null; person_id: number | null }>(
    'SELECT user_id::int AS user_id, person_id::int AS person_id FROM requests WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [requestId],
  );
  const r = rows[0];
  if (!r) return null;
  return r.user_id !== null ? { userId: r.user_id } : r.person_id !== null ? { personId: r.person_id } : null;
}

/** Текущие данные человека — чтобы правка записывала только изменённое. */
export async function readHuman(c: PoolClient, ref: HumanRef): Promise<Record<ContactField, string | null>> {
  const cols = 'userId' in ref ? USER_COLUMNS : PERSON_COLUMNS;
  const { rows } = await c.query<Record<ContactField, string | null>>(
    `SELECT ${CONTACT_FIELDS.map((k) => `${cols[k]} AS "${k}"`).join(', ')} FROM ${'userId' in ref ? 'users' : 'persons'} WHERE id = $1`,
    ['userId' in ref ? ref.userId : ref.personId],
  );
  return rows[0]!;
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
        // Ключ «r» — старый адрес человека заявки: пишем в его запись. Комментарий заявки остаётся в ней самой.
        const human = await humanOfRequest(c, id);
        if (!human) {
          await c.query('ROLLBACK');
          return { ok: false, error: 'not_found', message: 'Заявка не найдена.' };
        }
        await writeToHuman(c, human, { ...patch, note: undefined });
        if (patch.note !== undefined) await c.query('UPDATE requests SET note = $2 WHERE id = $1', [id, patch.note]);
        // Правка через заявку переводит её из таблицы в «ui»: повторный перенос таблицы её не затрёт.
        await c.query(`UPDATE requests SET origin = 'ui' WHERE id = $1 AND origin = 'таблица'`, [id]);
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
