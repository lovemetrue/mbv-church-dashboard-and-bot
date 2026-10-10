import type { Pool } from 'pg';

/** Настройки платформы «ключ → значение»; значение — любой JSON. */
export class SettingsRepo {
  constructor(private readonly db: Pool) {}

  async get<T>(key: string): Promise<T | null> {
    const { rows } = await this.db.query<{ value: T }>('SELECT value FROM app_settings WHERE key = $1', [key]);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: unknown, by: string): Promise<void> {
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), by],
    );
  }
}
