import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { seedCoordinator, seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: RequestsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new RequestsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const coordinator = (name: string, ...roles: string[]) => seedCoordinator(db, name, roles);
const responsibleOf = async (id: number) => (await db.query<{ responsible: string | null }>('SELECT responsible FROM requests WHERE id = $1', [id])).rows[0]!.responsible;
const botRequest = async (n: number, type: 'join_group' | 'lead_group' | 'question' = 'join_group') => {
  const u = await seedUser(db, { id: String(1000 + n) });
  return (await repo.create(u, type)).id;
};

describe('новым заявкам автоматически назначается распределитель', () => {
  test('заявка «хочу в группу» из бота получает ответственного — распределителя из «Команды»', async () => {
    await coordinator('Анна Распределова', 'Распределитель');
    await coordinator('Борис Координатор', 'Координатор');
    expect(await responsibleOf(await botRequest(1))).toBe('Анна Распределова');
  });

  test('распределитель среди нескольких ролей человека тоже получает заявки', async () => {
    await coordinator('Вера', 'Координатор', 'Катализатор', 'Распределитель');
    expect(await responsibleOf(await botRequest(1))).toBe('Вера');
  });

  test('решает смысл роли из справочника, а не слово в названии', async () => {
    // Своя роль из «Настроек»: словами её не завести, незнакомое название ложится на «Координатора».
    await db.query("INSERT INTO team_roles (name) VALUES ('Обзвон')");
    await coordinator('Галина', 'Обзвон');
    await coordinator('Дмитрий', 'Распределитель');
    // «Обзвон» отмечен распределителем, а у «Распределителя» смысл сняли: заявку получает Галина.
    await db.query("UPDATE team_roles SET kind = 'distributor' WHERE name = 'Обзвон'");
    await db.query("UPDATE team_roles SET kind = NULL WHERE name = 'Распределитель'");
    expect(await responsibleOf(await botRequest(1))).toBe('Галина');
  });

  test('распределителей нет — заявка остаётся без ответственного, ничего не ломается', async () => {
    await coordinator('Борис Координатор', 'Координатор');
    expect(await responsibleOf(await botRequest(1))).toBeNull();
  });

  test('заявки раздаются поровну: каждая следующая — тому, у кого сейчас меньше открытых', async () => {
    await coordinator('Анна', 'Распределитель');
    await coordinator('Борис', 'Распределитель');
    await coordinator('Вера', 'Распределитель');
    const ids = [];
    for (let i = 1; i <= 7; i++) ids.push(await botRequest(i));
    const by = new Map<string, number>();
    for (const id of ids) by.set((await responsibleOf(id))!, (by.get((await responsibleOf(id))!) ?? 0) + 1);
    expect([...by.values()].sort()).toEqual([2, 2, 3]);
  });

  test('учитывается уже накопленная нагрузка: у кого меньше открытых заявок, тому и достаётся', async () => {
    await coordinator('Анна', 'Распределитель');
    await coordinator('Борис', 'Распределитель');
    for (let i = 0; i < 3; i++) await db.query(`INSERT INTO requests (type, fio, status, responsible, origin) VALUES ('join_group', 'Старая', 'Новая', 'Анна', 'ui')`);
    // Закрытые заявки нагрузкой не считаются.
    for (let i = 0; i < 5; i++) await db.query(`INSERT INTO requests (type, fio, status, responsible, origin) VALUES ('join_group', 'Закрытая', 'Исполнена', 'Борис', 'ui')`);
    expect(await responsibleOf(await botRequest(1))).toBe('Борис');
  });

  test('одновременные заявки не достаются одному человеку: распределение под замком', async () => {
    await coordinator('Анна', 'Распределитель');
    await coordinator('Борис', 'Распределитель');
    const users = await Promise.all([1, 2, 3, 4].map((n) => seedUser(db, { id: String(2000 + n) })));
    const created = await Promise.all(users.map((u) => repo.create(u, 'join_group')));
    const counts = new Map<string, number>();
    for (const r of created) counts.set((await responsibleOf(r.id))!, (counts.get((await responsibleOf(r.id))!) ?? 0) + 1);
    expect([...counts.values()]).toEqual([2, 2]);
  });

  test('вопросы и «хочу открыть» не раздаются: распределитель нужен для желающих в группу', async () => {
    await coordinator('Анна', 'Распределитель');
    expect(await responsibleOf(await botRequest(1, 'question'))).toBeNull();
    expect(await responsibleOf(await botRequest(2, 'lead_group'))).toBeNull();
  });

  test('убранный из «Команды» распределитель заявок не получает', async () => {
    await coordinator('Анна', 'Распределитель');
    await db.query(`UPDATE coordinators SET archived_at = now() WHERE name = 'Анна'`);
    expect(await responsibleOf(await botRequest(1))).toBeNull();
  });

  test('заявка из формы дашборда: если ответственного не указали, назначается распределитель; указанный остаётся', async () => {
    await coordinator('Анна', 'Распределитель');
    const base = { fio: 'Из формы', type: 'join_group' as const, status: 'Новая' as const };
    expect(await responsibleOf(await repo.createFromDashboard({ ...base }))).toBe('Анна');
    expect(await responsibleOf(await repo.createFromDashboard({ ...base, responsible: 'Другой Человек' }))).toBe('Другой Человек');
  });

  test('назначение попадает в журнал как автоматическое, чтобы в ленте заявки было видно, откуда ответственный', async () => {
    await coordinator('Анна', 'Распределитель');
    const id = await botRequest(1);
    const { rows } = await db.query(`SELECT actor, action, entity_type, entity_id::int AS entity_id, after FROM audit_log`);
    expect(rows).toEqual([{ actor: 'авто-распределение', action: 'request.assign', entity_type: 'request', entity_id: id, after: { responsible: 'Анна', auto: true } }]);
  });
});
