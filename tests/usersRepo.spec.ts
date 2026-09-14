import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Кандидаты в ведущие: дашборд предлагает их при заведении новой домашней группы
 * вместо повторного набора ФИО и телефона вручную.
 */
let db: Pool;
let repo: UsersRepo;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); repo = new UsersRepo(db); });

describe('кандидаты в ведущие', () => {
  test('готов открыть или предоставить дом — оба считаются кандидатами', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', fio: 'Открывающий Открыт' });
    await seedUser(db, { id: '2', mdgStatus: 'home', fio: 'Хозяин Дома' });

    const names = (await repo.leaderCandidates()).map((c) => c.full_name).sort();
    expect(names).toEqual(['Открывающий Открыт', 'Хозяин Дома'].sort());
  });

  test('тот, кто уже состоит или уже ведёт группу, кандидатом на новую не считается', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'member' });
    await seedUser(db, { id: '2', mdgStatus: 'leader' });
    await seedUser(db, { id: '3', mdgStatus: 'join' });

    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('незавершённая анкета не в счёт', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', complete: false });
    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('заблокировавший бота исключён: до него не достучаться', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'open', blocked: true });
    expect(await repo.leaderCandidates()).toEqual([]);
  });

  test('отдаёт весь профиль, который человек заполнил в боте', async () => {
    const id = await seedUser(db, {
      id: '1', mdgStatus: 'open', fio: 'Панов Дмитрий Александрович',
      phone: '+79944178986', church: 'Церковь «Миссия Свет Христа»',
    });
    await db.query(`UPDATE users SET location = 'Лесная', age = '18-25' WHERE id = $1`, [id]);

    const [c] = await repo.leaderCandidates();
    expect(c).toMatchObject({
      full_name: 'Панов Дмитрий Александрович',
      phone: '+79944178986',
      church: 'Церковь «Миссия Свет Христа»',
      mdg_status: 'open',
      location: 'Лесная',
      age: '18-25',
    });
  });
});
