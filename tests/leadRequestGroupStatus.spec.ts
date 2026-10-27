import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeViews, engine as realEngine } from '../src/home-groups/composition.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Заявка «хочу открыть группу» живёт, пока группа потенциальная. Группу перевели в рабочий статус — заявка сделала
 * своё и закрывается сама (миграция 060): иначе в «Хотят открыть группу» висели открытыми люди, которые уже ведут.
 */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const views = () => composeViews(db, realEngine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' })();

async function lead(type = 'lead_group'): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, origin, fio, phone) VALUES ($1, 'Новая', 'бот', 'Коротовских Илья', '+79936420215') RETURNING id::int AS id`, [type],
  )).rows[0]!.id;
}
async function groupFor(requestId: number, status = 'Потенциальная'): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, source, source_request_id)
     VALUES ('Коротовских Илья', 'Красногвардейский', group_direction_id('очно'), $2, 'ui', $1) RETURNING id::int AS id`, [requestId, status],
  )).rows[0]!.id;
}
const req = async (id: number) => (await db.query('SELECT status, group_id::int AS group_id FROM requests WHERE id = $1', [id])).rows[0];

describe('заявка «хочу открыть группу» и статус её группы', () => {
  test('пока группа потенциальная, заявка открыта; перевели в «Функционирует» — заявка закрыта и ссылается на группу', async () => {
    const r = await lead();
    const g = await groupFor(r);
    expect(await req(r)).toEqual({ status: 'Новая', group_id: null });
    await db.query(`UPDATE groups SET status = 'Функционирует' WHERE id = $1`, [g]);
    expect(await req(r)).toEqual({ status: 'Исполнена', group_id: g });
  });

  test('группу завели сразу рабочей — заявка закрывается сразу', async () => {
    const r = await lead();
    const g = await groupFor(r, 'На паузе');
    expect(await req(r)).toEqual({ status: 'Исполнена', group_id: g });
  });

  test('закрытую и аннулированную заявку не трогаем; заявки других видов — тоже', async () => {
    const cancelled = await lead();
    await db.query(`UPDATE requests SET status = 'Аннулирована' WHERE id = $1`, [cancelled]);
    await groupFor(cancelled, 'Функционирует');
    expect((await req(cancelled))!.status).toBe('Аннулирована');
    const leader = await lead('already_leader');
    await groupFor(leader, 'Функционирует');
    expect((await req(leader))!.status).toBe('Новая');
  });

  test('в «Хотят открыть группу» закрытая так заявка — «Группа открыта» со ссылкой на группу и её статусом', async () => {
    const r = await lead();
    const g = await groupFor(r);
    let item = (await views()).requests.others.find((o) => o.id === r)!;
    expect(item.state).toBe('open');
    expect(item.ownGroup).toEqual({ id: g, code: `ДГ-${String(g).padStart(4, '0')}`, status: 'Потенциальная' });
    await db.query(`UPDATE groups SET status = 'Функционирует' WHERE id = $1`, [g]);
    item = (await views()).requests.others.find((o) => o.id === r)!;
    expect(item.state).toBe('done');
    expect(item.outcome).toMatchObject({ text: 'Группа открыта: статус «Функционирует»', groups: [{ id: g }] });
  });

  test('миграция 060: заявки, чьи группы уже работают, закрываются дозаливкой', async () => {
    const r = await lead();
    const g = await groupFor(r);
    // Обходим триггер: так данные выглядели до миграции.
    await db.query(`ALTER TABLE groups DISABLE TRIGGER groups_close_lead_request`);
    await db.query(`UPDATE groups SET status = 'Функционирует' WHERE id = $1`, [g]);
    await db.query(`ALTER TABLE groups ENABLE TRIGGER groups_close_lead_request`);
    expect((await req(r))!.status).toBe('Новая');
    expect((await db.query<{ n: number }>('SELECT close_lead_requests_of_running_groups() AS n')).rows[0]!.n).toBe(1);
    expect(await req(r)).toEqual({ status: 'Исполнена', group_id: g });
  });
});
