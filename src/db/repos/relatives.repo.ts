import type { Pool, PoolClient } from 'pg';
import type { RelativeKind } from '../../home-groups/contracts.js';

/** Связь «b_key приходится a_key: kind» (миграция 071). «Ребёнок» хранится как «родитель» с другой стороны. */
export interface RelativeRow {
  id: number;
  a_key: string;
  b_key: string;
  kind: Exclude<RelativeKind, 'child'>;
}

export type RelativeOutcome = { ok: true } | { ok: false; error: 'not_found' | 'conflict'; message: string };

/** Есть ли такой человек в «Людях»: регистрация, действующая карточка или старая заявка без человека. */
async function personExists(c: PoolClient, key: string): Promise<boolean> {
  const id = Number(key.slice(1));
  const sql = key[0] === 'u'
    ? 'SELECT 1 FROM users WHERE id = $1 AND registration_no IS NOT NULL'
    : key[0] === 'p'
      ? 'SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL'
      : 'SELECT 1 FROM requests WHERE id = $1 AND archived_at IS NULL AND user_id IS NULL AND person_id IS NULL';
  return ((await c.query(sql, [id])).rowCount ?? 0) > 0;
}

/**
 * Родственники. В журнал идут названия полей и номер связи — без имён, телефонов и ключей людей.
 */
export class RelativesRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<RelativeRow[]> {
    const { rows } = await this.db.query<RelativeRow>('SELECT id::int AS id, a_key, b_key, kind FROM person_relatives ORDER BY id');
    return rows;
  }

  /** Связать двоих. У пары связь одна: уже связанных не связываем второй раз (степень меняют, убрав прежнюю). */
  async add(aKey: string, bKey: string, kind: RelativeRow['kind'], actor: string): Promise<RelativeOutcome> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      if (!(await personExists(c, aKey)) || !(await personExists(c, bKey))) {
        await c.query('ROLLBACK');
        return { ok: false, error: 'not_found', message: 'Человек не найден: обновите страницу.' };
      }
      const { rows } = await c.query<{ id: number }>(
        `INSERT INTO person_relatives (a_key, b_key, kind, set_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING id::int AS id`,
        [aKey, bKey, kind, actor],
      );
      if (!rows[0]) {
        await c.query('ROLLBACK');
        return { ok: false, error: 'conflict', message: 'Эти люди уже связаны. Чтобы сменить степень родства, уберите прежнюю связь.' };
      }
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ($1, 'home-groups', 'person.relative.add', 'relative', $2, $3::jsonb)`,
        [actor, rows[0].id, JSON.stringify({ fields: ['kind'] })],
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

  async remove(id: number, actor: string): Promise<RelativeOutcome> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const { rowCount } = await c.query('DELETE FROM person_relatives WHERE id = $1', [id]);
      if (!rowCount) {
        await c.query('ROLLBACK');
        return { ok: false, error: 'not_found', message: 'Связь уже убрана: обновите страницу.' };
      }
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ($1, 'home-groups', 'person.relative.delete', 'relative', $2, '{}'::jsonb)`,
        [actor, id],
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
