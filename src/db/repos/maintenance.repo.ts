import type { Pool } from 'pg';

/**
 * Таблицы, которые очистка опустошает целиком. Схема и журнал миграций сюда не входят.
 *
 * Заявок здесь нет намеренно: после переноса выгрузки в базу в requests лежат ещё и
 * 233 строки из таблицы церкви, и стирать их вместе с тестовыми данными нельзя.
 * Групп и координаторов нет по той же причине — это справочные данные церкви.
 */
const DATA_TABLES = [
  'sessions',
  'admin_sessions',
  'campaign_days',
  'broadcasts',
  'deliveries',
] as const;

/** Что показываем и чистим кроме них: участники и заявки, созданные ботом. */
const PARTIAL = [
  { table: 'users', count: 'SELECT count(*)::int AS n FROM users' },
  { table: 'requests (бот)', count: `SELECT count(*)::int AS n FROM requests WHERE origin = 'бот'` },
] as const;

export class MaintenanceRepo {
  constructor(private readonly db: Pool) {}

  /** Сколько строк удалится: показываем служителю перед очисткой ровно то, что исчезнет. */
  async counts(): Promise<{ table: string; rows: number }[]> {
    const result: { table: string; rows: number }[] = [];
    for (const { table, count } of PARTIAL) {
      const { rows } = await this.db.query<{ n: number }>(count);
      result.push({ table, rows: rows[0]?.n ?? 0 });
    }
    for (const table of DATA_TABLES) {
      const { rows } = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      result.push({ table, rows: rows[0]?.n ?? 0 });
    }
    return result;
  }

  /**
   * Полная очистка данных кампании. Схема, миграции и настройки не затрагиваются.
   * Счётчик номеров регистрации сбрасывается, чтобы нумерация снова начиналась с единицы.
   */
  async resetAll(): Promise<void> {
    // Порядок важен. Сначала заявки бота: TRUNCATE ... CASCADE опустошил бы requests
    // целиком (CASCADE смотрит на сами связи, а не на строки), а там данные церкви.
    await this.db.query(`DELETE FROM requests WHERE origin = 'бот'`);
    await this.db.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    // Участников удаляем, а не опустошаем: DELETE снимает только те связи,
    // которые действительно есть, и не задевает заявки из выгрузки.
    await this.db.query('DELETE FROM users');
    await this.db.query('ALTER SEQUENCE registration_no_seq RESTART WITH 1');
  }
}
