import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { composeService, engine } from '../src/home-groups/composition.js';
import { LlmError, type ChatMessage, type ChatRequest, type ChatResponse, type LlmClient } from '../src/platform/llm/deepseek.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

type Script = (req: ChatRequest, n: number) => ChatResponse | Error;
class FakeChatLlm implements LlmClient {
  readonly model = 'fake';
  calls: ChatMessage[][] = [];
  constructor(private readonly script: Script) {}
  async complete(): Promise<never> { throw new Error('не используется'); }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req.messages.map((m) => ({ ...m })));
    const r = this.script(req, this.calls.length);
    if (r instanceof Error) throw r;
    return r;
  }
}
const ask = (sql: string, id = 'c1'): ChatResponse => ({ content: null, toolCalls: [{ id, name: 'query', arguments: JSON.stringify({ sql }) }] });
const tool = (name: string, args: object, id = 't1'): ChatResponse => ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const say = (content: string): ChatResponse => ({ content, toolCalls: [] });
const turn = (content: string) => ({ messages: [{ role: 'user', content }] });

const compose = (llm: LlmClient | null) => composeService(db, engine, { defaultCapacity: 10, ttlMs: 0, llm });
async function enabled(llm: LlmClient | null) {
  const svc = compose(llm);
  await svc.assistant.setEnabled(true, 'boss');
  return svc;
}
async function seed() {
  await db.query(`INSERT INTO groups (leader, phone, district, direction_id, status, people, source) VALUES
    ('Иван Петров', '+79110001122', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 14, 'ui'),
    ('Иван Петров', '+79110001122', 'Невский', group_direction_id('Основная церковь'), 'Функционирует', 5, 'ui'),
    ('Пётр Сидоров', '+79215550011', 'Приморский', group_direction_id('Основная церковь'), 'Функционирует', 11, 'ui')`);
  await db.query(`INSERT INTO users (platform, platform_user_id, chat_id, full_name, phone, registration_no, registered_at, complete)
    VALUES ('telegram', 'u1', '', 'Мария Секретная', '+79990001122', nextval('registration_no_seq'), now(), true)`);
}
const leaderRef = async () => (await db.query<{ r: string }>(`SELECT assistant.name_ref('Ведущий', 'Иван Петров') AS r`)).rows[0]!.r;

describe('чат помощника: вопросы по базе', () => {
  test('без ключа и при выключенном помощнике чат отказывает и ничего не отправляет', async () => {
    expect(await compose(null).chat.ask(turn('привет'), 'a')).toMatchObject({ ok: false, error: 'unavailable' });
    const llm = new FakeChatLlm(() => say('ответ'));
    expect(await compose(llm).chat.ask(turn('привет'), 'a')).toMatchObject({ ok: false, error: 'unavailable', message: expect.stringContaining('выключен') });
    expect(llm.calls).toHaveLength(0);
  });

  test('модель просит запрос, сервис выполняет его от роли для чтения, ответ и таблица возвращаются с настоящими именами', async () => {
    await seed();
    const ref = await leaderRef();
    const llm = new FakeChatLlm((_r, n) => n === 1
      ? ask('SELECT code, leader, people FROM groups WHERE people > 10 ORDER BY people DESC')
      : say(`Перебор в двух группах, ведёт ${ref}.`));
    const out = await (await enabled(llm)).chat.ask(turn('Где перебор групп?'), 'anna');
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) return;
    expect(out.answer).toBe('Перебор в двух группах, ведёт Иван Петров.');
    expect(out.queries).toEqual([{ sql: 'SELECT code, leader, people FROM groups WHERE people > 10 ORDER BY people DESC', ok: true, rows: 2 }]);
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0]!.columns).toEqual(['code', 'leader', 'people']);
    expect(out.tables[0]!.rows.map((r) => [r[1], r[2]])).toEqual([['Иван Петров', 14], ['Пётр Сидоров', 11]]);
  });

  test('ни имён, ни телефонов, ни заметок в то, что уходит модели, не попадает — ни в вопрос, ни в результаты запросов', async () => {
    await seed();
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('SELECT * FROM people') : n === 2 ? ask('SELECT * FROM groups', 'c2') : say('готово')));
    const out = await (await enabled(llm)).chat.ask(turn('Где состоит Мария Секретная и что с Иван Петров?'), 'anna');
    expect(out).toMatchObject({ ok: true });
    const sent = JSON.stringify(llm.calls);
    expect(sent).not.toMatch(/Мария|Секретная|Иван|Петров|Сидоров|911|921|999000/);
    expect(sent).toMatch(/Участник-\d+/);
    expect(sent).toMatch(/Ведущий-[0-9a-f]{6}/);
  });

  test('имя, случайно попавшее в свободный текст (адрес, удобное время), заменяется номером и в результатах запроса', async () => {
    await seed();
    await db.query(`UPDATE users SET address_raw = 'Мира 5, спросить Иван Петров', schedule_raw = 'вечером, звонить Мария Секретная'`);
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('SELECT address, schedule FROM people') : say('готово')));
    await (await enabled(llm)).chat.ask(turn('Покажи адреса'), 'anna');
    const toolResult = JSON.stringify(llm.calls[1]!.at(-1));
    expect(toolResult).toContain('Мира 5');
    expect(toolResult).not.toMatch(/Иван|Петров|Мария|Секретная/);
    expect(toolResult).toMatch(/Ведущий-[0-9a-f]{6}/);
  });

  test('имя из вопроса заменяется номером: модель спрашивает про номер, ответ возвращает имя', async () => {
    await seed();
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('SELECT person FROM people') : say('Участник-1 состоит в одной группе.')));
    const out = await (await enabled(llm)).chat.ask(turn('В каких группах Мария Секретная?'), 'anna');
    if (!out.ok) throw new Error('нет ответа');
    expect(out.answer).toBe('Мария Секретная состоит в одной группе.');
    const userMsg = llm.calls[0]!.find((m) => m.role === 'user')!;
    expect(userMsg).toMatchObject({ content: 'В каких группах Участник-1?' });
  });

  test('ошибку запроса модель получает текстом и может исправить; в списке запросов видно обе попытки', async () => {
    await seed();
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('SELECT nope FROM groups') : n === 2 ? ask('SELECT count(*) AS n FROM groups', 'c2') : say('Групп три.')));
    const out = await (await enabled(llm)).chat.ask(turn('Сколько групп?'), 'anna');
    if (!out.ok) throw new Error('нет ответа');
    expect(out.queries.map((q) => q.ok)).toEqual([false, true]);
    expect(out.queries[0]!.error).toMatch(/nope/);
    expect(llm.calls[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Ошибка запроса') });
    expect(out.tables).toHaveLength(1);
  });

  test('попытка записать или прочитать лишнее отклоняется, данные остаются на месте', async () => {
    await seed();
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('DELETE FROM groups') : n === 2 ? ask('SELECT * FROM public.users', 'c2') : say('Не получилось.')));
    const out = await (await enabled(llm)).chat.ask(turn('Удали все группы'), 'anna');
    if (!out.ok) throw new Error('нет ответа');
    expect(out.queries.every((q) => !q.ok)).toBe(true);
    expect(out.tables).toEqual([]);
    expect((await db.query('SELECT count(*)::int AS n FROM groups')).rows[0].n).toBe(3);
  });

  test('если модель крутится вокруг запросов бесконечно, чат останавливается понятным текстом', async () => {
    await seed();
    const llm = new FakeChatLlm(() => ask('SELECT 1'));
    expect(await (await enabled(llm)).chat.ask(turn('вопрос'), 'anna')).toMatchObject({ ok: false, error: 'unavailable', message: expect.stringContaining('Уточните вопрос') });
    expect(llm.calls.length).toBe(5);
  });

  test('сбой сервиса модели даёт понятную ошибку, а в журнал ошибок попадает без данных людей', async () => {
    await seed();
    const llm = new FakeChatLlm(() => new LlmError('network', 'Нет связи с сервисом помощника.'));
    expect(await (await enabled(llm)).chat.ask(turn('Мария Секретная?'), 'anna')).toEqual({ ok: false, error: 'unavailable', message: 'Нет связи с сервисом помощника.' });
    await new Promise((r) => setTimeout(r, 50));
    const log = JSON.stringify((await db.query('SELECT service, message, context FROM system_errors')).rows);
    expect(log).toContain('помощник');
    expect(log).not.toMatch(/Мария|Секретная/);
  });

  test.each([
    [null], [{}], [{ messages: [] }], [{ messages: 'привет' }], [{ messages: [{ role: 'system', content: 'x' }] }], [{ messages: [{ role: 'user', content: '' }] }],
    [{ messages: [{ role: 'user', content: 'я'.repeat(2001) }] }], [{ messages: [{ role: 'assistant', content: 'ответ' }] }],
    [{ messages: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })) }], [{ messages: [{ role: 'user' }] }],
  ])('неверное тело %j отклоняется до обращения к модели', async (body) => {
    const llm = new FakeChatLlm(() => say('ответ'));
    expect(await (await enabled(llm)).chat.ask(body, 'anna')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(llm.calls).toHaveLength(0);
  });

  test('больше двадцати вопросов за десять минут с одного входа не принимается, другой вход не страдает', async () => {
    const llm = new FakeChatLlm(() => say('ответ'));
    const svc = await enabled(llm);
    for (let i = 0; i < 20; i++) expect(await svc.chat.ask(turn('вопрос'), 'anna')).toMatchObject({ ok: true });
    expect(await svc.chat.ask(turn('вопрос'), 'anna')).toMatchObject({ ok: false, error: 'conflict' });
    expect(await svc.chat.ask(turn('вопрос'), 'boris')).toMatchObject({ ok: true });
  });

  test('история разговора передаётся модели, прежние ответы с именами тоже обезличиваются', async () => {
    await seed();
    const ref = await leaderRef();
    const llm = new FakeChatLlm(() => say('ок'));
    await (await enabled(llm)).chat.ask({ messages: [
      { role: 'user', content: 'Кто ведёт две группы?' }, { role: 'assistant', content: 'Иван Петров ведёт две группы.' }, { role: 'user', content: 'А сколько у него людей?' },
    ] }, 'anna');
    const sent = llm.calls[0]!.filter((m) => m.role !== 'system');
    expect(sent.map((m) => (m as { content: string }).content)).toEqual(['Кто ведёт две группы?', `${ref} ведёт две группы.`, 'А сколько у него людей?']);
  });

  test('в журнал идут только число запросов и строк: ни вопроса, ни ответа, ни имён', async () => {
    await seed();
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? ask('SELECT count(*) FROM people') : say('Мария Секретная одна.')));
    await (await enabled(llm)).chat.ask(turn('Сколько людей у Иван Петров?'), 'anna');
    const rows = (await db.query(`SELECT actor, action, after::text AS after FROM audit_log WHERE action = 'assistant.chat'`)).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].after)).toEqual({ queries: 1, rows: 1 });
    expect(JSON.stringify(rows)).not.toMatch(/Мария|Иван|Петров/);
  });

  test('системная инструкция описывает таблицы без имён и запрещает угадывать имена и менять данные', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    await (await enabled(llm)).chat.ask(turn('привет'), 'anna');
    const system = (llm.calls[0]![0] as { content: string }).content;
    expect(system).toMatch(/только читаете/);
    expect(system).toMatch(/настоящих имён у вас нет/);
    expect(system).toContain('COALESCE(capacity, 10)');
    expect(system).toContain('placements');
  });

  test('статус для кнопки: показывается, только когда есть ключ, помощник включён и в базе готова роль', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    expect(await compose(llm).assistant.status()).toEqual({ available: true, enabled: false, chat: false });
    expect(await compose(null).assistant.status()).toEqual({ available: false, enabled: false, chat: false });
    expect(await (await enabled(llm)).assistant.status()).toEqual({ available: true, enabled: true, chat: true });
  });
});

describe('чат помощника: история разговора на сервере', () => {
  const said = (m: ChatMessage[]) => m.filter((x) => x.role !== 'system').map((x) => (x as { content: string }).content);

  test('вопрос и ответ запоминаются, а следующий вопрос уходит модели вместе с прежними', async () => {
    const llm = new FakeChatLlm((_r, n) => say(`ответ ${n}`));
    const svc = await enabled(llm);
    await svc.chat.ask({ message: 'Первый вопрос' }, 'anna');
    await svc.chat.ask({ message: 'Второй вопрос' }, 'anna');
    expect(said(llm.calls[1]!)).toEqual(['Первый вопрос', 'ответ 1', 'Второй вопрос']);
    expect((await svc.chat.history('anna')).messages).toEqual([
      { role: 'user', content: 'Первый вопрос' }, { role: 'assistant', content: 'ответ 1' },
      { role: 'user', content: 'Второй вопрос' }, { role: 'assistant', content: 'ответ 2' },
    ]);
  });

  test('в контекст попадают последние 6 сообщений истории и новый вопрос', async () => {
    const llm = new FakeChatLlm((_r, n) => say(`а${n}`));
    const svc = await enabled(llm);
    for (let i = 1; i <= 5; i++) await svc.chat.ask({ message: `в${i}` }, 'anna');
    // К шестому вопросу накопилось 10 сообщений: берём 6 последних (три пары) и сам вопрос.
    await svc.chat.ask({ message: 'в6' }, 'anna');
    expect(said(llm.calls[5]!)).toEqual(['в3', 'а3', 'в4', 'а4', 'в5', 'а5', 'в6']);
  });

  test('контекст не начинается с ответа без вопроса: оборванная пара отбрасывается', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    const svc = await enabled(llm);
    await db.query(`INSERT INTO assistant_chat_messages (actor, role, content) VALUES ('anna', 'assistant', 'обрывок'), ('anna', 'user', 'в1'), ('anna', 'assistant', 'а1')`);
    await svc.chat.ask({ message: 'в2' }, 'anna');
    expect(said(llm.calls[0]!)).toEqual(['в1', 'а1', 'в2']);
  });

  test('у каждого входа своя история: чужие вопросы модели не уходят и в чате не показываются', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    const svc = await enabled(llm);
    await svc.chat.ask({ message: 'Вопрос Анны' }, 'anna');
    await svc.chat.ask({ message: 'Вопрос Бориса' }, 'boris');
    expect(said(llm.calls[1]!)).toEqual(['Вопрос Бориса']);
    expect((await svc.chat.history('boris')).messages.map((m) => m.content)).toEqual(['Вопрос Бориса', 'ок']);
  });

  test('имена из сохранённой истории модели не уходят: они превращаются в номера', async () => {
    await seed();
    const ref = await leaderRef();
    const llm = new FakeChatLlm((_r, n) => say(n === 1 ? `${ref} ведёт две группы.` : 'ок'));
    const svc = await enabled(llm);
    const first = await svc.chat.ask({ message: 'Кто ведёт две группы?' }, 'anna');
    expect(first).toMatchObject({ ok: true, answer: 'Иван Петров ведёт две группы.' });
    await svc.chat.ask({ message: 'А сколько у Иван Петров людей?' }, 'anna');
    expect(JSON.stringify(llm.calls[1])).not.toMatch(/Иван|Петров/);
    // Служителю в истории показываются настоящие имена.
    expect((await svc.chat.history('anna')).messages[1]!.content).toBe('Иван Петров ведёт две группы.');
  });

  test('неудачный вопрос (сбой модели, лимит) в историю не попадает', async () => {
    const llm = new FakeChatLlm((_r, n) => (n === 1 ? new LlmError('network', 'нет связи') : say('ок')));
    const svc = await enabled(llm);
    expect(await svc.chat.ask({ message: 'Не дошёл' }, 'anna')).toMatchObject({ ok: false });
    expect((await svc.chat.history('anna')).messages).toEqual([]);
  });

  test('«очистить» стирает историю только этого входа, и следующий вопрос идёт без прошлого', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    const svc = await enabled(llm);
    await svc.chat.ask({ message: 'Анна 1' }, 'anna');
    await svc.chat.ask({ message: 'Борис 1' }, 'boris');
    await svc.chat.clear('anna');
    expect((await svc.chat.history('anna')).messages).toEqual([]);
    expect((await svc.chat.history('boris')).messages).toHaveLength(2);
    await svc.chat.ask({ message: 'Анна 2' }, 'anna');
    expect(said(llm.calls[2]!)).toEqual(['Анна 2']);
  });

  test('на одного человека хранится не больше двухсот сообщений, старые уходят', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    const svc = await enabled(llm);
    await svc.chat.ask({ message: 'самый старый' }, 'anna');
    await db.query(`INSERT INTO assistant_chat_messages (actor, role, content) SELECT 'anna', 'user', 'v' || g FROM generate_series(1, 199) g`);
    await svc.chat.ask({ message: 'свежий' }, 'anna');
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM assistant_chat_messages WHERE actor = 'anna'`);
    expect(Number(rows[0]!.n)).toBe(200);
    expect(await db.query(`SELECT 1 FROM assistant_chat_messages WHERE content = 'самый старый'`)).toHaveProperty('rowCount', 0);
  });

  test('записи старше 30 дней вычищаются при следующей записи', async () => {
    await db.query(`INSERT INTO assistant_chat_messages (actor, role, content, created_at) VALUES ('boris', 'user', 'давно', now() - interval '31 days')`);
    const svc = await enabled(new FakeChatLlm(() => say('ок')));
    await svc.chat.ask({ message: 'сейчас' }, 'anna');
    expect(await db.query(`SELECT 1 FROM assistant_chat_messages WHERE content = 'давно'`)).toHaveProperty('rowCount', 0);
  });

  test('пустой или слишком длинный вопрос отклоняется, прежний вид тела {messages} работает и ничего не сохраняет', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    const svc = await enabled(llm);
    expect(await svc.chat.ask({ message: '   ' }, 'anna')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc.chat.ask({ message: 'я'.repeat(2001) }, 'anna')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await svc.chat.ask(turn('по-старому'), 'anna')).toMatchObject({ ok: true });
    expect((await svc.chat.history('anna')).messages).toEqual([]);
  });

  test('в журнал действий вопрос и ответ по-прежнему не попадают', async () => {
    const svc = await enabled(new FakeChatLlm(() => say('Секретный ответ')));
    await svc.chat.ask({ message: 'Секретный вопрос' }, 'anna');
    const rows = (await db.query(`SELECT after::text AS after FROM audit_log`)).rows;
    expect(JSON.stringify(rows)).not.toMatch(/Секретн/);
  });
});

describe('чат помощника: техподдержка', () => {
  const access = { role: 'readonly' as const, login: 'a_lebedeva', name: 'Анна Лебедева', teamRole: null, teamKinds: [] };
  const toolResults = (llm: FakeChatLlm) => llm.calls.at(-1)!.filter((m) => m.role === 'tool').map((m) => m.content ?? '');

  test('инструкция велит сначала понять, техподдержка это или данные, и для техподдержки смотреть базу знаний и права', async () => {
    const llm = new FakeChatLlm(() => say('ок'));
    await (await enabled(llm)).chat.ask(turn('привет'), 'anna', access);
    const system = (llm.calls[0]![0] as { content: string }).content;
    expect(system).toMatch(/Техподдержка/);
    expect(system).toMatch(/search_help/);
    expect(system).toMatch(/недостаточно прав/);
  });

  test('модель находит раздел базы знаний по вопросу и получает права спрашивающего — с его именем условным номером', async () => {
    await db.query(`INSERT INTO coordinators (name, source) VALUES ('Анна Лебедева', 'ui')`);
    const llm = new FakeChatLlm((req, n) => {
      if (n === 1) {
        expect(req.tools?.map((t) => t.name)).toEqual(['query', 'search_help', 'my_access']);
        return { content: null, toolCalls: [
          { id: 'h', name: 'search_help', arguments: JSON.stringify({ query: 'нет кнопки изменить у группы' }) },
          { id: 'm', name: 'my_access', arguments: '{}' },
        ] };
      }
      return say('Скорее всего, у вас недостаточно прав — обратитесь к администратору.');
    });
    const out = await (await enabled(llm)).chat.ask(turn('Почему я не могу изменить группу?'), 'a_lebedeva', access);
    expect(out).toMatchObject({ ok: true, answer: expect.stringContaining('недостаточно прав') });
    const [found, rights] = toolResults(llm);
    expect(found).toMatch(/Нет кнопки «Изменить»/);
    expect(rights).toMatch(/«Только чтение»/);
    expect(rights).toMatch(/НЕ связан со справочником команды/);
    expect(rights).toMatch(/его имя — (?:Координатор-[0-9a-f]{6}|Человек-\d+)\./);
    expect(JSON.stringify(llm.calls)).not.toMatch(/Лебедева/);
  });

  test('без прав спрашивающего инструмента my_access у модели нет; ничего не найдено в базе знаний — так и сказано', async () => {
    const llm = new FakeChatLlm((req, n) => {
      if (n === 1) {
        expect(req.tools?.map((t) => t.name)).toEqual(['query', 'search_help']);
        return tool('search_help', { query: 'зебра жираф' });
      }
      return say('Не нашёл.');
    });
    await (await enabled(llm)).chat.ask(turn('зебра?'), 'anna');
    expect(toolResults(llm)[0]).toMatch(/ничего не нашлось/);
  });
});

