import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService, engine } from '../src/home-groups/composition.js';
import { LlmError, type LlmClient, type LlmRequest } from '../src/platform/llm/deepseek.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

class FakeLlm implements LlmClient {
  readonly model = 'fake-model';
  calls: LlmRequest[] = [];
  constructor(private readonly answer: (req: LlmRequest) => string | Error) {}
  async complete(req: LlmRequest) {
    this.calls.push(req);
    const a = this.answer(req);
    if (a instanceof Error) throw a;
    return { text: a };
  }
}

const compose = (llm: LlmClient | null) => composeService(db, engine, { defaultCapacity: 10, ttlMs: 0, llm });

async function seedGroup(): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO groups (leader, district, format, status, people, age, day, "time", source)
     VALUES ('Иван Секретов', 'Приморский', 'Основная церковь', 'Функционирует', 3, '25-40', 'Пн', '19:00', 'ui') RETURNING id`,
  );
  return rows[0]!.id;
}
async function seedRequest(over: { place?: string | null; age?: string | null; fio?: string; phone?: string } = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (type, status, fio, phone, place, age, origin) VALUES ('join_group', 'Новая', $1, $2, $3, $4, 'ui') RETURNING id`,
    [over.fio ?? 'Мария Тайная', over.phone ?? '+79110001122', over.place === undefined ? 'недалеко от большого дуба' : over.place, over.age === undefined ? '30' : over.age],
  );
  return rows[0]!.id;
}
const answerAll = (district: string | null) => (req: LlmRequest) => {
  const items = (JSON.parse(req.user) as { items: { ref: string }[] }).items;
  return JSON.stringify({ items: items.map((i) => ({ ref: i.ref, district, age: null, days: [], slot: null, questions: ['В какие вечера вам удобно?'] })) });
};

describe('помощник: разбор непонятных заявок', () => {
  test('без ключа и при выключенном переключателе запуск отказывает понятным текстом и ничего не отправляет', async () => {
    await seedRequest();
    expect(await compose(null).assistant.run('boss')).toMatchObject({ ok: false, error: 'unavailable' });
    const llm = new FakeLlm(answerAll('Приморский'));
    const svc = compose(llm);
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: false, error: 'unavailable', message: expect.stringContaining('выключен') });
    expect(llm.calls).toHaveLength(0);
  });

  test('разбор определяет район, обычный подбор находит группу, а число и вопросы попадают в представления', async () => {
    const g = await seedGroup();
    const r = await seedRequest();
    const llm = new FakeLlm(answerAll('Приморский'));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');

    const before = (await svc.views()).requests;
    expect(before.assistant).toEqual({ available: true, enabled: true, pending: 1 });
    expect(before.items.find((i) => i.id === r)!.proposal).toBeNull();

    expect(await svc.assistant.run('boss')).toEqual({ ok: true, asked: 1, filled: 1, withQuestions: 1, proposals: 1 });

    const after = (await svc.views()).requests;
    const item = after.items.find((i) => i.id === r)!;
    expect(item.district).toBe('Приморский');
    expect(item.assistant).toEqual({ filled: ['район'], questions: ['В какие вечера вам удобно?'] });
    expect(item.proposal?.main.group.id).toBe(g);
    expect(after.assistant.pending).toBe(0);
  });

  test('к модели уходят только место, возраст и время: ни имён, ни телефонов, ни данных групп', async () => {
    await seedGroup();
    await seedRequest({ place: 'у большого дуба, звоните 8 911 000-11-22', fio: 'Мария Тайная' });
    const llm = new FakeLlm(answerAll(null));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    const sent = JSON.stringify(llm.calls);
    expect(sent).not.toMatch(/Мария|Тайная|911|79110001122|Секретов|Иван/);
    expect(sent).toContain('большого дуба');
    expect(JSON.parse(llm.calls[0]!.user)).toMatchObject({ items: [{ ref: 'r1', age: '30' }] });
  });

  test('выдуманный моделью район отбрасывается: подбор не меняется, но разбор записан, и повторно заявку не спрашивают', async () => {
    await seedGroup();
    await seedRequest();
    const llm = new FakeLlm(answerAll('Лунный'));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: true, asked: 1, filled: 0 });
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: true, asked: 0 });
    expect(llm.calls).toHaveLength(1);
  });

  test('если запись изменили после разбора, помощник спросит про неё снова', async () => {
    await seedGroup();
    const r = await seedRequest();
    const llm = new FakeLlm(answerAll(null));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    await db.query(`UPDATE requests SET place = 'совсем другое непонятное место' WHERE id = $1`, [r]);
    expect((await svc.views()).requests.assistant.pending).toBe(1);
  });

  test('помощник не трогает заявку и не утверждает: заявка остаётся «Новой», а в журнале только числа и модель', async () => {
    await seedGroup();
    const r = await seedRequest();
    const svc = compose(new FakeLlm(answerAll('Приморский')));
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    expect((await db.query('SELECT status, group_id FROM requests WHERE id = $1', [r])).rows[0]).toEqual({ status: 'Новая', group_id: null });
    const [e] = (await db.query(`SELECT actor, action, after::text AS after FROM audit_log WHERE action = 'assistant.run'`)).rows;
    expect(e).toMatchObject({ actor: 'boss' });
    expect(JSON.parse(e.after)).toEqual({ ok: true, asked: 1, filled: 1, withQuestions: 1, proposals: 1, model: 'fake-model' });
    expect(JSON.stringify((await db.query('SELECT * FROM audit_log')).rows)).not.toMatch(/дуба|Мария|911/);
  });

  test('сбой сервиса модели не роняет сервис: понятная ошибка, ошибка записана в журнал ошибок без данных людей', async () => {
    await seedGroup();
    await seedRequest();
    const svc = compose(new FakeLlm(() => new LlmError('network', 'Нет связи с сервисом помощника.')));
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toEqual({ ok: false, error: 'unavailable', message: 'Нет связи с сервисом помощника.' });
    await new Promise((r) => setTimeout(r, 50));
    const rows = (await db.query('SELECT service, message FROM system_errors')).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/дуба|Мария|911/);
  });

  test('одновременно идёт только один разбор', async () => {
    await seedGroup();
    await seedRequest();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const llm: LlmClient = { model: 'm', async complete() { await gate; return { text: '{"items":[]}' }; } };
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    const first = svc.assistant.run('a');
    await new Promise((r) => setTimeout(r, 30));
    expect(await svc.assistant.run('b')).toMatchObject({ ok: false, error: 'conflict' });
    release();
    expect(await first).toMatchObject({ ok: true });
  });

  test('за один запуск спрашивают не больше сорока заявок, по двадцать в запросе', async () => {
    await seedGroup();
    for (let i = 0; i < 45; i++) await seedRequest({ place: `непонятное место ${i}` });
    const llm = new FakeLlm(answerAll(null));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: true, asked: 40 });
    expect(llm.calls.map((c) => (JSON.parse(c.user) as { items: unknown[] }).items.length)).toEqual([20, 20]);
  });

  test('заявки без текста (нечего разбирать) помощнику не отправляются', async () => {
    await seedGroup();
    await seedRequest({ place: null, age: null });
    const llm = new FakeLlm(answerAll(null));
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: true, asked: 0 });
    expect(llm.calls).toHaveLength(0);
  });

  test('переключатель и последний запуск показываются в настройках', async () => {
    await seedGroup();
    await seedRequest();
    const svc = compose(new FakeLlm(answerAll('Приморский')));
    expect(await svc.assistant.view()).toMatchObject({ available: true, enabled: false, model: 'fake-model', lastRun: null });
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    expect(await svc.assistant.view()).toMatchObject({ enabled: true, lastRun: { actor: 'boss', asked: 1, filled: 1, withQuestions: 1, proposals: 1 } });
  });
});
