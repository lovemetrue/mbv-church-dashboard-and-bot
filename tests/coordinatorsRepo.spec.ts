import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { CoordinatorsRepo } from '../src/db/repos/coordinators.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * Участники: один и тот же человек может быть и «Координатором» у группы,
 * и «Ответственным» у заявки — список общий. Роль — ссылка на справочник `team_roles` (миграция 049).
 */
let db: Pool;
let repo: CoordinatorsRepo;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); repo = new CoordinatorsRepo(db); });

describe('заведение и список участников', () => {
  test('заведённый в дашборде помечается источником ui', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: { name: 'Координатор малых групп' } });
    expect(row).toMatchObject({ name: 'Петрова Мария', role: 'Координатор малых групп', source: 'ui' });
  });

  test('listActive отдаёт по роли и имени', async () => {
    await repo.create({ name: 'Иванов Иван', role: { name: 'Ответственный' } });
    await repo.create({ name: 'Петрова Мария', role: { name: 'Координатор' } });
    const rows = await repo.listActive();
    expect(rows.map((r) => r.name)).toEqual(['Петрова Мария', 'Иванов Иван']);
  });

  test('убранный участник в список не попадает, но остаётся в базе', async () => {
    const row = await repo.create({ name: 'Ошибочная Запись', role: { name: 'Координатор' } });
    expect(await repo.archive(row.id)).toBe(true);
    expect(await repo.listActive()).toEqual([]);

    const { rows } = await db.query('SELECT archived_at FROM coordinators WHERE id = $1', [row.id]);
    expect(rows[0]!.archived_at).not.toBeNull();
  });

  test('повторное удаление отвечает false, а не молчаливым успехом', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: { name: 'Координатор' } });
    await repo.archive(row.id);
    expect(await repo.archive(row.id)).toBe(false);
  });
});

describe('правка участников', () => {
  test('правка меняет имя и роль', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: { name: 'Координатор' } });
    const updated = await repo.update(row.id, { name: 'Петрова Мария Ивановна', role: { name: 'Старший координатор' } });
    expect(updated).toMatchObject({ name: 'Петрова Мария Ивановна', role: 'Старший координатор', role_kind: 'senior' });
  });

  test('правка строки из выгрузки берёт её под управление дашборда', async () => {
    const { rows } = await db.query(
      `INSERT INTO coordinators (name, role_id, source) VALUES ('Из Выгрузки', team_role_id('Координатор'), 'таблица') RETURNING id`,
    );
    const updated = await repo.update(rows[0]!.id, { name: 'Исправлено', role: { name: 'Координатор' } });
    expect(updated).toMatchObject({ name: 'Исправлено', source: 'ui' });
  });

  test('правка того, чего нет, возвращает пустоту', async () => {
    expect(await repo.update(999999, { name: 'Кто-то', role: { name: 'Координатор' } })).toBeNull();
  });

  test('правка убранной записи не поднимает её обратно', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: { name: 'Координатор' } });
    await repo.archive(row.id);
    expect(await repo.update(row.id, { name: 'Возвращённая', role: { name: 'Координатор' } })).toBeNull();
  });
});

describe('роль — ссылка на справочник ролей', () => {
  test('роль из списка ставится по id и приходит с названием и смыслом', async () => {
    const { rows } = await db.query<{ id: number }>("SELECT id::int AS id FROM team_roles WHERE name = 'Распределитель'");
    const row = await repo.create({ name: 'Родионов Давид', role: { id: rows[0]!.id } });
    expect(row).toMatchObject({ role: 'Распределитель', role_id: rows[0]!.id, role_kind: 'distributor' });
  });

  test('роль словами (старый дашборд, таблица церкви) находит существующую без учёта регистра и пробелов', async () => {
    const row = await repo.create({ name: 'Петрова Мария', role: { name: '  распределитель ' } });
    expect(row).toMatchObject({ role: 'Распределитель', role_kind: 'distributor' });
    expect((await db.query("SELECT 1 FROM team_roles WHERE lower(name) = 'распределитель'")).rowCount).toBe(1);
  });

  test('незнакомое название заводит новую роль, смысл угадывается по словам, как раньше', async () => {
    expect(await repo.create({ name: 'А', role: { name: 'Молодёжный координатор' } })).toMatchObject({ role: 'Молодёжный координатор', role_kind: 'coordinator' });
    expect(await repo.create({ name: 'Б', role: { name: 'Пастор' } })).toMatchObject({ role: 'Пастор', role_kind: null });
  });

  test('переименование роли в справочнике сразу видно у всех, у кого она стоит', async () => {
    const a = await repo.create({ name: 'А', role: { name: 'Координатор малых групп' } });
    await repo.create({ name: 'Б', role: { name: 'Координатор малых групп' } });
    await db.query("UPDATE team_roles SET name = 'Координатор МГ' WHERE id = $1", [a.role_id]);
    expect((await repo.listActive()).map((r) => r.role)).toEqual(['Координатор МГ', 'Координатор МГ']);
  });
});
