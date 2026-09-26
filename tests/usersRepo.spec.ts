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

/**
 * Регистрация человека служителем — например, через дашборд для тех, кто заполнил
 * анкету на бумаге. Своего чата с ботом у такого участника нет.
 */
describe('ручная регистрация участника', () => {
  test('получает случайный 4-значный номер без ведущего нуля и считается завершённой', async () => {
    const u = await repo.createManual({
      platform: 'telegram', byAdminId: 'дашборд', fio: 'Петрова Мария Ивановна', phone: '+79001112233',
    });
    expect(u.registration_no).toBeGreaterThanOrEqual(1000);
    expect(u.registration_no).toBeLessThanOrEqual(9999);
    expect(u).toMatchObject({ full_name: 'Петрова Мария Ивановна', phone: '+79001112233', complete: true, chat_id: '' });
    expect(u.registered_at).toBeInstanceOf(Date);
  });

  test('platform_user_id и registration_no — один и тот же номер', async () => {
    const u = await repo.createManual({ platform: 'telegram', byAdminId: 'дашборд', fio: 'Иванов Иван', phone: '+79001112234' });
    expect(u.platform_user_id).toBe(`manual:${u.registration_no}`);
  });

  test('две ручные регистрации получают разные номера', async () => {
    const a = await repo.createManual({ platform: 'telegram', byAdminId: 'дашборд', fio: 'Первый', phone: '+79001112235' });
    const b = await repo.createManual({ platform: 'telegram', byAdminId: 'дашборд', fio: 'Второй', phone: '+79001112239' });
    expect(a.registration_no).not.toBe(b.registration_no);
  });

  test('церковь и статус по МДГ сохраняются, если их заполнили', async () => {
    const u = await repo.createManual({
      platform: 'telegram', byAdminId: 'дашборд', fio: 'Сидорова Анна', phone: '+79001112236',
      church: 'МБВ (Колизей)', mdgStatus: 'open',
    });
    expect(u).toMatchObject({ church: 'МБВ (Колизей)', mdg_status: 'open' });
  });

  /**
   * Тот же вопрос, что бот задаёт «уже состоящим в группе» (см. awaitLeaderName
   * в fsm.ts) — форма ручной регистрации теперь повторяет эту ветку анкеты.
   */
  test('ведущий группы сохраняется, если его назвали', async () => {
    const u = await repo.createManual({
      platform: 'telegram', byAdminId: 'дашборд', fio: 'Кузнецова Ольга', phone: '+79001112240',
      mdgStatus: 'member', leaderName: 'Смирнова Ольга Викторовна',
    });
    expect(u).toMatchObject({ mdg_status: 'member', leader_name: 'Смирнова Ольга Викторовна' });
  });
});

describe('список регистраций для дашборда', () => {
  test('свежая регистрация сверху', async () => {
    await seedUser(db, { id: '1', fio: 'Первый' });
    await repo.createManual({ platform: 'telegram', byAdminId: 'дашборд', fio: 'Второй Ручной', phone: '+79001112237' });

    const list = await repo.listRegistered();
    expect(list.map((r) => r.full_name)).toEqual(['Второй Ручной', 'Первый']);
  });

  test('незавершённая анкета (без номера) в список не попадает', async () => {
    await seedUser(db, { id: '1', registered: false });
    expect(await repo.listRegistered()).toEqual([]);
  });

  test('у заведённого ботом видно, что чат есть, у заведённого вручную — что нет', async () => {
    await seedUser(db, { id: '1', fio: 'Из бота' });
    await repo.createManual({ platform: 'telegram', byAdminId: 'дашборд', fio: 'Из дашборда', phone: '+79001112238' });

    const list = await repo.listRegistered();
    expect(list.find((r) => r.full_name === 'Из бота')?.has_chat).toBe(true);
    expect(list.find((r) => r.full_name === 'Из дашборда')?.has_chat).toBe(false);
  });

  test('удалённая регистрация в список не попадает', async () => {
    const id = await seedUser(db, { id: '1', fio: 'Убрали по ошибке' });
    await repo.delete(id);

    expect(await repo.listRegistered()).toEqual([]);
  });

  test('несёт возраст и район из анкеты', async () => {
    await repo.createManual({
      platform: 'telegram', byAdminId: 'дашборд', fio: 'С анкетой', phone: '+79001112239',
      location: 'Приморский', age: '25-40',
    });

    const [row] = await repo.listRegistered();
    expect(row).toMatchObject({ location: 'Приморский', age: '25-40' });
  });
});

describe('удаление регистрации из дашборда', () => {
  // Жёсткое удаление — по явному решению: в отличие от групп/участников/заявок,
  // запись физически стирается из базы, а не помечается архивной.
  test('первый раз удаляет и возвращает true, повторно — false', async () => {
    const id = await seedUser(db, { id: '1' });
    expect(await repo.delete(id)).toBe(true);
    expect(await repo.delete(id)).toBe(false);
  });

  test('несуществующий id возвращает false', async () => {
    expect(await repo.delete(999999)).toBe(false);
  });

  test('запись действительно стирается из базы, а не помечается', async () => {
    const id = await seedUser(db, { id: '1' });
    await repo.delete(id);

    expect(await repo.findById(id)).toBeNull();
  });

  test('удалённого не считаем получателем рассылки', async () => {
    const id = await seedUser(db, { id: '1', platform: 'telegram' });
    await repo.delete(id);

    expect(await repo.recipients('telegram')).toEqual([]);
  });

  test('удалённый не попадает в выгрузку для церкви', async () => {
    const id = await seedUser(db, { id: '1', fio: 'Убрали' });
    await repo.delete(id);

    expect(await repo.exportRows()).toEqual([]);
  });
});
