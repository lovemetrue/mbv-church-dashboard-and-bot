import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

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

  /**
   * Баг из дашборда: назначили группу через быструю правку, затем выбрали в
   * выпадающем списке «— группа не назначена —» и сохранили — прочерк не
   * возвращался. Причина была в `coalesce($5, group_id)`: явный null от
   * пустого <select> неотличим от «поле вообще не передали», и coalesce
   * оставлял старое значение. Форма всегда шлёт все три поля, так что явный
   * null здесь — не «не указано», а «снять выбор».
   */
  test('setStatus с явным null возвращает группу на «не назначена»', async () => {
    const group = await groups.create(GROUP_MIN, 'ui');
    const id = await requests.createFromDashboard(REQUEST_MIN);

    await requests.setStatus(id, 'В работе', null, group.id);
    await requests.setStatus(id, 'В работе', null, null);
    expect((await requests.forDashboard())[0]!.group_id).toBeNull();
  });

  /** Тот же баг, но для ответственного — тем же select с пустой опцией. */
  test('setStatus с явным null снимает и ответственного', async () => {
    const id = await requests.createFromDashboard(REQUEST_MIN);

    await requests.setStatus(id, 'В работе', 'Иванова Мария');
    await requests.setStatus(id, 'В работе', null);
    expect((await requests.forDashboard())[0]!.responsible).toBeNull();
  });
});

describe('ответы анкеты бота видны на заявке', () => {
  test('церковь и статус по МДГ приходят от участника, а не пустуют', async () => {
    const userId = await seedUser(db, { id: '900', church: 'МБВ (Колизей)', mdgStatus: 'open' });
    const created = await requests.create(userId, 'lead_group');

    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ id: created.id, church: 'МБВ (Колизей)', mdg_status: 'open' });
  });

  /**
   * Человек, который уже состоит в группе (или уже её ведёт), в анкете бота называет
   * своего ведущего — раньше это записывалось в базу (leader_name), но на дашборде
   * заявки не показывалось нигде, хотя служителю как раз важно знать, к кому человек
   * уже прикреплён.
   */
  test('ведущий группы приходит от участника, если он его назвал в анкете', async () => {
    const userId = await seedUser(db, { id: '901', mdgStatus: 'member' });
    await db.query('UPDATE users SET leader_name = $1 WHERE id = $2', ['Смирнова Ольга', userId]);
    const created = await requests.create(userId, 'already_member');

    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ id: created.id, leader_name: 'Смирнова Ольга' });
  });

  test('у заявки из таблицы церкви (без участника) оба поля пустые', async () => {
    await requests.createFromDashboard(REQUEST_MIN);
    const [row] = await requests.forDashboard();
    expect(row).toMatchObject({ church: null, mdg_status: null });
  });

  test('новые типы «уже состою» и «уже веду» проходят ограничение в базе', async () => {
    const userId = await seedUser(db, { id: '901', mdgStatus: 'leader' });
    const created = await requests.create(userId, 'already_leader');
    expect(created.type).toBe('already_leader');
  });
});
