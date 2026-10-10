import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: PlacementRepo;
const OPTS = { force: false, defaultCapacity: 10 };

beforeAll(async () => { db = await setupTestDb(); repo = new PlacementRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

async function group(over: { status?: string; people?: number | null; doNotRefer?: boolean; leader?: string; archived?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, people, do_not_refer, source, archived_at)
     VALUES ($1, 'Приморский', 'Основная церковь', $2, $3, $4, 'ui', CASE WHEN $5 THEN now() END) RETURNING id`,
    [over.leader ?? 'Иван Петров', over.status ?? 'Функционирует', over.people ?? 3, over.doNotRefer ?? false, over.archived ?? false],
  );
  return rows[0]!.id;
}

async function request(over: { status?: string; origin?: string } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, origin) VALUES ('join_group', $1, 'Мария', $2) RETURNING id`,
    [over.status ?? 'Новая', over.origin ?? 'ui'],
  );
  return rows[0]!.id;
}

const row = async (id: number) =>
  (await db.query('SELECT status, group_id, final_group, callback, origin, handled_by FROM requests WHERE id = $1', [id])).rows[0];
const audits = async () => (await db.query('SELECT * FROM audit_log ORDER BY id')).rows;
const proposals = async () => (await db.query('SELECT * FROM placement_proposals ORDER BY id')).rows;

describe('утверждение', () => {
  test('утверждение закрывает заявку, привязывает группу и пишет журнал «было → стало»', async () => {
    const g = await group({ leader: 'Иван Петров' });
    const r = await request();
    expect(await repo.approve(r, g, 'mbv_admin', OPTS)).toEqual({ ok: true });

    const after = await row(r);
    expect(after).toMatchObject({ status: 'Исполнена', group_id: g, handled_by: 'mbv_admin' });
    expect(after.final_group).toBe(`ДГ-${String(g).padStart(4, '0')}, Иван Петров`);

    const [entry] = await audits();
    expect(entry).toMatchObject({ actor: 'mbv_admin', service: 'home-groups', action: 'request.approve', entity_type: 'request' });
    expect(Number(entry.entity_id)).toBe(r);
    expect(entry.before).toMatchObject({ status: 'Новая', group_id: null });
    expect(entry.after).toMatchObject({ status: 'Исполнена', group_id: g });
  });

  test('повторное утверждение уже закрытой заявки отвечает «уже обработали» и ничего не меняет', async () => {
    const g = await group();
    const r = await request({ status: 'Исполнена' });
    const res = await repo.approve(r, g, 'mbv_admin', OPTS);
    expect(res).toMatchObject({ ok: false, error: 'already_closed' });
    expect(await audits()).toHaveLength(0);
    expect((await row(r)).group_id).toBeNull();
  });

  test('два одновременных утверждения одной заявки проходят только одно', async () => {
    const g1 = await group();
    const g2 = await group({ leader: 'Пётр Сидоров' });
    const r = await request();
    const results = await Promise.all([repo.approve(r, g1, 'a', OPTS), repo.approve(r, g2, 'b', OPTS)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  test('несуществующая заявка — not_found', async () => {
    const g = await group();
    expect(await repo.approve(99999, g, 'a', OPTS)).toMatchObject({ ok: false, error: 'not_found' });
  });

  test.each([
    ['«Не направлять»', { doNotRefer: true }],
    ['закрытая', { status: 'Закрыта' }],
    ['в архиве', { archived: true }],
  ])('группа %s недоступна для утверждения даже с force', async (_name, over) => {
    const g = await group(over);
    const r = await request();
    expect(await repo.approve(r, g, 'a', { ...OPTS, force: true })).toMatchObject({ ok: false, error: 'group_unavailable' });
    expect((await row(r)).status).toBe('Новая');
  });

  test('в полной группе утверждение просит подтверждения, а с force проходит и помечается в журнале', async () => {
    const g = await group({ people: 10 });
    const r = await request();
    expect(await repo.approve(r, g, 'a', OPTS)).toMatchObject({ ok: false, error: 'group_full' });
    expect((await row(r)).status).toBe('Новая');

    expect(await repo.approve(r, g, 'a', { ...OPTS, force: true })).toEqual({ ok: true });
    expect((await audits())[0].note).toBe('утверждено без свободных мест');
  });

  test('если число участников неизвестно, места считаются свободными', async () => {
    const g = await group({ people: null });
    const r = await request();
    expect(await repo.approve(r, g, 'a', OPTS)).toEqual({ ok: true });
  });

  test('утверждение заявки из таблицы переводит её под управление интерфейса, иначе повторный перенос таблицы её сотрёт', async () => {
    const g = await group();
    const r = await request({ origin: 'таблица' });
    await repo.approve(r, g, 'a', OPTS);
    expect((await row(r)).origin).toBe('ui');
  });

  test('утверждение снимает отметку «нужен звонок»', async () => {
    const g = await group();
    const r = await request();
    await repo.setNeedCall(r, true, 'a');
    await repo.approve(r, g, 'a', OPTS);
    expect((await row(r)).callback).toBe(false);
  });

  test('действующее предложение на эту группу становится утверждённым, а прочие заменяются', async () => {
    const g1 = await group();
    const g2 = await group({ leader: 'Пётр' });
    const r = await request();
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source) VALUES ($1, $2, 'agent')`, [r, g1]);
    await repo.approve(r, g1, 'a', OPTS);
    const [p] = await proposals();
    expect(p).toMatchObject({ source: 'agent', status: 'approved', decided_by: 'a' });
    expect(await proposals()).toHaveLength(1);

    const r2 = await request();
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source) VALUES ($1, $2, 'agent')`, [r2, g1]);
    await repo.approve(r2, g2, 'a', OPTS);
    const rows = (await proposals()).filter((x) => Number(x.request_id) === r2);
    expect(rows.map((x) => x.status).sort()).toEqual(['approved', 'superseded']);
    expect(rows.find((x) => x.status === 'approved')).toMatchObject({ source: 'manual', group_id: g2 });
  });

  test('без сохранённого предложения утверждение записывается как решение координатора', async () => {
    const g = await group();
    const r = await request();
    await repo.approve(r, g, 'a', OPTS);
    expect(await proposals()).toMatchObject([{ source: 'manual', status: 'approved', decided_by: 'a' }]);
  });
});

describe('отказ', () => {
  test('отказ оставляет заявку открытой, запоминает причину и группу', async () => {
    const g = await group();
    const r = await request();
    expect(await repo.reject(r, g, 'time', null, 'a')).toEqual({ ok: true });
    expect((await row(r)).status).toBe('Новая');
    expect(await proposals()).toMatchObject([{ status: 'rejected', reject_reason: 'time', group_id: g }]);
    expect((await audits())[0].action).toBe('request.reject');
    expect((await repo.rejectedGroups()).get(r)).toEqual([g]);
  });

  test('причина «Другое» без комментария отклоняется', async () => {
    const g = await group();
    const r = await request();
    expect(await repo.reject(r, g, 'other', '  ', 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await proposals()).toHaveLength(0);
  });

  test('неизвестная причина отклоняется', async () => {
    const g = await group();
    const r = await request();
    expect(await repo.reject(r, g, 'потому' as never, null, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('повторный отказ той же группе не плодит строк', async () => {
    const g = await group();
    const r = await request();
    await repo.reject(r, g, 'far', null, 'a');
    await repo.reject(r, g, 'time', null, 'a');
    expect(await proposals()).toMatchObject([{ reject_reason: 'time' }]);
  });

  test('отказ по сохранённому предложению закрывает его, а не создаёт второе', async () => {
    const g = await group();
    const r = await request();
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source) VALUES ($1, $2, 'agent')`, [r, g]);
    await repo.reject(r, g, 'age', null, 'a');
    expect(await proposals()).toMatchObject([{ source: 'agent', status: 'rejected', reject_reason: 'age' }]);
  });

  test('закрытую заявку отклонять нельзя', async () => {
    const g = await group();
    const r = await request({ status: 'Аннулирована' });
    expect(await repo.reject(r, g, 'far', null, 'a')).toMatchObject({ ok: false, error: 'already_closed' });
  });
});

describe('нужен звонок', () => {
  test('отметка ставится и снимается, каждое изменение — в журнале', async () => {
    const r = await request();
    await repo.setNeedCall(r, true, 'a');
    expect((await row(r)).callback).toBe(true);
    await repo.setNeedCall(r, false, 'a');
    expect((await row(r)).callback).toBe(false);
    expect((await audits()).map((x) => x.action)).toEqual(['request.need_call', 'request.need_call_off']);
  });

  test('повторная отметка без изменений в журнал не пишется', async () => {
    const r = await request();
    await repo.setNeedCall(r, true, 'a');
    await repo.setNeedCall(r, true, 'a');
    expect(await audits()).toHaveLength(1);
  });

  test('закрытой заявке отметку ставить нельзя', async () => {
    const r = await request({ status: 'Исполнена' });
    expect(await repo.setNeedCall(r, true, 'a')).toMatchObject({ ok: false, error: 'already_closed' });
  });
});
