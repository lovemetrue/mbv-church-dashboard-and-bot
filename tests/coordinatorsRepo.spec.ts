import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Участники: один и тот же человек может быть и «Координатором» у группы,
 * и «Ответственным» у заявки — список общий, роль в нём — просто подпись.
 */
let db: Pool;
let repo: CoordinatorsRepo;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); repo = new CoordinatorsRepo(db); });

describe('заведение и список участников', () => {
  test('заведённый в дашборде помечается источником ui', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: 'Координатор малых групп' });
    expect(row).toMatchObject({ name: 'Петрова Мария', role: 'Координатор малых групп', source: 'ui' });
  });

  test('listActive отдаёт по роли и имени', async () => {
    await repo.create({ name: 'Иванов Иван', role: 'Ответственный' });
    await repo.create({ name: 'Петрова Мария', role: 'Координатор' });
    const rows = await repo.listActive();
    expect(rows.map((r) => r.name)).toEqual(['Петрова Мария', 'Иванов Иван']);
  });

  test('убранный участник в список не попадает, но остаётся в базе', async () => {
    const row = await repo.create({ name: 'Ошибочная Запись', role: 'Координатор' });
    expect(await repo.archive(row.id)).toBe(true);
    expect(await repo.listActive()).toEqual([]);

    const { rows } = await db.query('SELECT archived_at FROM coordinators WHERE id = $1', [row.id]);
    expect(rows[0]!.archived_at).not.toBeNull();
  });

  test('повторное удаление отвечает false, а не молчаливым успехом', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: 'Координатор' });
    await repo.archive(row.id);
    expect(await repo.archive(row.id)).toBe(false);
  });
});

describe('правка участников', () => {
  test('правка меняет имя и роль', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: 'Координатор' });
    const updated = await repo.update(row.id, { name: 'Петрова Мария Ивановна', role: 'Старший координатор' });
    expect(updated).toMatchObject({ name: 'Петрова Мария Ивановна', role: 'Старший координатор' });
  });

  test('правка строки из выгрузки берёт её под управление дашборда', async () => {
    const { rows } = await db.query(
      `INSERT INTO coordinators (name, role, source) VALUES ('Из Выгрузки', 'Координатор', 'таблица') RETURNING id`,
    );
    const updated = await repo.update(rows[0]!.id, { name: 'Исправлено', role: 'Координатор' });
    expect(updated).toMatchObject({ name: 'Исправлено', source: 'ui' });
  });

  test('правка того, чего нет, возвращает пустоту', async () => {
    expect(await repo.update(999999, { name: 'Кто-то', role: 'Координатор' })).toBeNull();
  });

  test('правка убранной записи не поднимает её обратно', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: 'Координатор' });
    await repo.archive(row.id);
    expect(await repo.update(row.id, { name: 'Возвращённая', role: 'Координатор' })).toBeNull();
  });
});
