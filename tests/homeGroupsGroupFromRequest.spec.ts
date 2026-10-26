import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { GroupDirectionsRepo } from '../src/db/repos/groupDirections.repo.js';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { MembersRepo } from '../src/db/repos/members.repo.js';
import { RequestsRepo } from '../src/db/repos/requests.repo.js';
import { composeViews, engine as realEngine } from '../src/home-groups/composition.js';
import { createRecordCreator } from '../src/home-groups/create.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

/**
 * «Создать группу по заявке»: человек сказал «уже веду группу», а потом решил открыть свою. Черновик формы считается из
 * заявки настоящим разбором подбора, группа связывается с заявкой и с регистрацией человека.
 */
let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const views = () => composeViews(db, realEngine, { defaultCapacity: 10, ttlMs: 0, timeZone: 'Europe/Moscow' })();
const creator = () => createRecordCreator({ requests: new RequestsRepo(db), groups: new GroupsRepo(db), persons: new MembersRepo(db), directions: new GroupDirectionsRepo(db), audit: new AuditRepo(db) });

async function leaderRequest(): Promise<{ requestId: number; userId: number }> {
  const userId = await seedUser(db, { id: '501', fio: 'Пётр Ведущий', phone: '+79215550011' });
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (user_id, type, status, fio, phone, age, place, manual_street, manual_schedule, origin)
     VALUES ($1, 'already_leader', 'Новая', 'Пётр Ведущий', '+79215550011', '25-40', 'Приморский, м. Беговая', 'Савушкина 5', 'среда вечером', 'бот')
     RETURNING id::int AS id`,
    [userId],
  );
  return { requestId: rows[0]!.id, userId };
}

describe('черновик группы по заявке', () => {
  test('ведущий — человек из заявки; район, возраст, улица и день — как понял подбор; остальное — в комментарии', async () => {
    const { requestId } = await leaderRequest();
    const draft = (await views()).groupDrafts.get(requestId);
    expect(draft).toEqual({
      requestId,
      fio: 'Пётр Ведущий',
      ownGroup: null,
      fields: {
        leader: 'Пётр Ведущий',
        phone: '+79215550011',
        status: 'Потенциальная',
        district: 'Приморский',
        age: '25-40',
        address: 'Савушкина 5',
        day: 'Ср',
        comment: `Заведена по заявке №${requestId} («Уже ведёт группу»). Место: Приморский, м. Беговая. Удобное время: среда вечером.`,
      },
    });
  });

  test('чего по заявке не понять, того в черновике нет: форма оставит поле пустым', async () => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO requests (type, status, fio, place, manual_schedule, origin)
       VALUES ('join_group', 'Новая', 'Анна', 'где-то', 'пн или ср', 'ui') RETURNING id::int AS id`,
    );
    const draft = (await views()).groupDrafts.get(rows[0]!.id)!;
    // Направления в черновике нет: форма ставит первое из справочника (основное), как у любой новой группы.
    expect(Object.keys(draft.fields).sort()).toEqual(['comment', 'leader', 'status']);
  });
});

describe('создание группы по заявке', () => {
  test('группа связана с заявкой и с регистрацией ведущего; заявка видит свою группу; в ленте заявки — запись', async () => {
    const { requestId, userId } = await leaderRequest();
    const draft = (await views()).groupDrafts.get(requestId)!;
    const out = await creator().group({ fields: { ...draft.fields, direction: 'Основное служение', sourceRequestId: String(requestId) } }, 'p_ivanova');
    if (!out.ok) throw new Error(out.message);
    const { rows } = await db.query('SELECT leader, status, district, source_request_id::int AS req, leader_user_id::int AS leader_user FROM groups WHERE id = $1', [out.id]);
    expect(rows[0]).toEqual({ leader: 'Пётр Ведущий', status: 'Потенциальная', district: 'Приморский', req: requestId, leader_user: userId });
    // Ведущий уже связан с регистрацией из заявки: отдельной карточки в «Людях» ему не заводится.
    expect((await db.query('SELECT 1 FROM persons')).rowCount).toBe(0);

    const after = await views();
    expect(after.groupDrafts.get(requestId)!.ownGroup).toEqual({ id: out.id, code: expect.stringMatching(/^ДГ-/) });
    const other = after.requests.others.find((o) => o.id === requestId)!;
    expect(other.ownGroup).toEqual({ id: out.id, code: expect.stringMatching(/^ДГ-/) });
    expect(other.log.map((l) => l.text)).toContainEqual(expect.stringMatching(/^По заявке заведена группа ДГ-\d+ · p_ivanova$/));
  });

  test('вторую группу по той же заявке не завести; после удаления первой — можно', async () => {
    const { requestId } = await leaderRequest();
    const fields = { leader: 'Пётр', district: 'Приморский', direction: 'Основное служение', status: 'Потенциальная', sourceRequestId: String(requestId) };
    const first = await creator().group({ fields }, 'a');
    if (!first.ok) throw new Error(first.message);
    expect(await creator().group({ fields }, 'a')).toMatchObject({ ok: false, error: 'conflict', message: expect.stringMatching(/уже заведена: ДГ-/) });
    expect((await db.query('SELECT 1 FROM groups')).rowCount).toBe(1);
    await new GroupsRepo(db).archive(first.id);
    expect(await creator().group({ fields }, 'a')).toMatchObject({ ok: true });
  });

  test('заявки нет — отказ, группа не заводится; кривой номер — отказ', async () => {
    const fields = { leader: 'Пётр', district: 'Приморский', direction: 'Основное служение', status: 'Потенциальная' };
    expect(await creator().group({ fields: { ...fields, sourceRequestId: '999' } }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await creator().group({ fields: { ...fields, sourceRequestId: 'abc' } }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    expect((await db.query('SELECT 1 FROM groups')).rowCount).toBe(0);
  });

  test('без заявки группа заводится как раньше, без связи', async () => {
    const out = await creator().group({ fields: { leader: 'Пётр', district: 'Приморский', direction: 'Основное служение', status: 'Функционирует' } }, 'a');
    if (!out.ok) throw new Error(out.message);
    expect((await db.query('SELECT source_request_id FROM groups WHERE id = $1', [out.id])).rows[0]).toEqual({ source_request_id: null });
  });
});
