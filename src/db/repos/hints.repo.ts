import type { Pool } from 'pg';

/** Разбор помощника по одной заявке (см. migrations/027). Поля — то, что он определил; пустое значит «не определил». */
export interface StoredHint {
  district: string | null;
  age: string | null;
  days: string[];
  slot: string | null;
  questions: string[];
  /** Пояснение для служителя: что в записи непонятно и почему поле осталось пустым. */
  note: string | null;
  baseHash: string;
}

export interface HintInput extends StoredHint { requestId: number; model: string }

export class HintsRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<Map<number, StoredHint>> {
    const { rows } = await this.db.query<{
      request_id: number; district: string | null; age: string | null; days: string[]; slot: string | null; questions: string[]; note: string | null; base_hash: string;
    }>('SELECT request_id::int AS request_id, district, age, days, slot, questions, note, base_hash FROM request_hints');
    return new Map(rows.map((r) => [r.request_id, {
      district: r.district, age: r.age, days: r.days, slot: r.slot, questions: r.questions, note: r.note, baseHash: r.base_hash,
    }]));
  }

  /** Повторный разбор заменяет прежний: хранится последний. */
  async upsertMany(rows: readonly HintInput[]): Promise<void> {
    for (const h of rows) {
      await this.db.query(
        `INSERT INTO request_hints (request_id, district, age, days, slot, questions, note, base_hash, model)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (request_id) DO UPDATE SET district = EXCLUDED.district, age = EXCLUDED.age, days = EXCLUDED.days,
           slot = EXCLUDED.slot, questions = EXCLUDED.questions, note = EXCLUDED.note, base_hash = EXCLUDED.base_hash,
           model = EXCLUDED.model, created_at = now()`,
        [h.requestId, h.district, h.age, h.days, h.slot, JSON.stringify(h.questions), h.note, h.baseHash, h.model],
      );
    }
  }
}
