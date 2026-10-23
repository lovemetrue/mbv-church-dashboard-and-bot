import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
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
    `INSERT INTO groups (leader, district, direction_id, status, people, age, day, "time", source)
     VALUES ('Иван Секретов', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 3, '25-40', 'Пн', '19:00', 'ui') RETURNING id`,
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
    expect(before.assistant).toMatchObject({ available: true, enabled: true, pending: 1 });
    expect(before.items.find((i) => i.id === r)!.proposal).toBeNull();

    expect(await svc.assistant.run('boss')).toEqual({ ok: true, asked: 1, filled: 1, withQuestions: 1, proposals: 1, unanswered: 0 });

    const after = (await svc.views()).requests;
    const item = after.items.find((i) => i.id === r)!;
    expect(item.district).toBe('Приморский');
    expect(item.assistant).toEqual({ filled: ['район'], questions: ['В какие вечера вам удобно?'], note: null });
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
    // Возраст скрипт понял сам, поэтому текстом он не уходит: модели достаётся только непонятое место и отметка, что возраст известен.
    expect(JSON.parse(llm.calls[0]!.user)).toMatchObject({
      items: [{ ref: 'r1', age: null, needs: { district: true, age: false, time: false }, script: { district: null, ageKnown: true, days: [], avoidDays: [] } }],
    });
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
    expect(JSON.parse(e.after)).toEqual({ ok: true, asked: 1, filled: 1, withQuestions: 1, proposals: 1, unanswered: 0, model: 'fake-model' });
    expect(JSON.stringify((await db.query('SELECT * FROM audit_log')).rows)).not.toMatch(/дуба|Мария|911/);
  });

  test('сбой сервиса модели не роняет сервис: понятная ошибка, ошибка записана в журнал ошибок без данных людей', async () => {
    await seedGroup();
    await seedRequest();
    const svc = compose(new FakeLlm(() => new LlmError('network', 'Нет связи с сервисом помощника.')));
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toEqual({ ok: false, error: 'unavailable', message: 'Нет связи с сервисом помощника.' });
    // Ошибка пишется в фоне, без ожидания ответа: на медленной машине 50 мс не хватало, поэтому ждём саму запись, а не время.
    await vi.waitFor(async () => expect((await db.query('SELECT 1 FROM system_errors')).rowCount).toBeGreaterThan(0), { timeout: 3000, interval: 25 });
    const rows = (await db.query('SELECT service, message FROM system_errors')).rows;
    expect(JSON.stringify(rows)).not.toMatch(/дуба|Мария|911/);
  });

  test('одновременно идёт только один разбор', async () => {
    await seedGroup();
    await seedRequest();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const llm: LlmClient = { model: 'm', async complete(req) { await gate; return { text: answerAll(null)(req) }; } };
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

  test('ответ не в том виде: разбор не записан, заявки остаются в очереди, служитель получает объяснение', async () => {
    await seedGroup();
    const r = await seedRequest();
    const llm = new FakeLlm(() => 'Извините, я не могу помочь.');
    const svc = compose(llm);
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: false, error: 'unavailable', message: expect.stringContaining('не в том виде') });
    expect((await db.query('SELECT 1 FROM request_hints')).rowCount).toBe(0);
    const view = (await svc.views()).requests.assistant;
    expect(view.pending).toBe(1);
    expect(view.review).toEqual([expect.objectContaining({ requestId: r, state: 'new' })]);
  });

  test('пропущенную моделью заявку не считают разобранной: она остаётся в очереди, а итог говорит, сколько таких', async () => {
    await seedGroup();
    const first = await seedRequest({ place: 'у большого дуба' });
    const second = await seedRequest({ place: 'у старой мельницы' });
    // Модель ответила только про первую запись.
    const svc = compose(new FakeLlm(() => JSON.stringify({ items: [{ ref: 'r1', district: null, comment: 'Ни района, ни метро в записи нет.' }] })));
    await svc.assistant.setEnabled(true, 'boss');
    expect(await svc.assistant.run('boss')).toMatchObject({ ok: true, asked: 2, unanswered: 1 });
    const review = (await svc.views()).requests.assistant.review;
    // Разобранная (ждёт служителя) стоит первой, неразобранная — за ней; какая из двух попала в r1, решает порядок очереди.
    expect(review.map((i) => i.state)).toEqual(['reviewed', 'new']);
    expect(review.map((i) => i.requestId).sort()).toEqual([first, second].sort());
  });
});

describe('окно «ИИ-разбор»: что помощник понял, чего нет и почему', () => {
  test('разобранная заявка с пробелами показывает, чего не хватает, пояснение, вопросы и слова человека', async () => {
    await seedGroup();
    const r = await seedRequest({ fio: 'Мария Тайная', place: 'рядом с работой', age: '30' });
    const svc = compose(new FakeLlm((req) => {
      const items = (JSON.parse(req.user) as { items: { ref: string }[] }).items;
      return JSON.stringify({ items: items.map((i) => ({
        ref: i.ref, district: null, questions: ['В каком районе вам удобнее встречаться?'], comment: 'В записи «рядом с работой» нет ни района, ни метро.',
      })) });
    }));
    await svc.assistant.setEnabled(true, 'boss');
    expect((await svc.views()).requests.assistant.review).toEqual([{
      requestId: r, fio: 'Мария Тайная', state: 'new', missing: ['район'], filled: [], questions: [], note: null,
      place: 'рядом с работой', age: '30', schedule: null,
    }]);
    await svc.assistant.run('boss');
    const after = (await svc.views()).requests;
    expect(after.assistant.review).toEqual([{
      requestId: r, fio: 'Мария Тайная', state: 'reviewed', missing: ['район'], filled: [],
      questions: ['В каком районе вам удобнее встречаться?'], note: 'В записи «рядом с работой» нет ни района, ни метро.',
      place: 'рядом с работой', age: '30', schedule: null,
    }]);
    // То же пояснение видно в карточке заявки.
    expect(after.items.find((i) => i.id === r)!.assistant).toMatchObject({ note: 'В записи «рядом с работой» нет ни района, ни метро.' });
  });

  test('служитель вписал район в заявку — заявка уходит из окна, и подбор находит ей группу', async () => {
    const g = await seedGroup();
    const r = await seedRequest({ place: 'рядом с работой' });
    const svc = compose(new FakeLlm(answerAll(null)));
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    expect((await svc.views()).requests.assistant.review).toHaveLength(1);
    // Так пишет окно помощника: район спереди, слова человека сохраняются в скобках.
    expect(await svc.placement.editRequest(r, { place: 'Приморский (рядом с работой)' }, 'boss')).toEqual({ ok: true });
    const after = (await svc.views()).requests;
    expect(after.assistant.review).toEqual([]);
    expect(after.items.find((i) => i.id === r)!.district).toBe('Приморский');
    expect(after.items.find((i) => i.id === r)!.proposal?.main.group.id).toBe(g);
  });

  test('когда помощник определил всё, заявка в окне не висит: проверять её — дело метки «Помощник» в списке', async () => {
    await seedGroup();
    await seedRequest();
    const svc = compose(new FakeLlm(answerAll('Приморский')));
    await svc.assistant.setEnabled(true, 'boss');
    await svc.assistant.run('boss');
    expect((await svc.views()).requests.assistant.review).toEqual([]);
  });
});
