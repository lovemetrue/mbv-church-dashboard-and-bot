import type { Pool } from 'pg';

export interface CampaignDay {
  day: number;
  content: string;
  updated_at: Date;
}

export class CampaignRepo {
  constructor(private readonly db: Pool) {}

  async setDay(day: number, content: string): Promise<void> {
    await this.db.query(
      `INSERT INTO campaign_days (day, content) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [day, content],
    );
  }

  async getDay(day: number): Promise<CampaignDay | null> {
    const { rows } = await this.db.query<CampaignDay>('SELECT * FROM campaign_days WHERE day = $1', [day]);
    return rows[0] ?? null;
  }

  async listDays(): Promise<{ day: number; length: number }[]> {
    const { rows } = await this.db.query<{ day: number; length: number }>(
      'SELECT day, length(content)::int AS length FROM campaign_days ORDER BY day',
    );
    return rows;
  }
}
