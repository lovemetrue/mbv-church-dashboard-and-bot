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

  test('ведущий, выбранный из «Людей» (регистрация), — ссылка на него, имя группы из анкеты, лишней карточки нет', async () => {
    const u = await seedUser(db, { id: '601', fio: 'Ведущий Из Бота', mdgStatus: 'join' });
    const out = await creator().group({ fields: { ...base, leaderKey: `u${u}` } }, 'a');
    if (!out.ok) throw new Error(out.message);
    expect(await links(out.id)).toMatchObject({ lu: u, lp: null });
    expect((await db.query('SELECT leader FROM groups WHERE id = $1', [out.id])).rows[0].leader).toBe('Ведущий Из Бота');
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);
  });

  test('один человек ведёт вторую группу: обе группы ссылаются на одну карточку, вписанное ФИО не мешает', async () => {
    const first = await creator().group({ fields: { ...base, leader: 'Новиков Владимир', phone: '+79215754970' } }, 'a');
    if (!first.ok) throw new Error(first.message);
    const { lp } = await links(first.id);
    const second = await creator().group({ fields: { ...base, leaderKey: `p${lp}`, leader: 'опечатка' } }, 'a');
    if (!second.ok) throw new Error(second.message);
    expect(await links(second.id)).toMatchObject({ lu: null, lp });
    // Телефон — из карточки: по нему бот узнаёт ведущего («уже ведёт группу»), и обе группы на нём.
    expect((await db.query('SELECT leader, phones FROM groups WHERE id = $1', [second.id])).rows[0]).toEqual({ leader: 'Новиков Владимир', phones: ['+79215754970'] });
    expect(await new GroupsRepo(db).activeLeaderByPhone('+79215754970')).toBe(true);
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(1);
  });

  test('ведущий из заявки без регистрации («r») — ссылка на человека этой заявки', async () => {
    const r = (await db.query<{ id: number }>(`INSERT INTO requests (type, status, fio, phone, origin) VALUES ('lead_group', 'Новая', 'Мария Заявкина', '+79110002233', 'ui') RETURNING id::int AS id`)).rows[0]!.id;
    const out = await creator().group({ fields: { ...base, leaderKey: `r${r}` } }, 'a');
    if (!out.ok) throw new Error(out.message);
    const l = await links(out.id);
    const linked = (await db.query('SELECT user_id::int AS u, person_id::int AS p FROM requests WHERE id = $1', [r])).rows[0];
    expect({ lu: l.lu, lp: l.lp }).toEqual({ lu: linked.u, lp: linked.p });
    expect((await db.query('SELECT leader FROM groups WHERE id = $1', [out.id])).rows[0].leader).toBe('Мария Заявкина');
  });

  test('несуществующий или кривой ключ ведущего — отказ, группа не заводится', async () => {
    expect(await creator().group({ fields: { ...base, leaderKey: 'p99999' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await creator().group({ fields: { ...base, leaderKey: '601' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT 1 FROM groups')).rowCount).toBe(0);
  });
});
