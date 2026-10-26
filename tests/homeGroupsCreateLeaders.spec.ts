import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { GroupDirectionsRepo } from '../src/db/repos/groupDirections.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { MembersRepo } from '../src/db/repos/members.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { createRecordCreator } from '../src/home-groups/create.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/** Ведущий и соведущий новой группы — люди из «Людей»: свободный ввод имени только здесь, и он заводит карточку. */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const creator = () => createRecordCreator({
  requests: new RequestsRepo(db), groups: new GroupsRepo(db), persons: new MembersRepo(db), directions: new GroupDirectionsRepo(db), audit: new AuditRepo(db),
});
const base = { district: 'Приморский', direction: 'Основное служение', status: 'Функционирует' };
const links = async (id: number) =>
  (await db.query(
    `SELECT leader_user_id::int AS lu, leader_person_id::int AS lp, co_leader_user_id::int AS cu, co_leader_person_id::int AS cp FROM groups WHERE id = $1`, [id],
  )).rows[0];

describe('создание группы: ведущий и соведущий сразу в «Людях»', () => {
  test('вписанные от руки ведущий и соведущий получают карточки с ФИО и телефоном, группа на них ссылается', async () => {
    const out = await creator().group({ fields: { ...base, leader: 'Новиков Владимир', phone: '8 921 575-49-70', coLeader: 'Новикова Тамара', coLeaderPhone: '+7 921 000 11 22' } }, 'a');
    if (!out.ok) throw new Error(out.message);
    const l = await links(out.id);
    expect(l.lu).toBeNull();
    expect(l.cu).toBeNull();
    const card = async (id: number) => (await db.query('SELECT full_name, phone FROM persons WHERE id = $1', [id])).rows[0];
    expect(await card(l.lp)).toEqual({ full_name: 'Новиков Владимир', phone: '+79215754970' });
    expect(await card(l.cp)).toEqual({ full_name: 'Новикова Тамара', phone: '+79210001122' });
  });

  test('без соведущего карточка заводится только ведущему', async () => {
    const out = await creator().group({ fields: { ...base, leader: 'Новиков Владимир' } }, 'a');
    if (!out.ok) throw new Error(out.message);
    expect(await links(out.id)).toMatchObject({ cu: null, cp: null });
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(1);
  });

  test('ведущий, выбранный «из зарегистрированных», — ссылка на его регистрацию, лишней карточки нет', async () => {
    const u = await seedUser(db, { id: '601', fio: 'Ведущий Из Бота', mdgStatus: 'home' });
    const out = await creator().group({ fields: { ...base, leader: 'Ведущий Из Бота', leaderCandidate: String(u) } }, 'a');
    if (!out.ok) throw new Error(out.message);
    expect(await links(out.id)).toMatchObject({ lu: u, lp: null });
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });

  test('несуществующий «из зарегистрированных» — ведущий заводится карточкой по вписанному ФИО', async () => {
    const out = await creator().group({ fields: { ...base, leader: 'Кто-то', leaderCandidate: '99999' } }, 'a');
    if (!out.ok) throw new Error(out.message);
    expect(await links(out.id)).toMatchObject({ lu: null, lp: expect.any(Number) });
  });
});
