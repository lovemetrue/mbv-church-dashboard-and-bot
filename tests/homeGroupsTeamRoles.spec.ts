import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { TeamRolesRepo } from '../src/db/repos/teamRoles.repo.js';
import { createTeamRoles } from '../src/home-groups/teamRoles.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const roles = () => createTeamRoles({ repo: new TeamRolesRepo(db), audit: new AuditRepo(db) });
const idOf = async (name: string) => (await db.query<{ id: number }>('SELECT id::int AS id FROM team_roles WHERE name = $1', [name])).rows[0]!.id;

describe('«Настройки → Роли команды»', () => {
  test('список: основные роли на месте, у каждой — смысл и сколько людей с ней', async () => {
    await new CoordinatorsRepo(db).create({ name: 'Родионов Давид', roles: [{ name: 'Распределитель' }, { name: 'Катализатор' }] });
    await new CoordinatorsRepo(db).create({ name: 'Анна', roles: [{ name: 'Распределитель' }] });
    const view = await roles().view();
    expect(view.items).toEqual([
      { id: expect.any(Number), name: 'Катализатор', kind: 'catalyst', members: 1 },
      { id: expect.any(Number), name: 'Координатор', kind: 'coordinator', members: 0 },
      { id: expect.any(Number), name: 'Распределитель', kind: 'distributor', members: 2 },
      { id: expect.any(Number), name: 'Старший координатор', kind: 'senior', members: 0 },
      { id: expect.any(Number), name: 'Старший распределитель', kind: 'senior_distributor', members: 0 },
    ]);
  });

  test('новая роль: название без лишних пробелов, смысл необязателен; повтор названия — отказ', async () => {
    expect(await roles().create({ name: '  Молодёжный   координатор ', kind: 'coordinator' }, 'boss')).toMatchObject({ ok: true, id: expect.any(Number) });
    expect(await roles().create({ name: 'Пастор', kind: null }, 'boss')).toMatchObject({ ok: true });
    expect(await roles().create({ name: 'молодёжный координатор' }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    const names = (await roles().view()).items.map((r) => [r.name, r.kind]);
    expect(names).toContainEqual(['Молодёжный координатор', 'coordinator']);
    expect(names).toContainEqual(['Пастор', null]);
  });

  test('проверка ввода: пустое название и неизвестный смысл не проходят', async () => {
    expect(await roles().create({ name: ' ' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await roles().create({ name: 'Хор', kind: 'boss' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await roles().update({ name: 'Хор' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('переименование и смена смысла видны у людей с этой ролью', async () => {
    const coordinators = new CoordinatorsRepo(db);
    const c = await coordinators.create({ name: 'Анна', roles: [{ name: 'Координатор' }] });
    expect(await roles().update({ id: c.role_ids[0]!, name: 'Координатор МГ', kind: 'senior' }, 'boss')).toEqual({ ok: true });
    expect(await coordinators.findActive(c.id)).toMatchObject({ role: 'Координатор МГ', role_kinds: ['senior'] });
    expect(await roles().update({ id: c.role_ids[0]!, name: 'Распределитель', kind: null }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await roles().update({ id: 9999, name: 'Х', kind: null }, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('удалить можно только роль без людей, в том числе без удалённых из справочника', async () => {
    const coordinators = new CoordinatorsRepo(db);
    const c = await coordinators.create({ name: 'Анна', roles: [{ name: 'Распределитель' }] });
    expect(await roles().delete({ id: c.role_ids[0]! }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    await coordinators.archive(c.id);
    expect(await roles().delete({ id: c.role_ids[0]! }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    const free = await idOf('Старший координатор');
    expect(await roles().delete({ id: free }, 'boss')).toEqual({ ok: true });
    expect(await roles().delete({ id: free }, 'boss')).toMatchObject({ ok: false, error: 'not_found' });
  });

  test('в журнале — что сделали с ролью и кто', async () => {
    const made = await roles().create({ name: 'Пастор', kind: null }, 'boss');
    if (!made.ok) throw new Error('роль не завелась');
    await roles().update({ id: made.id, name: 'Пастор церкви', kind: null }, 'boss');
    await roles().delete({ id: made.id }, 'boss');
    const { rows } = await db.query("SELECT actor, action, after::text AS after FROM audit_log WHERE action LIKE 'team_role.%' ORDER BY id");
    expect(rows.map((r) => [r.actor, r.action, JSON.parse(r.after)])).toEqual([
      ['boss', 'team_role.create', { name: 'Пастор', kind: null }],
      ['boss', 'team_role.update', { name: 'Пастор церкви', kind: null }],
      ['boss', 'team_role.delete', {}],
    ]);
  });
});
