import type { Pool } from 'pg';

/**
 * Выполнение запросов помощника. Три слоя защиты, и ни один не держится на том, что модель «ведёт себя осторожно»:
 *  1. база: транзакция «только чтение» от роли `assistant_ro`, у которой есть доступ только к представлениям схемы
 *     `assistant` (в них нет имён и телефонов, см. migrations/029); запись, удаление и доступ к таблицам запрещены самой базой;
 *  2. разбор: один оператор SELECT или WITH, без `;` и комментариев, обёрнутый в подзапрос с пределом строк;
 *  3. лимиты: таймаут запроса и число строк.
 */
export type Cell = string | number | boolean | null;
export interface QueryResult { columns: string[]; rows: Cell[][]; truncated: boolean }

/** Запрос отклонён или не выполнился; сообщение показывается модели, чтобы она исправила запрос. */
export class QueryError extends Error {}
/** Роль помощника в базе недоступна (нет права её создать): чат не работает, остальное да. */
export class ReadonlyUnavailable extends Error {}

const MAX_SQL = 4000;
const CELL_LIMIT = 300;

export function validateSql(raw: string): string {
  let sql = raw.trim();
  if (sql === '') throw new QueryError('Пустой запрос.');
  if (sql.length > MAX_SQL) throw new QueryError(`Запрос слишком длинный (до ${MAX_SQL} знаков).`);
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd();
  if (sql.includes(';')) throw new QueryError('Разрешён один запрос, без «;» внутри.');
  if (/--|\/\*/.test(sql)) throw new QueryError('Комментарии в запросе не поддерживаются.');
  if (!/^(select|with)\b/i.test(sql)) throw new QueryError('Разрешены только запросы SELECT (или WITH … SELECT).');
  return sql;
}

/** Почта и номер, если вдруг уцелели в значении: последний рубеж после маскировки в самой базе. */
const mask = (v: string): string =>
  v.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '***').replace(/\+?\d[\d\s().-]{8,}\d/g, '***');

function cellOf(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const masked = mask(s);
  return masked.length > CELL_LIMIT ? `${masked.slice(0, CELL_LIMIT)}…` : masked;
}

export function createReadonlyRunner(db: Pool, opts: { timeoutMs?: number; maxRows?: number } = {}): (sql: string) => Promise<QueryResult> {
  const timeout = opts.timeoutMs ?? 8000;
  const maxRows = opts.maxRows ?? 100;
  return async (raw) => {
    const sql = validateSql(raw);
    const client = await db.connect();
    try {
      await client.query('BEGIN READ ONLY');
      try {
        await client.query('SET LOCAL ROLE assistant_ro');
      } catch {
        throw new ReadonlyUnavailable('Роль помощника в базе недоступна.');
      }
      await client.query(`SET LOCAL statement_timeout = ${Math.round(timeout)}`);
      await client.query('SET LOCAL search_path = assistant');
      let res;
      try {
        res = await client.query({ text: `SELECT * FROM (${sql}) AS q LIMIT ${maxRows + 1}`, rowMode: 'array' });
      } catch (err) {
        // Текст ошибки базы нужен модели, чтобы поправить запрос; значений из таблиц в нём нет (доступны только представления).
        throw new QueryError((err as Error).message.slice(0, 300));
      }
      const rows = (res.rows as unknown[][]).map((r) => r.map(cellOf));
      return { columns: res.fields.map((f) => f.name), rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };
}
