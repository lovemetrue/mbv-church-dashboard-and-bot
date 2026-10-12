import type { Pool } from 'pg';
import type { ActionOutcome } from './placement.repo.js';

/** Кому ставится метка: заявке (метка ляжет на человека заявки), регистрации или карточке, внесённой вручную. */
export type StrangeTarget = { kind: 'request' | 'user' | 'person'; id: number };

export interface StrangeMarkRow {
  /** Кто поставил (логин). */
  by: string;
  at: Date;
  note: string | null;
}

const NOTE_LIMIT = 300;

/**
 * Метка «Странный человек» (см. миграцию 031). Привязана к человеку по ключу справочника людей: `u12`, `r345`, `p7`, —
 * поэтому видна везде, где виден человек. Поставить может любой служитель с входом: координатор после обзвона или
 * распределитель; снять — тоже.
 */
export class StrangeRepo {
  constructor(private readonly db: Pool) {}

  /** Все метки: ключ человека → кто и когда поставил. */
  async all(): Promise<Map<string, StrangeMarkRow>> {
    const { rows } = await this.db.query<{ person_key: string; note: string | null; set_by: string; set_at: Date }>(
      'SELECT person_key, note, set_by, set_at FROM strange_marks',
    );
    return new Map(rows.map((r) => [r.person_key, { by: r.set_by, at: r.set_at, note: r.note }]));
  }

  async set(target: StrangeTarget, value: boolean, note: string | null, actor: string): Promise<ActionOutcome> {
    const text = (note ?? '').trim() || null;
    if ((text ?? '').length > NOTE_LIMIT) return { ok: false, error: 'bad_request', message: `Заметка слишком длинная (до ${NOTE_LIMIT} знаков).` };
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      let key: string;
      let userId: number | null = null;
      let requestId: number | null = null;
      if (target.kind === 'request') {
        const { rows } = await c.query<{ user_id: number | null }>(
          'SELECT user_id::int AS user_id FROM requests WHERE id = $1 AND archived_at IS NULL', [target.id],
        );
        if (!rows[0]) { await c.query('ROLLBACK'); return { ok: false, error: 'not_found', message: 'Заявка не найдена.' }; }
        userId = rows[0].user_id;
        // Человек из заявки: с регистрацией — это его регистрация, без неё — сама заявка (как в справочнике людей).
        key = userId !== null ? `u${userId}` : `r${target.id}`;
        requestId = target.id;
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

      if (value) {
        await c.query(
          `INSERT INTO strange_marks (person_key, note, set_by) VALUES ($1, $2, $3)
           ON CONFLICT (person_key) DO UPDATE SET note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()`,
          [key, text, actor],
        );
        // Для такого человека нужна отдельная группа: сохранённые предложения обычных групп у его открытых заявок снимаем.
        await c.query(
          `UPDATE placement_proposals SET status = 'superseded', decided_by = $3, decided_at = now()
            WHERE status = 'proposed'
              AND request_id IN (SELECT id FROM requests WHERE archived_at IS NULL AND (($1::bigint IS NOT NULL AND user_id = $1) OR ($2::bigint IS NOT NULL AND id = $2 AND user_id IS NULL)))`,
          [userId, requestId ?? (key.startsWith('r') ? Number(key.slice(1)) : null), actor],
        );
      } else {
        await c.query('DELETE FROM strange_marks WHERE person_key = $1', [key]);
      }

      const entityType = target.kind === 'request' ? 'request' : target.kind;
      await c.query(
        `INSERT INTO audit_log (actor, service, action, entity_type, entity_id, after)
         VALUES ($1, 'home-groups', $2, $3, $4, $5::jsonb)`,
        [actor, target.kind === 'request' ? 'request.strange' : `${target.kind}.strange`, entityType, target.id, JSON.stringify({ value })],
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
