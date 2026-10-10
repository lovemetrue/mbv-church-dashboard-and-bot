import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { composeService, engine as realEngine } from '../src/home-groups/composition.js';
import { startAutoMatching } from '../src/home-groups/matching/scheduler.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Подбор для новых заявок на живой базе: что сохраняется, что остаётся прежним и как накопленное
 * влияет на новые заявки. Движок настоящий — важно именно его поведение с закреплёнными выборами.
 */

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const service = () => composeService(db, realEngine, { defaultCapacity: 10, ttlMs: 60_000 });

async function group(over: { people?: number; district?: string; age?: string } = {}): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, people, age, source)
     VALUES ('Ведущий', $1, 'Основная церковь', 'Функционирует', $2, $3, 'ui') RETURNING id`,
    [over.district ?? 'Приморский', over.people ?? 3, over.age ?? '25-40'],
  )).rows[0]!.id;
}
async function request(over: { place?: string; age?: string } = {}): Promise<number> {
  return (await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, place, age, origin) VALUES ('join_group', 'Новая', 'Человек', $1, $2, 'ui') RETURNING id`,
    [over.place ?? 'Приморский', over.age ?? '30'],
  )).rows[0]!.id;
}
const active = async () => (await db.query(`SELECT request_id, group_id FROM placement_proposals WHERE status = 'proposed' ORDER BY request_id`)).rows;

describe('запуск подбора', () => {
  test('новые заявки получают сохранённые предложения, повторный запуск ничего не меняет', async () => {
    const g = await group();
    const r1 = await request();
    const r2 = await request();
    const s = service();
    expect(await s.matching.run('mbv_admin')).toEqual({ ok: true, created: 2, replaced: 0, unchanged: 0 });
    expect(await active()).toEqual([{ request_id: r1, group_id: g }, { request_id: r2, group_id: g }]);
    expect(await s.matching.run('mbv_admin')).toEqual({ ok: true, created: 0, replaced: 0, unchanged: 2 });
  });

  test('накопленное не перескакивает: появилась группа получше, а прежнее предложение осталось', async () => {
    const g1 = await group({ people: 8 });
    const r = await request();
    const s = service();
    await s.matching.run('a');
    const better = await group({ people: 0 });
    await s.matching.run('a');
    expect((await active())[0]).toMatchObject({ request_id: r, group_id: g1 });
    expect(better).not.toBe(g1);
  });

  test('новая «трудная» заявка не отнимает единственное место у уже предложенной', async () => {
    // В g одно свободное место. Первая заявка получает его сейчас; потом приходит заявка, которой
    // другой вариант не подходит по возрасту, — без закрепления она забрала бы место первой.
    const g = await group({ people: 9, age: '25-40' });
    await group({ people: 2, age: '60-80' });
    const first = await request({ age: '30' });
    const s = service();
    await s.matching.run('a');
    expect((await active())[0]).toMatchObject({ request_id: first, group_id: g });

    const hard = await request({ age: '35' });
    await s.matching.run('a');
    const rows = await active();
    expect(rows).toEqual([{ request_id: first, group_id: g }]);
    expect(rows.find((x) => x.request_id === hard)).toBeUndefined();
  });

  test('если группа перестала подходить («Не направлять»), предложение заменяется или снимается', async () => {
    const g = await group();
    const r = await request();
    const s = service();
    await s.matching.run('a');
    await db.query(`UPDATE groups SET do_not_refer = true WHERE id = $1`, [g]);
    expect(await s.matching.run('a')).toMatchObject({ created: 0, replaced: 1 });
    expect(await active()).toEqual([]);
    expect(r).toBeGreaterThan(0);
  });

  test('отклонённая группа не возвращается: предложение заменяется следующей', async () => {
    const g1 = await group({ people: 0 });
    const g2 = await group({ people: 5 });
    const r = await request();
    const s = service();
    await s.matching.run('a');
    const first = (await active())[0]!.group_id as number;
    const other = first === g1 ? g2 : g1;
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source, status, reject_reason, decided_by, decided_at)
                    VALUES ($1, $2, 'script', 'rejected', 'far', 'a', now())`, [r, first]);
    await s.matching.run('a');
    expect((await active())[0]).toMatchObject({ request_id: r, group_id: other });
  });

  test('закрытые заявки подбором не затрагиваются', async () => {
    await group();
    await db.query(`INSERT INTO requests (type, status, fio, place, age, origin) VALUES ('join_group', 'Исполнена', 'Старая', 'Приморский', '30', 'ui')`);
    expect(await service().matching.run('a')).toMatchObject({ created: 0 });
  });

  test('последний запуск и счётчик «ждут подбора» видны в списке заявок', async () => {
    await group();
    await request();
    const s = service();
    const before = (await s.views()).requests.matching;
    expect(before).toEqual({ auto: false, lastRun: null, waiting: 1 });
    await s.matching.run('mbv_admin');
    const after = (await s.views()).requests.matching;
    expect(after.waiting).toBe(0);
    expect(after.lastRun).toMatchObject({ created: 1, replaced: 0, actor: 'mbv_admin' });
  });

  test('предложение, сохранённое запуском, помечено в списке расчётом и не меняет заявку', async () => {
    const g = await group();
    const r = await request();
    const s = service();
    await s.matching.run('a');
    const item = (await s.views()).requests.items.find((i) => i.id === r)!;
    expect(item.proposal?.main.group.id).toBe(g);
    expect(item.proposal?.source).toBe('script');
    expect(item.status).toBe('Новая');
  });

  test('автоматический режим переключается и читается', async () => {
    const s = service();
    expect(await s.matching.isAuto()).toBe(false);
    await s.matching.setAuto(true, 'super_mbv_admin');
    expect(await s.matching.isAuto()).toBe(true);
    expect((await s.views()).requests.matching.auto).toBe(true);
    await s.matching.setAuto(false, 'super_mbv_admin');
    expect(await s.matching.isAuto()).toBe(false);
  });
});

describe('автоматический запуск по таймеру', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

  test('выключенный переключатель — подбор не запускается', async () => {
    const run = vi.fn(async () => undefined);
    const t = startAutoMatching({ intervalMs: 1000, isEnabled: async () => false, run });
    await vi.advanceTimersByTimeAsync(3500);
    t.stop();
    expect(run).not.toHaveBeenCalled();
  });

  test('включённый — запускается на каждом проходе от имени «авто»', async () => {
    const run = vi.fn(async () => undefined);
    const t = startAutoMatching({ intervalMs: 1000, isEnabled: async () => true, run });
    await vi.advanceTimersByTimeAsync(2500);
    t.stop();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith('авто');
  });

  test('переключатель читается на каждом проходе: включили — со следующего запускается', async () => {
    let on = false;
    const run = vi.fn(async () => undefined);
    const t = startAutoMatching({ intervalMs: 1000, isEnabled: async () => on, run });
    await vi.advanceTimersByTimeAsync(1500);
    expect(run).not.toHaveBeenCalled();
    on = true;
    await vi.advanceTimersByTimeAsync(1000);
    t.stop();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('пока прошлый проход не закончился, новый не стартует', async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const t = startAutoMatching({ intervalMs: 1000, isEnabled: async () => true, run });
    await vi.advanceTimersByTimeAsync(4500);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    t.stop();
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('ошибка подбора не останавливает цикл', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('база недоступна'))
      .mockResolvedValue(undefined);
    const t = startAutoMatching({ intervalMs: 1000, isEnabled: async () => true, run });
    await vi.advanceTimersByTimeAsync(3500);
    t.stop();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
