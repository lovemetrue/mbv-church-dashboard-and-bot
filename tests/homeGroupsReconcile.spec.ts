import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService } from '../src/home-groups/composition.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Разбор «других обращений» целиком, на настоящей базе: от списка с подсказками до записи в состав группы и ссылки
 * «группа — ведущий». Движок поддельный, всё остальное боевое.
 */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const service = () => composeService(db, createFakeEngine().engine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' });

async function group(leader: string, phone: string | null = null): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, phone, phones, district, format, status, source) VALUES ($1, $2, $3, 'Приморский', 'очно', 'Функционирует', 'таблица') RETURNING id`,
    [leader, phone, phone ? [phone] : []],
  );
  return rows[0]!.id;
}

async function person(uid: string, type: 'already_member' | 'already_leader', opts: { fio?: string; leader?: string; phone?: string } = {}): Promise<{ requestId: number; userId: number }> {
  const userId = await seedUser(db, { id: uid, mdgStatus: type === 'already_member' ? 'member' : 'leader', ...(opts.fio ? { fio: opts.fio } : {}), ...(opts.phone ? { phone: opts.phone } : {}) });
  if (opts.leader) await db.query('UPDATE users SET leader_name = $2 WHERE id = $1', [userId, opts.leader]);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, user_id, fio, status, origin) VALUES ($1, $2, $3, 'Новая', 'бот') RETURNING id`, [type, userId, opts.fio ?? 'Из заявки'],
  );
  return { requestId: rows[0]!.id, userId };
}

describe('«уже состою в группе»', () => {
  test('в списке подсказка по каждому, разбор вносит в состав, обращение уходит в закрытые, в ленте след', async () => {
    const g = await group('Малявин Павел');
    const a = await person('1', 'already_member', { fio: 'Доценко Артём', leader: 'Павел Малявин' });
    const s = service();

    const before = (await s.views()).requests.others.find((o) => o.id === a.requestId)!;
    expect(before).toMatchObject({ state: 'open', reconcile: { status: 'ready', candidates: [{ groupId: g }] } });
    expect(before.gist).toContain('Ведущий: Павел Малявин');

    expect(await s.reconciler.apply(a.requestId, { groupId: g }, 'boss')).toEqual({ ok: true, already: false });

    const after = await s.views();
    const done = after.requests.others.find((o) => o.id === a.requestId)!;
    expect(done).toMatchObject({ state: 'done', reconcile: null });
    expect(done.log.map((l) => l.text).join('\n')).toContain('внесён в состав группы');
    const card = after.groups.items.find((x) => x.id === g)!;
    expect(card.members.map((m) => m.fio)).toEqual(['Доценко Артём']);
    // Человек из справочника: в «Людях» у него появилась группа.
    expect(after.people.items.find((p) => p.key === `u${a.userId}`)!.groups).toHaveLength(1);
  });

  test('«разобрать всё готовое» берёт только однозначные, выбор и чужие группы не трогает, закрытое пропускает', async () => {
    const mal = await group('Малявин Павел');
    await group('Родионов Давид');
    await group('Родионов Давид');
    const ready = await person('1', 'already_member', { leader: 'Малявин Павел' });
    const choose = await person('2', 'already_member', { leader: 'Родионов Давид' });
    const none = await person('3', 'already_member', { leader: 'Неизвестный Человек' });
    const s = service();

    const out = await s.reconciler.applyReady({ ids: [ready.requestId, choose.requestId, none.requestId, 999999] }, 'boss');
    expect(out).toEqual({ ok: true, applied: 1, skipped: 3 });
    expect((await db.query('SELECT group_id::int AS g FROM group_members')).rows).toEqual([{ g: mal }]);

    // Повторный запуск ничего не меняет: первое обращение уже закрыто.
    expect(await s.reconciler.applyReady({ ids: [ready.requestId] }, 'boss')).toEqual({ ok: true, applied: 0, skipped: 1 });
  });

  test('в обращении без вида «разбирается» группу выбрать нельзя: вопрос и «хочет открыть» отклоняются', async () => {
    const g = await group('Малявин Павел');
    const userId = await seedUser(db, { id: '5', mdgStatus: 'open' });
    const { rows } = await db.query<{ id: number }>(`INSERT INTO requests (type, user_id, fio, status, origin) VALUES ('lead_group', $1, 'Хочет', 'Новая', 'бот') RETURNING id`, [userId]);
    expect(await service().reconciler.apply(rows[0]!.id, { groupId: g }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await service().reconciler.apply(999999, { groupId: g }, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test.each([[{}], [null], [{ groupId: 'x' }], [{ groupId: -1 }], [{ groupId: 1.5 }]])('неверное тело %j отклоняется', async (body) => {
    expect(await service().reconciler.apply(1, body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test.each([[{}], [{ ids: [] }], [{ ids: ['1'] }], [{ ids: [0] }], [null]])('неверный список %j отклоняется', async (body) => {
    expect(await service().reconciler.applyReady(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('«уже веду группу»', () => {
  test('по телефону находится группа, разбор связывает её с регистрацией ведущего, и это видно в карточке группы', async () => {
    const g = await group('Малявин Павел', '89001112233');
    const a = await person('7', 'already_leader', { fio: 'П. М.', phone: '+79001112233' });
    const s = service();
    expect((await s.views()).requests.others.find((o) => o.id === a.requestId)!.reconcile).toMatchObject({ kind: 'leader', status: 'ready', candidates: [{ groupId: g, by: 'phone' }] });

    expect(await s.reconciler.apply(a.requestId, { groupId: g }, 'boss')).toEqual({ ok: true, already: false });
    const card = (await s.views()).groups.items.find((x) => x.id === g)!;
    expect(card.leaderKey).toBe(`u${a.userId}`);
  });
});
