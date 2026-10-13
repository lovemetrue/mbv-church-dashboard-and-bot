import type { Pool } from 'pg';

export interface GeoPoint { lat: number; lon: number }

/** Строка кэша: точка или `null`, если адрес не нашли (повторно не спрашиваем). */
export type GeocodeEntry = GeoPoint | null;

/** Кэш координат адресов (миграция 036). Ключи — `addressKey` из `home-groups/geocode.ts`. */
export class GeocodeRepo {
  constructor(private readonly db: Pool) {}

  async all(): Promise<Map<string, GeocodeEntry>> {
    const { rows } = await this.db.query<{ address_key: string; found: boolean; lat: number | null; lon: number | null }>(
      'SELECT address_key, found, lat, lon FROM geocode_cache',
    );
    return new Map(rows.map((r) => [r.address_key, r.found && r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null]));
  }

  /** Сколько запросов к геокодеру сделано за последние сутки: бесплатный ключ даёт тысячу в сутки. */
  async countSince(hours: number): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM geocode_cache WHERE fetched_at > now() - make_interval(hours => $1)`, [hours],
    );
    return rows[0]!.n;
  }

  async save(key: string, point: GeoPoint | null, precision: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO geocode_cache (address_key, found, lat, lon, accuracy) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address_key) DO UPDATE SET found = $2, lat = $3, lon = $4, accuracy = $5, fetched_at = now()`,
      [key, point !== null, point?.lat ?? null, point?.lon ?? null, precision],
    );
  }
}
