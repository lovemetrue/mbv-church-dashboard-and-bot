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
    const row = await repo.create({ name: 'Петрова Мария', roles: [{ name: 'Координатор' }] });
    expect(row).toMatchObject({ name: 'Петрова Мария', role: 'Координатор', source: 'ui' });
  });

  test('listActive отдаёт по роли и имени', async () => {
    await repo.create({ name: 'Иванов Иван', roles: [{ name: 'Распределитель' }] });
    await repo.create({ name: 'Петрова Мария', roles: [{ name: 'Координатор' }] });
    const rows = await repo.listActive();
    expect(rows.map((r) => r.name)).toEqual(['Петрова Мария', 'Иванов Иван']);
  });

  test('убранный участник в список не попадает, но остаётся в базе', async () => {
    const row = await repo.create({ name: 'Ошибочная Запись', roles: [{ name: 'Координатор' }] });
    expect(await repo.archive(row.id)).toBe(true);
    expect(await repo.listActive()).toEqual([]);

    const { rows } = await db.query('SELECT archived_at FROM coordinators WHERE id = $1', [row.id]);
    expect(rows[0]!.archived_at).not.toBeNull();
  });

  test('повторное удаление отвечает false, а не молчаливым успехом', async () => {
    const row = await repo.create({ name: 'Петрова Мария', roles: [{ name: 'Координатор' }] });
    await repo.archive(row.id);
    expect(await repo.archive(row.id)).toBe(false);
  });
});

describe('правка участников', () => {
  test('правка меняет имя и роль', async () => {
    const row = await repo.create({ name: 'Петрова Мария', roles: [{ name: 'Координатор' }] });
    const updated = await repo.update(row.id, { name: 'Петрова Мария Ивановна', roles: [{ name: 'Старший координатор' }] });
    expect(updated).toMatchObject({ name: 'Петрова Мария Ивановна', role: 'Старший координатор', role_kinds: ['senior'] });
  });

  test('правка строки из выгрузки берёт её под управление дашборда', async () => {
    const { rows } = await db.query(
      `INSERT INTO coordinators (name, source) VALUES ('Из Выгрузки', 'таблица') RETURNING id`,
    );
    const updated = await repo.update(rows[0]!.id, { name: 'Исправлено', roles: [{ name: 'Координатор' }] });
    expect(updated).toMatchObject({ name: 'Исправлено', source: 'ui' });
  });

  test('правка того, чего нет, возвращает пустоту', async () => {
    expect(await repo.update(999999, { name: 'Кто-то', roles: [{ name: 'Координатор' }] })).toBeNull();
  });

  test('правка убранной записи не поднимает её обратно', async () => {
    const row = await repo.create({ name: 'Петрова Мария', roles: [{ name: 'Координатор' }] });
    await repo.archive(row.id);
    expect(await repo.update(row.id, { name: 'Возвращённая', roles: [{ name: 'Координатор' }] })).toBeNull();
  });
});

describe('роли — ссылки на справочник ролей', () => {
  const roleId = async (name: string) => (await db.query<{ id: number }>('SELECT id::int AS id FROM team_roles WHERE name = $1', [name])).rows[0]!.id;

  test('роль из списка ставится по id и приходит с названием и смыслом', async () => {
    const id = await roleId('Распределитель');
    const row = await repo.create({ name: 'Родионов Давид', roles: [{ id }] });
    expect(row).toMatchObject({ role: 'Распределитель', role_ids: [id], role_kinds: ['distributor'] });
  });

  test('у человека несколько ролей: названия через запятую по алфавиту, смыслы без повторов', async () => {
    const ids = await Promise.all(['Распределитель', 'Координатор', 'Катализатор'].map(roleId));
    const row = await repo.create({ name: 'Родионов Давид', roles: [...ids.map((id) => ({ id })), { id: ids[0]! }] });
    expect(row).toMatchObject({
      role: 'Катализатор, Координатор, Распределитель',
      role_ids: [ids[2], ids[1], ids[0]],
      role_kinds: ['catalyst', 'coordinator', 'distributor'],
    });
  });

  test('правка заменяет роли целиком', async () => {
    const row = await repo.create({ name: 'А', roles: [{ name: 'Распределитель' }, { name: 'Катализатор' }] });
    const updated = await repo.update(row.id, { name: 'А', roles: [{ name: 'Старший координатор' }] });
    expect(updated).toMatchObject({ role: 'Старший координатор', role_kinds: ['senior'] });
    expect((await db.query('SELECT 1 FROM coordinator_roles WHERE coordinator_id = $1', [row.id])).rowCount).toBe(1);
  });

  test('роль словами (старый дашборд, таблица церкви) находит существующую без учёта регистра и пробелов', async () => {
    const row = await repo.create({ name: 'Петрова Мария', roles: [{ name: '  распределитель ' }] });
    expect(row).toMatchObject({ role: 'Распределитель', role_kinds: ['distributor'] });
    expect((await db.query("SELECT 1 FROM team_roles WHERE lower(name) = 'распределитель'")).rowCount).toBe(1);
  });

  test('незнакомое название новой роли не заводит, а ложится на одну из пяти по словам', async () => {
    expect(await repo.create({ name: 'А', roles: [{ name: 'Молодёжный координатор' }] })).toMatchObject({ role: 'Координатор', role_kinds: ['coordinator'] });
    expect(await repo.create({ name: 'Б', roles: [{ name: 'Пастор' }] })).toMatchObject({ role: 'Координатор', role_kinds: ['coordinator'] });
    expect((await db.query('SELECT 1 FROM team_roles')).rowCount).toBe(5);
  });

  test('«Катализатор» есть в справочнике сразу, со своим смыслом', async () => {
    expect((await db.query("SELECT kind FROM team_roles WHERE name = 'Катализатор'")).rows).toEqual([{ kind: 'catalyst' }]);
  });

  test('переименование роли в справочнике сразу видно у всех, у кого она стоит', async () => {
    const a = await repo.create({ name: 'А', roles: [{ name: 'Координатор' }] });
    await repo.create({ name: 'Б', roles: [{ name: 'Координатор' }] });
    await db.query("UPDATE team_roles SET name = 'Координатор МГ' WHERE id = $1", [a.role_ids[0]]);
    expect((await repo.listActive()).map((r) => r.role)).toEqual(['Координатор МГ', 'Координатор МГ']);
  });
});
