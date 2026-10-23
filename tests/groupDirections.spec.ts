import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { GroupDirectionsRepo } from '../src/db/repos/groupDirections.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { createGroupDirections } from '../src/home-groups/groupDirections.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const directions = () => createGroupDirections({ repo: new GroupDirectionsRepo(db), audit: new AuditRepo(db) });
const group = (direction: string) =>
  new GroupsRepo(db).create({ leader: 'Иван', district: 'Приморский', direction, status: 'Функционирует' }, 'ui');

describe('«Настройки → Направления»', () => {
  test('четыре направления на месте, по порядку; у каждого — сколько групп', async () => {
    await group('Молодёжное служение');
    await group('Молодёжное служение');
    expect((await directions().view()).items).toEqual([
      { id: expect.any(Number), name: 'Основное служение', groups: 0 },
      { id: expect.any(Number), name: 'Подростковое служение', groups: 0 },
      { id: expect.any(Number), name: 'Молодёжное служение', groups: 2 },
      { id: expect.any(Number), name: 'Филиал «Серебристый»', groups: 0 },
    ]);
  });

  test('новый филиал встаёт в конец; повтор названия без учёта регистра — отказ', async () => {
    expect(await directions().create({ name: '  Филиал   «Север» ' }, 'boss')).toMatchObject({ ok: true });
    expect((await directions().view()).items.at(-1)).toMatchObject({ name: 'Филиал «Север»' });
    expect(await directions().create({ name: 'филиал «север»' }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await directions().create({ name: ' ' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
  });

  test('переименование сразу видно у групп; направление с группами не удалить, без групп — можно', async () => {
    const g = await group('Филиал «Серебристый»');
    const [, , , branch] = (await directions().view()).items;
    expect(await directions().update({ id: branch!.id, name: 'Филиал «Серебристый бор»' }, 'boss')).toEqual({ ok: true });
    expect((await new GroupsRepo(db).findActive(g.id))!.direction).toBe('Филиал «Серебристый бор»');
    expect(await directions().delete({ id: branch!.id }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    // Удалённая группа тоже держит направление: её строка остаётся в базе со ссылкой.
    await new GroupsRepo(db).archive(g.id);
    expect(await directions().delete({ id: branch!.id }, 'boss')).toMatchObject({ ok: false, error: 'conflict' });
    const teen = (await directions().view()).items[1]!;
    expect(await directions().delete({ id: teen.id }, 'boss')).toEqual({ ok: true });
  });

  test('слова старого дашборда и таблицы церкви ложатся на направления; незнакомое — на основное', async () => {
    expect((await group('Молодежная')).direction).toBe('Молодёжное служение');
    expect((await group('Основная церковь')).direction).toBe('Основное служение');
    expect((await group('что-то своё')).direction).toBe('Основное служение');
    expect((await group('подростковое служение')).direction).toBe('Подростковое служение');
  });
});
