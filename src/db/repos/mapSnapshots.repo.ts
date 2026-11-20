import type { Pool } from 'pg';

export interface MapSnapshotRow {
  params: string;
  png: Buffer;
  marks: number;
  skipped: number;
  takenAt: Date;
}

/** Снимки карты групп, по одному на вход (`viewer` — логин личного входа или роль общего). */
export class MapSnapshotRepo {
  constructor(private readonly db: Pool) {}

  async get(viewer: string): Promise<MapSnapshotRow | null> {
    const { rows } = await this.db.query<{ params: string; png: Buffer; marks: number; skipped: number; taken_at: Date }>(
      'SELECT params, png, marks, skipped, taken_at FROM map_snapshots WHERE viewer = $1',
      [viewer],
    );
    const r = rows[0];
    return r ? { params: r.params, png: r.png, marks: r.marks, skipped: r.skipped, takenAt: r.taken_at } : null;
  }

  async put(viewer: string, row: MapSnapshotRow): Promise<void> {
    await this.db.query(
      `INSERT INTO map_snapshots (viewer, params, png, marks, skipped, taken_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (viewer) DO UPDATE SET params = EXCLUDED.params, png = EXCLUDED.png, marks = EXCLUDED.marks,
         skipped = EXCLUDED.skipped, taken_at = EXCLUDED.taken_at`,
      [viewer, row.params, row.png, row.marks, row.skipped, row.takenAt],
    );
  }
}
