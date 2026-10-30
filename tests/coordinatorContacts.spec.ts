import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { coordinatorContactText, createCoordinatorContacts } from '../src/core/coordinatorContacts.js';
import { CoordinatorContactsRepo } from '../src/db/repos/coordinatorContacts.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: CoordinatorContactsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new CoordinatorContactsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const id = async (sql: string, args: unknown[] = []) => Number((await db.query<{ id: number }>(sql, args)).rows[0]!.id);
const user = (platform: string, phone: string | null, fio: string | null = null) =>
  id(`INSERT INTO users (platform, platform_user_id, chat_id, phone, full_name, registered_at)
      VALUES ($1, gen_random_uuid()::text, gen_random_uuid()::text, $2, $3, now()) RETURNING id`, [platform, phone, fio]);
const coordinator = async (name: string, userId: number | null) =>
  id(`INSERT INTO coordinators (name, source, user_id) VALUES ($1, 'ui', $2) RETURNING id`, [name, userId]);
const group = (o: { leader?: string; coordinator?: string | null; leaderUserId?: number | null; phones?: string[]; status?: string }) =>
  id(`INSERT INTO groups (leader, district, direction_id, status, people, source, coordinator, leader_user_id, phones)
      VALUES ($1, 'Приморский', group_direction_id('Основная церковь'), $2, 3, 'ui', $3, $4, $5) RETURNING id`,
  [o.leader ?? 'Иванова Марина', o.status ?? 'Функционирует', o.coordinator ?? null, o.leaderUserId ?? null, o.phones ?? []]);

describe('кому разослать контакт координатора', () => {
  test('координатор с телефоном из его записи; ведущий — по регистрации или по телефону группы на любой платформе', async () => {
    await coordinator('Анна Петрова', await user('telegram', '+79001110000', 'Петрова Анна Сергеевна'));
    const direct = await user('max', '+79002220000');
    const g1 = await group({ coordinator: 'Анна Петрова', leaderUserId: direct });
    const viaPhone = await user('telegram', '+79003330000');
    const g2 = await group({ coordinator: 'анна петрова ', phones: ['8 900 333-00-00'] });
    const targets = await repo.targets(['telegram', 'max']);
    expect(targets).toEqual([
      { groupId: g1, groupCode: expect.any(String), leader: 'Иванова Марина', coordinator: 'Петрова Анна Сергеевна', coordinatorPhone: '+79001110000', leaderUserId: direct },
      { groupId: g2, groupCode: expect.any(String), leader: 'Иванова Марина', coordinator: 'Петрова Анна Сергеевна', coordinatorPhone: '+79001110000', leaderUserId: viaPhone },
    ]);
  });

  test('ведущий только на выключенной платформе — не в боте; закрытые и потенциальные группы не берём', async () => {
    await coordinator('Анна', await user('telegram', '+79001110000'));
    await group({ coordinator: 'Анна', leaderUserId: await user('telegram', null) });
    await group({ coordinator: 'Анна', status: 'Потенциальная' });
    const [t] = await repo.targets(['max']);
    expect(t!.leaderUserId).toBeNull();
    expect(await repo.targets(['max'])).toHaveLength(1);
  });

  test('предпросмотр делит на «уйдёт», «нет в боте», «нет координатора», «нет телефона координатора»', async () => {
    await coordinator('С телефоном', await user('max', '+79001110000'));
    await coordinator('Без телефона', await user('max', null));
    const leader = await user('max', '+79005550000');
    await group({ coordinator: 'С телефоном', leaderUserId: leader });
    const noChat = await group({ coordinator: 'С телефоном' });
    const noCoord = await group({ coordinator: null, leaderUserId: leader });
    const noPhone = await group({ coordinator: 'Без телефона', leaderUserId: leader });
    const sent: string[] = [];
    const c = createCoordinatorContacts({
      contacts: repo,
      platforms: new Map([['max', {} as never]]),
      deliveries: { openFor: async (_k: string, body: string) => { sent.push(body); return { created: true, queued: 1 }; } } as never,
      sender: { run: async () => ({ key: '', sent: 1, failed: 0, blocked: 0, pending: 0 }) } as never,
    });
    const p = await c.preview();
    const code = (n: number) => `ДГ-${String(n).padStart(4, '0')}`;
    expect(p).toEqual({ total: 1, noChat: [code(noChat)], noCoordinator: [code(noCoord)], noPhone: [code(noPhone)] });
    expect(await c.send(2)).toEqual({ status: 'changed', actual: 1 });
    expect(sent).toEqual([]);
    expect(await c.send(1)).toEqual({ status: 'sent', sent: 1, failed: 0, blocked: 0 });
    expect(sent[0]).toContain('Ваш координатор по группе');
  });
});

test('текст ведущему: по имени, группа, ФИО и телефон координатора', () => {
  expect(coordinatorContactText({ leader: 'Иванова Марина Олеговна', groupCode: 'ДГ-0163', coordinator: 'Петрова Анна', coordinatorPhone: '+79001112233' }))
    .toBe('Марина, здравствуйте! Это бот МБВ.\n\nВаш координатор по группе ДГ-0163 — Петрова Анна, телефон +7 900 111-22-33.\n\nПо вопросам о группе и о людях, которых к Вам направляют, звоните координатору.');
});

test('рассылка без отметки «приглашён на новые вопросы» и без пустой клавиатуры', async () => {
  const { DeliveriesRepo } = await import('../src/db/repos/deliveries.repo.js');
  const u = await user('max', '+79001110000');
  await new DeliveriesRepo(db).openFor('coordinator:t:1', 'текст', [], [u], { markInvited: false });
  expect((await db.query('SELECT extra_invited_at FROM users WHERE id = $1', [u])).rows[0].extra_invited_at).toBeNull();
  expect((await db.query(`SELECT buttons FROM broadcasts WHERE key = 'coordinator:t:1'`)).rows[0].buttons).toBeNull();
});
