import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Связь заявки с группой (group_id): отдельный файл, потому что до сих пор
 * RequestsRepo проверялся только через HTTP в dashboardCreateIntegration.spec —
 * этого хватало для плоских полей, но не для связи с другой таблицей.
 */
let db: Pool;
let requests: RequestsRepo;
let groups: GroupsRepo;

const REQUEST_MIN = { fio: 'Петров Пётр', type: 'join_group' as const, status: 'Новая' as const };
const GROUP_MIN = {
  leader: 'Иванова Мария', district: 'Невский', format: 'Молодежная' as const, status: 'Функционирует' as const,
};

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => {
  await truncateAll(db);
  requests = new RequestsRepo(db);
  groups = new GroupsRepo(db);
});

describe('заявка ссылается на домашнюю группу', () => {
  test('заведение из дашборда сохраняет привязку', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ id, group_id: group.id });
  });

  test('без выбора группы поле пустое', async () => {
    await requests.createFromDashboard(REQUEST_MIN);
    const [row] = await requests.forDashboard();
    expect(row!.group_id).toBeNull();
  });

  test('полная правка меняет привязку, включая сброс на пусто', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    await requests.updateFromDashboard(id, { ...REQUEST_MIN, groupId: null });
    expect((await requests.forDashboard())[0]!.group_id).toBeNull();
  });

  test('быстрое назначение через setStatus проставляет группу', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard(REQUEST_MIN);

    await requests.setStatus(id, 'В работе', null, group.id);
    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ status: 'В работе', group_id: group.id });
  });

  test('setStatus без указания группы не стирает уже выбранную', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard({ ...REQUEST_MIN, groupId: group.id });

    await requests.setStatus(id, 'В работе');
    expect((await requests.forDashboard())[0]!.group_id).toBe(group.id);
  });
});
