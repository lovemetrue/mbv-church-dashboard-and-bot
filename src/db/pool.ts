import { Pool, types } from 'pg';

// bigint приходит из pg строкой, чтобы не терять точность. Наши id заведомо влезают в number,
// а работать с ними как с числами удобнее.
types.setTypeParser(types.builtins.INT8, (v) => Number.parseInt(v, 10));

// DATE отдаём строкой «2026-08-20», а не объектом Date.
// По умолчанию драйвер делает Date на местную полночь, и toISOString() в плюсовой
// зоне (у нас Europe/Moscow) уводит дату на день назад. У календарной даты часового
// пояса нет вовсе, поэтому строка — единственное честное представление.
types.setTypeParser(types.builtins.DATE, (v) => v);

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export type Db = Pool;
