import type { Pool } from 'pg';

export interface CoordinatorRow {
  id: number;
  name: string;
  role: string;
  source: string;
}

export class CoordinatorsRepo {
  constructor(private readonly db: Pool) {}

  async listActive(): Promise<CoordinatorRow[]> {
    const { rows } = await this.db.query<CoordinatorRow>(
      `SELECT id, name, role, source FROM coordinators
        WHERE archived_at IS NULL ORDER BY role, name`,
    );
    return rows;
  }
}
