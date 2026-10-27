import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService, engine as realEngine } from '../src/home-groups/composition.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Миграция 062: людей, которых автоподбор увёл из ДГ-0164 до миграции 061 (причину снятия тогда не писали), подбор
 * возвращает к ней. Тестовая база уже перенесена — SQL миграции гоняем ещё раз на подготовленных данных.
 */
const sql = readFileSync(new URL('../migrations/062_restore_dom_group_0164.sql', import.meta.url), 'utf8');
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const service = () => composeService(db, realEngine, { defaultCapacity: 10, ttlMs: 60_000 });
const setStatus = (id: number, status: string) => db.query('UPDATE groups SET status = $2 WHERE id = $1', [id, status]);
const active = async () => (await db.query(`SELECT request_id, group_id FROM placement_proposals WHERE status = 'proposed' ORDER BY request_id`)).rows;

async function group(id: number | null, leader: string, status: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (${id === null ? '' : 'id, '}leader, district, direction_id, status, people, age, source)
     VALUES (${id === null ? '' : `${id}, `}$1, 'Приморский', group_direction_id('Основная церковь'), $2, $3, '25-40', 'ui') RETURNING id`,
    [leader, status, status === 'Функционирует' ? 3 : 0],
  );
  // Старая группа — не новая: иначе в подборе она шла бы наравне с открытой.
  if (status === 'Функционирует') await db.query('UPDATE groups SET opened_on = NULL WHERE id = $1', [rows[0]!.id]);
  return rows[0]!.id;
}
async function request(): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, place, age, origin) VALUES ('join_group', 'Новая', 'Человек', 'Приморский', '30', 'ui') RETURNING id`,
  )).rows[0]!.id;
}

describe('миграция 062: возврат людей в ДГ-0164', () => {
  test('снятые автоподбором до 061 возвращаются; снятые «Подобрать заново» — нет', async () => {
    const old = await group(null, 'Старая', 'Функционирует');
    const dom = await group(164, 'Доценко Артём', 'Потенциальная');
    const lost = [await request(), await request()];
    const rematched = await request();
    const s = service();
    // Как было на сервере: открыли — подбор к ней; вернули — к старой; причины снятия тогда не было.
    await setStatus(dom, 'Функционирует');
    await s.matching.run('авто');
    await setStatus(dom, 'Потенциальная');
    await s.matching.run('авто');
    await db.query(`UPDATE placement_proposals SET superseded_reason = NULL`);
    // Одному координатор нажал «Подобрать заново» — уже после возврата: этот снят человеком.
    await s.matching.rematch(rematched, 'Вера');
    await db.query(
      `UPDATE placement_proposals SET superseded_reason = NULL WHERE request_id = $1 AND status = 'superseded'`, [rematched],
    );
    await setStatus(dom, 'Функционирует');
    await s.matching.run('авто');
    // Без миграции — никого (то, что увидела координатор).
    expect((await active()).map((x) => x.group_id)).toEqual([old, old, old]);

    await db.query(sql);
    await s.matching.run('авто');
    expect(await active()).toEqual([
      { request_id: lost[0], group_id: dom }, { request_id: lost[1], group_id: dom }, { request_id: rematched, group_id: old },
    ]);
  });

  test('другие группы и снятые без запуска подбора миграция не трогает', async () => {
    const other = await group(null, 'Другая', 'Функционирует');
    const r = await request();
    await db.query(`INSERT INTO groups (id, leader, district, direction_id, status, source) VALUES (164, 'Доценко Артём', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 'ui')`);
    // Снято сменой пола: в одной транзакции с ним записи «matching.run» нет.
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source, status, decided_by, decided_at) VALUES ($1, 164, 'script', 'superseded', 'Вера', now() - interval '1 day')`, [r]);
    // Снято подбором (в одной транзакции с записью «matching.run», как в `syncProposals`), но с другой группы.
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO placement_proposals (request_id, group_id, source, status, decided_by, decided_at) VALUES ($1, $2, 'script', 'superseded', 'авто', now())`, [r, other]);
      await c.query(`INSERT INTO audit_log (actor, service, action, entity_type) VALUES ('авто', 'home-groups', 'matching.run', 'matching')`);
      await c.query('COMMIT');
    } finally { c.release(); }
    await db.query(sql);
    expect((await db.query(`SELECT superseded_reason FROM placement_proposals ORDER BY id`)).rows).toEqual([
      { superseded_reason: null }, { superseded_reason: null },
    ]);
  });
});
