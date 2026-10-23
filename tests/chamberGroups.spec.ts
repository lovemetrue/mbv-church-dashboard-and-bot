import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { GroupDirectionsRepo } from '../src/db/repos/groupDirections.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { PlacementRepo } from '../src/db/repos/placement.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { TeamRolesRepo } from '../src/db/repos/teamRoles.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { composeViews, engine } from '../src/home-groups/composition.js';
import { createRecordCreator } from '../src/home-groups/create.js';
import { createManager } from '../src/home-groups/manage.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * «Камерная группа» (служителей или отдельного служения, миграция 052): людей в неё не направляют ни подбор, ни
 * ручное «Утвердить», а сама отметка и направление ставятся в форме группы.
 */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const creator = () => createRecordCreator({ requests: new RequestsRepo(db), groups: new GroupsRepo(db), directions: new GroupDirectionsRepo(db), audit: new AuditRepo(db) });
const manager = () => createManager({
  groups: new GroupsRepo(db), coordinators: new CoordinatorsRepo(db), teamRoles: new TeamRolesRepo(db), directions: new GroupDirectionsRepo(db),
  requests: new RequestsRepo(db), users: new UsersRepo(db), audit: new AuditRepo(db),
});
const views = () => composeViews(db, engine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' })();
const FIELDS = { leader: 'Иван', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует', people: '3' };

async function created(fields: Record<string, string>): Promise<number> {
  const out = await creator().group({ fields }, 'boss');
  if (!out.ok) throw new Error(out.message);
  return out.id;
}

describe('направление и камерная отметка в форме группы', () => {
  test('новая группа: направление из справочника, камерная — по галочке', async () => {
    const id = await created({ ...FIELDS, direction: 'Филиал «Серебристый»', chamber: '1' });
    expect(await new GroupsRepo(db).findActive(id)).toMatchObject({ direction: 'Филиал «Серебристый»', chamber: true, do_not_refer: false });
  });

  test('направления не из справочника не принимают: молча на основное оно бы не легло', async () => {
    expect(await creator().group({ fields: { ...FIELDS, direction: 'Марсианское служение' } }, 'boss'))
      .toMatchObject({ ok: false, error: 'bad_request', message: expect.stringMatching(/нет в справочнике/) });
    const id = await created(FIELDS);
    expect(await manager().updateGroup(id, { fields: { direction: 'Марсианское служение' } }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('правка ставит и снимает камерную отметку; неприсланная остаётся как была, направление тоже', async () => {
    const id = await created({ ...FIELDS, direction: 'Молодёжное служение' });
    expect(await manager().updateGroup(id, { fields: { chamber: '1' } }, 'boss')).toEqual({ ok: true });
    expect(await new GroupsRepo(db).findActive(id)).toMatchObject({ chamber: true, direction: 'Молодёжное служение' });
    expect(await manager().updateGroup(id, { fields: { people: '5' } }, 'boss')).toEqual({ ok: true });
    expect((await new GroupsRepo(db).findActive(id))!.chamber).toBe(true);
    expect(await manager().updateGroup(id, { fields: { chamber: '', direction: 'Подростковое служение' } }, 'boss')).toEqual({ ok: true });
    expect(await new GroupsRepo(db).findActive(id)).toMatchObject({ chamber: false, direction: 'Подростковое служение' });
  });
});

describe('в камерную группу людей не направляют', () => {
  async function joinRequest(): Promise<number> {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, place, age, origin) VALUES ('join_group', 'Новая', 'Мария', 'Приморский', '30', 'ui') RETURNING id`,
    );
    return rows[0]!.id;
  }

  test('подбор её не предлагает, а в карточке группы видна отметка', async () => {
    const id = await created({ ...FIELDS, chamber: '1' });
    const r = await joinRequest();
    const v = await views();
    expect(v.requests.items.find((i) => i.id === r)!.proposal).toBeNull();
    expect(v.groups.items.find((g) => g.id === id)).toMatchObject({ chamber: true, contactsHidden: false, direction: 'Основное служение' });
    // Та же группа без отметки — предлагается: дело именно в отметке.
    await manager().updateGroup(id, { fields: { chamber: '' } }, 'boss');
    expect((await views()).requests.items.find((i) => i.id === r)!.proposal?.main.group.id).toBe(id);
  });

  test('«Утвердить» вручную в неё отказывает понятным текстом', async () => {
    const id = await created({ ...FIELDS, chamber: '1' });
    const r = await joinRequest();
    expect(await new PlacementRepo(db).approve(r, id, 'boss', { force: true, defaultCapacity: 10 }))
      .toMatchObject({ ok: false, error: 'group_unavailable', message: expect.stringMatching(/камерная/) });
  });
});
