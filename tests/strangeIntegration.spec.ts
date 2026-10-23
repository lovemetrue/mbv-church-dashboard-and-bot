import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService, engine } from '../src/home-groups/composition.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/** Метка «Странный человек» на настоящем движке и настоящей базе: в обычную группу такого человека никто не отправляет сам. */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const service = () => composeService(db, engine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' });

async function seed() {
  const g = (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, direction_id, status, source, people) VALUES ('Ведущий Иван', 'Приморский', group_direction_id('очно'), 'Функционирует', 'ui', 3) RETURNING id`,
  )).rows[0]!.id;
  let n = 0;
  const mk = async (fio: string) => (await db.query<{ id: number }>(
    `INSERT INTO requests (type, fio, phone, age, place, status, origin) VALUES ('join_group', $1, $2, '25-40', 'Приморский', 'Новая', 'ui') RETURNING id`, [fio, `+7911000112${++n}`],
  )).rows[0]!.id;
  return { g, a: await mk('Обычный Человек'), b: await mk('Отмеченный Человек') };
}

describe('метка «Странный человек» и подбор', () => {
  test('отмеченной заявке группа не предлагается, подбор по кнопке её не трогает, обычной — предлагает', async () => {
    const { g, a, b } = await seed();
    const s = service();
    expect(await s.strange.forRequest(b, { value: true, note: 'нужна отдельная группа' }, 'anna')).toEqual({ ok: true });

    const views = await s.views();
    const marked = views.requests.items.find((i) => i.id === b)!;
    expect(marked).toMatchObject({ proposal: null, bucket: 'human', noPlan: { code: 'strange' }, strange: { by: 'anna', note: 'нужна отдельная группа' } });
    expect(views.requests.items.find((i) => i.id === a)!.proposal?.main.group.id).toBe(g);

    await s.matching.run('anna');
    const saved = (await db.query<{ request_id: number }>(`SELECT request_id::int FROM placement_proposals WHERE status = 'proposed'`)).rows.map((r) => r.request_id);
    expect(saved).toEqual([a]);
  });

  test('если предложение уже было сохранено, метка его снимает, а подбор не возвращает', async () => {
    const { b } = await seed();
    const s = service();
    await s.matching.run('anna');
    expect((await db.query(`SELECT 1 FROM placement_proposals WHERE request_id = $1 AND status = 'proposed'`, [b])).rowCount).toBe(1);
    await s.strange.forRequest(b, { value: true }, 'anna');
    expect((await db.query(`SELECT 1 FROM placement_proposals WHERE request_id = $1 AND status = 'proposed'`, [b])).rowCount).toBe(0);
    await s.matching.run('anna');
    expect((await db.query(`SELECT 1 FROM placement_proposals WHERE request_id = $1 AND status = 'proposed'`, [b])).rowCount).toBe(0);
  });

  test('координатор всё равно может утвердить такого человека в отдельную группу вручную', async () => {
    const { g, b } = await seed();
    const s = service();
    await s.strange.forRequest(b, { value: true }, 'anna');
    expect(await s.placement.approve(b, g, 'anna', { force: true, defaultCapacity: 10 })).toEqual({ ok: true });
  });

  test('после снятия метки заявка снова подбирается как обычная', async () => {
    const { g, b } = await seed();
    const s = service();
    await s.strange.forRequest(b, { value: true }, 'anna');
    await s.strange.forRequest(b, { value: false }, 'anna');
    expect((await s.views()).requests.items.find((i) => i.id === b)!.proposal?.main.group.id).toBe(g);
  });
});

describe('метка и тот же человек под другой записью', () => {
  test('заявка с тем же телефоном, что у отмеченного, тоже не подбирается автоматически', async () => {
    const { b } = await seed();
    const twin = (await db.query<{ id: number }>(
      `INSERT INTO requests (type, fio, phone, age, place, status, origin)
       SELECT 'join_group', 'Тот же, другая запись', phone, age, place, 'Новая', 'ui' FROM requests WHERE id = $1 RETURNING id`, [b],
    )).rows[0]!.id;
    const s = service();
    await s.strange.forRequest(b, { value: true }, 'anna');
    const item = (await s.views()).requests.items.find((i) => i.id === twin)!;
    expect(item).toMatchObject({ proposal: null, noPlan: { code: 'strange' } });
  });
});
