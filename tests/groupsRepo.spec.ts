import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Хранилище домашних групп. Раньше эти проверки шли через диалог `/leader` в боте;
 * заводить группы теперь только в дашборде, поэтому проверяем сам репозиторий.
 * Путь «форма → HTTP → база» покрыт в dashboardCreateIntegration.spec.
 */
let db: Pool;
let repo: GroupsRepo;

const MIN = {
  leader: 'Петров Пётр Петрович',
  district: 'Приморский',
  format: 'Молодежная' as const,
  status: 'Функционирует' as const,
};

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); repo = new GroupsRepo(db); });

describe('заведение групп', () => {
  test('через бота сохраняется короткий набор, телефон попадает и в список для звонка', async () => {
    const row = await repo.add({ ...MIN, phone: '+79001112233', people: 7 }, '999', 'telegram');
    expect(row).toMatchObject({
      leader: 'Петров Пётр Петрович',
      phone: '+79001112233',
      phones: ['+79001112233'],
      people: 7,
      source: 'бот',
      added_by: '999',
      added_platform: 'telegram',
    });
  });

  test('через дашборд сохраняются все поля листа', async () => {
    const row = await repo.create({
      ...MIN,
      no: 42,
      openToNew: 'ДА',
      phone: '8 (900) 111-22-33; Мария',
      phones: ['+79001112233'],
      age: '35-50',
      metro: 'Пионерская',
      address: 'ул. Есенина, д. 1',
      composition: 'Смешанная',
      day: 'Четверг',
      time: '19:00',
      people: 8,
      coordinator: 'Петрова Мария',
      feedbackAt: '2026-08-20',
      comment: 'Раз в две недели',
      training: 'Да',
      checked: true,
    }, 'ui');

    expect(row).toMatchObject({
      no: 42, open_to_new: 'ДА', age: '35-50', metro: 'Пионерская',
      address: 'ул. Есенина, д. 1', composition: 'Смешанная', day: 'Четверг',
      time: '19:00', coordinator: 'Петрова Мария', comment: 'Раз в две недели',
      training: 'Да', checked: true, source: 'ui',
    });
    // У заведённого в дашборде нет служителя-автора: там вход по паролю, а не по id.
    expect(row.added_by).toBeNull();
  });

  test('импортированное из таблицы отличимо от остального', async () => {
    await repo.create({ ...MIN, leader: 'Из Выгрузки' }, 'таблица');
    await repo.create({ ...MIN, leader: 'Из Дашборда' }, 'ui');
    await repo.add({ ...MIN, leader: 'Из Бота' }, '999', 'telegram');

    const rows = await repo.forDashboard();
    expect(new Map(rows.map((r) => [r.leader, r.source]))).toEqual(
      new Map([['Из Выгрузки', 'таблица'], ['Из Дашборда', 'ui'], ['Из Бота', 'бот']]),
    );
  });
});

describe('данные для дашборда', () => {
  test('пустые поля приходят пустотой, а не пустой строкой', async () => {
    await repo.add(MIN, '999', 'telegram');
    const [g] = await repo.forDashboard();
    // Раньше forDashboard подставляла в эти поля '' и дату создания в «обратную связь»,
    // из-за чего колонка врала. Теперь незаполненное честно пустое.
    expect(g!.metro).toBeNull();
    expect(g!.address).toBeNull();
    expect(g!.coordinator).toBeNull();
    expect(g!.feedback_at).toBeNull();
    expect(typeof g!.id).toBe('number');
  });

  test('сортировка как в реестре: с номерами по порядку, без номера в конце', async () => {
    await repo.create({ ...MIN, leader: 'Без номера' }, 'ui');
    await repo.create({ ...MIN, leader: 'Номер три', no: 3 }, 'таблица');
    await repo.create({ ...MIN, leader: 'Номер один', no: 1 }, 'таблица');

    expect((await repo.forDashboard()).map((g) => g.leader)).toEqual([
      'Номер один', 'Номер три', 'Без номера',
    ]);
  });

  test('убранная группа в дашборд не попадает, но остаётся в базе', async () => {
    const row = await repo.add({ ...MIN, leader: 'Ошибочная' }, '999', 'telegram');
    expect(await repo.archive(row.id)).not.toBeNull();
    expect(await repo.forDashboard()).toEqual([]);

    const { rows } = await db.query('SELECT archived_at FROM groups WHERE id = $1', [row.id]);
    expect(rows[0]!.archived_at).not.toBeNull();
  });

  test('повторное удаление возвращает пустоту, а не молчаливый успех', async () => {
    const row = await repo.add(MIN, '999', 'telegram');
    await repo.archive(row.id);
    expect(await repo.archive(row.id)).toBeNull();
  });

  test('дата обратной связи отдаётся строкой, а не объектом даты', async () => {
    await repo.create({ ...MIN, feedbackAt: '2026-08-20' }, 'таблица');
    const [g] = await repo.forDashboard();
    expect(g!.feedback_at).toBe('2026-08-20');
  });
});

describe('правка и удаление групп', () => {
  test('правка меняет любое поле', async () => {
    const row = await repo.create({ ...MIN, metro: 'Пионерская', people: 5 }, 'ui');
    const updated = await repo.update(row.id, {
      ...MIN,
      leader: 'Петрова Пелагея',
      status: 'На паузе',
      metro: 'Озерки',
      people: 9,
      comment: 'Перенесли день',
    });
    expect(updated).toMatchObject({
      leader: 'Петрова Пелагея', status: 'На паузе', metro: 'Озерки', people: 9,
      comment: 'Перенесли день',
    });
  });

  test('правка строки из выгрузки берёт её под управление дашборда', async () => {
    // Иначе следующий импорт затёр бы правку: он перезаливает всё, что из таблицы.
    const row = await repo.create({ ...MIN, no: 7, leader: 'Из Выгрузки' }, 'таблица');
    const updated = await repo.update(row.id, { ...MIN, no: 7, leader: 'Исправлено' });
    expect(updated).toMatchObject({ leader: 'Исправлено', source: 'ui' });
  });

  test('удаление строки из выгрузки тоже берёт её под управление', async () => {
    const row = await repo.create({ ...MIN, no: 8, leader: 'Лишняя' }, 'таблица');
    const archived = await repo.archive(row.id);
    expect(archived).toMatchObject({ source: 'ui' });
    expect(archived!.archived_at).not.toBeNull();
  });

  test('правка того, чего нет, возвращает пустоту', async () => {
    expect(await repo.update(999999, MIN)).toBeNull();
  });

  test('заведённое в дашборде остаётся своим и после правки', async () => {
    const row = await repo.create({ ...MIN }, 'ui');
    expect((await repo.update(row.id, { ...MIN, leader: 'Другой' }))!.source).toBe('ui');
  });

  test('правка убранной записи не поднимает её обратно', async () => {
    const row = await repo.create({ ...MIN }, 'ui');
    await repo.archive(row.id);
    expect(await repo.update(row.id, { ...MIN, leader: 'Возвращённый' })).toBeNull();
  });
});
