import type { Pool } from 'pg';
import type { Gender } from '../../core/gender.js';
import type { ActionOutcome } from './placement.repo.js';
import type { StrangeTarget } from './strange.repo.js';

/** Кто поставил: логин служителя или «ии» — подсказка модели (её стоит проверить). */
export const GENDER_BY_AI = 'ии';

export interface GenderRow {
  gender: Gender;
  by: string;
}

/**
 * Пол, поставленный вручную или по подсказке модели (миграция 055). Ключ — как у метки «Странный человек»: u12, r345,
 * p7. Пол из ФИО здесь не хранится: его сервер считает на лету, а строка в таблице его перекрывает.
 */
export class GendersRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<Map<string, GenderRow>> {
    const { rows } = await this.db.query<{ person_key: string; gender: Gender; set_by: string }>(
      'SELECT person_key, gender, set_by FROM person_genders',
    );
    return new Map(rows.map((r) => [r.person_key, { gender: r.gender, by: r.set_by }]));
  }

  /** Поставить или снять (null — вернуть «по ФИО») пол человека. Заявка указывает на своего человека, как у метки. */
  async set(target: StrangeTarget, gender: Gender | null, actor: string): Promise<ActionOutcome> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      let key: string;
      let userId: number | null = null;
      let requestId: number | null = null;
      if (target.kind === 'request') {
        const { rows } = await c.query<{ user_id: number | null; person_id: number | null }>(
          'SELECT user_id::int AS user_id, person_id::int AS person_id FROM requests WHERE id = $1 AND archived_at IS NULL', [target.id],
        );
        if (!rows[0]) { await c.query('ROLLBACK'); return { ok: false, error: 'not_found', message: 'Заявка не найдена.' }; }
        userId = rows[0].user_id;
        // Пол — у человека заявки (миграция 057): регистрация или карточка.
        key = userId !== null ? `u${userId}` : rows[0].person_id !== null ? `p${rows[0].person_id}` : `r${target.id}`;
        requestId = userId === null ? target.id : null;
      } else if (target.kind === 'user') {
        const { rowCount } = await c.query('SELECT 1 FROM users WHERE id = $1', [target.id]);
        if (!rowCount) { await c.query('ROLLBACK'); return { ok: false, error: 'not_found', message: 'Человек не найден.' }; }
        userId = target.id;
        key = `u${target.id}`;
      } else {
        const { rowCount } = await c.query('SELECT 1 FROM persons WHERE id = $1 AND archived_at IS NULL', [target.id]);
        if (!rowCount) { await c.query('ROLLBACK'); return { ok: false, error: 'not_found', message: 'Карточка не найдена.' }; }
        key = `p${target.id}`;
      }

      if (gender) {
        await c.query(
          `INSERT INTO person_genders (person_key, gender, set_by) VALUES ($1, $2, $3)
           ON CONFLICT (person_key) DO UPDATE SET gender = EXCLUDED.gender, set_by = EXCLUDED.set_by, set_at = now()`,
          [key, gender, actor],
        );
      } else {
        await c.query('DELETE FROM person_genders WHERE person_key = $1', [key]);
      }
      // Закреплённое предложение могло быть в группу, куда человеку теперь нельзя: открытые заявки подбираются заново.
      await c.query(
        `UPDATE placement_proposals SET status = 'superseded', decided_by = $3, decided_at = now()
          WHERE status = 'proposed'
            AND request_id IN (SELECT id FROM requests WHERE archived_at IS NULL AND (($1::bigint IS NOT NULL AND user_id = $1)
                OR ($4::bigint IS NOT NULL AND person_id = $4) OR ($2::bigint IS NOT NULL AND id = $2 AND user_id IS NULL AND person_id IS NULL)))`,
        // Человек — регистрация («u»), карточка («p», все его заявки, миграция 057) или старая заявка без человека («r»).
        [userId, key.startsWith('r') ? Number(key.slice(1)) : null, actor, key.startsWith('p') ? Number(key.slice(1)) : null],
      );
      // В журнал — только сам факт и значение, без имени (как у остальных записей журнала).
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ($1, 'home-groups', $2, $3, $4, $5::jsonb)`,
        [actor, `${target.kind}.gender`, target.kind, target.id, JSON.stringify({ gender })],
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

  /**
   * Подсказки модели пачкой. Поставленное служителем не перетирается: модель заполняет только пустое. Возвращает,
   * сколько записано.
   */
  async fillFromAi(entries: readonly { key: string; gender: Gender }[]): Promise<number> {
    if (entries.length === 0) return 0;
    const { rowCount } = await this.db.query(
      `INSERT INTO person_genders (person_key, gender, set_by)
       SELECT k, g, $3 FROM unnest($1::text[], $2::text[]) AS t(k, g)
       ON CONFLICT (person_key) DO NOTHING`,
      [entries.map((e) => e.key), entries.map((e) => e.gender), GENDER_BY_AI],
    );
    return rowCount ?? 0;
  }
}
