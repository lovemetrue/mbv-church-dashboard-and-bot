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

describe('накопленные предложения', () => {
  const desired = (requestId: number, groupId: number) => ({
    requestId, groupId, confidence: 80, rationale: [{ tone: 'good', text: 'тот же район' }],
  });
  const active = async () =>
    (await db.query(`SELECT request_id, group_id, source, status, confidence, rationale FROM placement_proposals WHERE status = 'proposed' ORDER BY request_id`)).rows;

  test('новая заявка получает сохранённое предложение расчёта с уверенностью и причинами', async () => {
    const g = await group();
    const r = await request();
    expect(await repo.syncProposals([desired(r, g)], 'mbv_admin')).toEqual({ created: 1, replaced: 0, unchanged: 0 });
    expect(await active()).toMatchObject([{ request_id: r, group_id: g, source: 'script', confidence: 80, rationale: [{ text: 'тот же район' }] }]);
  });

  test('повторный запуск ничего не меняет: накопленное остаётся прежним', async () => {
    const g = await group();
    const r = await request();
    await repo.syncProposals([desired(r, g)], 'a');
    expect(await repo.syncProposals([desired(r, g)], 'a')).toEqual({ created: 0, replaced: 0, unchanged: 1 });
    expect((await proposals())).toHaveLength(1);
  });

  test('если расчёт теперь предлагает другую группу, прежнее предложение заменяется, а не копится рядом', async () => {
    const g1 = await group();
    const g2 = await group({ leader: 'Пётр' });
    const r = await request();
    await repo.syncProposals([desired(r, g1)], 'a');
    expect(await repo.syncProposals([desired(r, g2)], 'a')).toEqual({ created: 0, replaced: 1, unchanged: 0 });
    expect((await proposals()).map((p) => p.status).sort()).toEqual(['proposed', 'superseded']);
    expect((await active())[0].group_id).toBe(g2);
  });

  test('предложение, которого расчёт больше не даёт (группа заполнилась), снимается', async () => {
    const g = await group();
    const r = await request();
    await repo.syncProposals([desired(r, g)], 'a');
    expect(await repo.syncProposals([], 'a')).toEqual({ created: 0, replaced: 1, unchanged: 0 });
    expect(await active()).toHaveLength(0);
  });

  test('утверждённые и отклонённые предложения запуск не трогает', async () => {
    const g = await group();
    const r = await request();
    await repo.reject(r, g, 'far', null, 'a');
    await repo.syncProposals([], 'a');
    expect((await proposals())[0].status).toBe('rejected');
  });

  test('предложение модели без группы (только район) запуск не снимает', async () => {
    const r = await request();
    await db.query(`INSERT INTO placement_proposals (request_id, group_id, source) VALUES ($1, NULL, 'agent')`, [r]);
    await repo.syncProposals([], 'a');
    expect(await active()).toHaveLength(1);
  });

  test('запуск записывает сводку в журнал', async () => {
    const g = await group();
    const r = await request();
    await repo.syncProposals([desired(r, g)], 'auto');
    const entry = (await audits()).find((a) => a.action === 'matching.run')!;
    expect(entry).toMatchObject({ actor: 'auto', entity_type: 'matching', after: { created: 1, replaced: 0, unchanged: 0 } });
  });

  test('одновременные запуски не создают двух действующих предложений на заявку', async () => {
    const g = await group();
    const r = await request();
    await Promise.all([repo.syncProposals([desired(r, g)], 'a'), repo.syncProposals([desired(r, g)], 'b')]);
    expect(await active()).toHaveLength(1);
  });

  test('действующие предложения читаются как «заявка → группа и источник»', async () => {
    const g = await group();
    const r = await request();
    await repo.syncProposals([desired(r, g)], 'a');
    expect((await repo.activeProposals()).get(r)).toEqual({ groupId: g, source: 'script' });
  });

  test('утверждение без сохранённого предложения по-прежнему работает рядом с накопленными', async () => {
    const g = await group();
    const r = await request();
    await repo.syncProposals([desired(r, g)], 'a');
    expect(await repo.approve(r, g, 'a', OPTS)).toEqual({ ok: true });
    expect((await proposals())[0].status).toBe('approved');
  });
});

describe('счётчик участников: утверждённые после обратной связи', () => {
  async function approvedAt(groupId: number, at: string): Promise<number> {
    const r = await request();
    await repo.approve(r, groupId, 'a', { force: true, defaultCapacity: 10 });
    await db.query(`UPDATE audit_log SET at = $2 WHERE entity_id = $1 AND action = 'request.approve'`, [r, at]);
    return r;
  }

  test('считаются утверждения позже даты обратной связи; раньше или в тот же день — нет', async () => {
    const g = await group();
    await db.query(`UPDATE groups SET feedback_at = '2026-10-05' WHERE id = $1`, [g]);
    await approvedAt(g, '2026-10-04T10:00:00Z');
    await approvedAt(g, '2026-10-05T10:00:00Z');
    await approvedAt(g, '2026-10-06T10:00:00Z');
    await approvedAt(g, '2026-10-08T10:00:00Z');
    expect((await repo.placedSinceFeedback()).get(g)).toBe(2);
  });

  test('без даты обратной связи считаются все утверждения сервиса', async () => {
    const g = await group();
    await approvedAt(g, '2026-10-04T10:00:00Z');
    await approvedAt(g, '2026-10-08T10:00:00Z');
    expect((await repo.placedSinceFeedback()).get(g)).toBe(2);
  });

  test('заявка, которую потом вернули в работу или перенесли в другую группу, не считается', async () => {
    const g1 = await group();
    const g2 = await group({ leader: 'Пётр' });
    const r = await approvedAt(g1, '2026-10-08T10:00:00Z');
    await db.query(`UPDATE requests SET group_id = $2 WHERE id = $1`, [r, g2]);
    expect((await repo.placedSinceFeedback()).get(g1)).toBeUndefined();
    expect((await repo.placedSinceFeedback()).get(g2)).toBeUndefined();

    const r2 = await approvedAt(g1, '2026-10-08T11:00:00Z');
    await db.query(`UPDATE requests SET status = 'В работе' WHERE id = $1`, [r2]);
    expect((await repo.placedSinceFeedback()).get(g1)).toBeUndefined();
  });

  test('утверждения, сделанные не сервисом (заявки из таблицы), в счётчик не попадают', async () => {
    const g = await group();
    await db.query(`INSERT INTO requests (type, status, fio, group_id, origin) VALUES ('join_group', 'Исполнена', 'Из таблицы', $1, 'таблица')`, [g]);
    expect((await repo.placedSinceFeedback()).size).toBe(0);
  });
});
