import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createLlmConfig } from '../src/home-groups/assistant/llmConfig.js';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { SettingsRepo } from '../src/db/repos/settings.repo.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const SECRET = 'секрет сервера';
const OK = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });

interface Call { url: string; auth: string; model: string }
function make(env: NodeJS.ProcessEnv = {}, reply: () => Response = OK) {
  const calls: Call[] = [];
  const cfg = createLlmConfig({
    settings: new SettingsRepo(db), audit: new AuditRepo(db), env, secret: SECRET,
    fetch: async (url, init) => {
      calls.push({ url: String(url), auth: (init!.headers as Record<string, string>)['authorization']!, model: JSON.parse(String(init!.body)).model });
      return reply();
    },
  });
  return { cfg, calls };
}
const stored = async (key: string) => (await db.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value ?? null;
const audits = async () => (await db.query('SELECT actor, action, after::text AS after FROM audit_log ORDER BY id')).rows;

describe('подключение помощника: что действует', () => {
  test('ничего не задано — ключа нет, провайдер DeepSeek с моделью по умолчанию', async () => {
    const v = await make().cfg.view();
    expect(v).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: null, keySet: false, keySource: null, keyHint: null, keyUnreadable: false });
    expect(await make().cfg.source.current()).toBeNull();
  });

  test('пока в настройках ничего не сохраняли, действуют значения из .env (так было раньше)', async () => {
    const { cfg } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234', DEEPSEEK_MODEL: 'deepseek-reasoner' });
    expect(await cfg.view()).toMatchObject({ keySet: true, keySource: 'env', keyHint: '1234', model: 'deepseek-reasoner', provider: 'deepseek' });
    expect((await cfg.source.current())!.model).toBe('deepseek-reasoner');
  });

  test('адрес из .env, которого нет среди готовых, показывается как «другой провайдер»', async () => {
    const { cfg } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234', DEEPSEEK_BASE_URL: 'https://llm.example.org/v1' });
    expect(await cfg.view()).toMatchObject({ provider: 'custom', baseUrl: 'https://llm.example.org/v1' });
  });

  test('в обзоре есть список провайдеров с моделями, а самого ключа нигде нет', async () => {
    const { cfg } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' });
    const v = await cfg.view();
    expect(v.providers.map((p) => p.id)).toEqual(['deepseek', 'openai', 'openrouter', 'custom']);
    expect(v.providers[0]).toMatchObject({ label: 'DeepSeek', defaultModel: 'deepseek-chat' });
    expect(JSON.stringify(v)).not.toContain('envkey');
  });
});

describe('сохранение', () => {
  test('ключ ложится в базу зашифрованным, в обзоре видны только последние четыре символа, действует сразу', async () => {
    const { cfg } = make();
    expect(await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-real-key-0000ABCD' }, 'boss')).toEqual({ ok: true });
    const raw = await stored('llm.api_key');
    expect(typeof raw).toBe('string');
    expect(String(raw)).not.toContain('real-key');
    const v = await cfg.view();
    expect(v).toMatchObject({ keySet: true, keySource: 'settings', keyHint: 'ABCD' });
    expect(JSON.stringify(v)).not.toContain('real-key');
    expect(await cfg.source.current()).not.toBeNull();
  });

  test('без поля ключа прежний ключ остаётся, а пустое значение null убирает сохранённый ключ (возвращается .env)', async () => {
    const { cfg } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' });
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-real-key-0000ABCD' }, 'boss');
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat' }, 'boss');
    expect(await cfg.view()).toMatchObject({ keySource: 'settings', keyHint: 'ABCD' });
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: null }, 'boss');
    expect(await stored('llm.api_key')).toBeNull();
    expect(await cfg.view()).toMatchObject({ keySource: 'env', keyHint: '1234' });
  });

  test('ключ, вставленный в кавычках или с «Bearer», очищается: так его чаще всего и вставляют', async () => {
    const { cfg, calls } = make();
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: '  "Bearer sk-real-key-0000ABCD"  ' }, 'boss');
    await cfg.test({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(calls[0]!.auth).toBe('Bearer sk-real-key-0000ABCD');
  });

  test('модель и провайдер запоминаются; для «другого» нужен внешний https-адрес', async () => {
    const { cfg } = make();
    expect(await cfg.save({ provider: 'openai', model: 'gpt-4o-mini' }, 'boss')).toEqual({ ok: true });
    expect(await cfg.view()).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', baseUrl: null });
    expect(await cfg.save({ provider: 'custom', model: 'my-model', baseUrl: 'https://llm.example.org/v1/' }, 'boss')).toEqual({ ok: true });
    expect(await cfg.view()).toMatchObject({ provider: 'custom', model: 'my-model', baseUrl: 'https://llm.example.org/v1' });
    expect(await cfg.save({ provider: 'custom', model: 'm', baseUrl: 'http://x.org' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await cfg.save({ provider: 'custom', model: 'm', baseUrl: 'https://localhost/v1' }, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await cfg.view()).toMatchObject({ baseUrl: 'https://llm.example.org/v1' });
  });

  test.each([
    [{}], [null], [{ provider: 'нет такого', model: 'm' }], [{ provider: 'deepseek' }], [{ provider: 'deepseek', model: '' }],
    [{ provider: 'deepseek', model: 'модель с пробелом' }], [{ provider: 'deepseek', model: 'm', apiKey: 'коротко' }],
    [{ provider: 'deepseek', model: 'm', apiKey: 'sk-ключ с пробелом внутри 12345' }], [{ provider: 'deepseek', model: 'm', apiKey: 12345678 }],
    [{ provider: 'custom', model: 'm' }],
  ])('неверное тело %j отклоняется, ничего не сохраняется', async (body) => {
    expect(await make().cfg.save(body, 'boss')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await stored('llm.provider')).toBeNull();
    expect(await stored('llm.api_key')).toBeNull();
  });

  test('в журнале провайдер, модель и «ключ задан/убран», но не сам ключ', async () => {
    const { cfg } = make();
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-real-key-0000ABCD' }, 'boss');
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: null }, 'boss');
    const log = await audits();
    expect(log.map((e) => e.action)).toEqual(['settings.llm', 'settings.llm']);
    expect(JSON.parse(log[0]!.after)).toEqual({ provider: 'deepseek', model: 'deepseek-chat', key: 'set' });
    expect(JSON.parse(log[1]!.after)).toEqual({ provider: 'deepseek', model: 'deepseek-chat', key: 'removed' });
    expect(JSON.stringify(log)).not.toContain('real-key');
  });

  test('если секрет сервера сменился, сохранённый ключ не читается: об этом сказано, а действует .env', async () => {
    const { cfg } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' });
    await cfg.save({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-real-key-0000ABCD' }, 'boss');
    const other = createLlmConfig({ settings: new SettingsRepo(db), audit: new AuditRepo(db), env: { DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' }, secret: 'новый секрет' });
    expect(await other.view()).toMatchObject({ keyUnreadable: true, keySource: 'env', keyHint: '1234' });
  });
});

describe('проверка подключения', () => {
  test('успех: запрос ушёл на адрес провайдера с выбранной моделью и ключом, ничего не сохранилось', async () => {
    const { cfg, calls } = make();
    const r = await cfg.test({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-try-key-00001234' });
    expect(r).toMatchObject({ ok: true, model: 'gpt-4o-mini' });
    expect(calls).toEqual([{ url: 'https://api.openai.com/v1/chat/completions', auth: 'Bearer sk-try-key-00001234', model: 'gpt-4o-mini' }]);
    expect(await stored('llm.provider')).toBeNull();
    expect(await stored('llm.api_key')).toBeNull();
  });

  test('без ключа в запросе проверяется тот, что действует (сохранённый или из .env)', async () => {
    const { cfg, calls } = make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' });
    await cfg.test({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(calls[0]!.auth).toBe('Bearer sk-envkey-abcd1234');
    expect((await make().cfg.test({ provider: 'deepseek', model: 'deepseek-chat' }))).toMatchObject({ ok: false, code: 'nokey' });
  });

  test('провайдер не принял ключ: код ответа и пояснение провайдера видны, ключа в ответе нет', async () => {
    const { cfg } = make({}, () => new Response(JSON.stringify({ error: { message: 'Authentication Fails: sk-try-key-00001234 is invalid' } }), { status: 401 }));
    const r = await cfg.test({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-try-key-00001234' });
    expect(r).toMatchObject({ ok: false, code: 'auth', status: 401 });
    expect(JSON.stringify(r)).not.toContain('sk-try-key-00001234');
    expect((r as { detail: string }).detail).toContain('Authentication Fails');
  });

  test('неверная модель, нет денег на счёте, сбой сети — каждое своим кодом', async () => {
    const bad = await make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' }, () => new Response(JSON.stringify({ error: { message: 'Model Not Exist' } }), { status: 400 }))
      .cfg.test({ provider: 'deepseek', model: 'no-such-model' });
    expect(bad).toMatchObject({ ok: false, code: 'format', status: 400, detail: 'Model Not Exist' });
    const money = await make({ DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' }, () => new Response('{}', { status: 402 })).cfg.test({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(money).toMatchObject({ ok: false, code: 'auth', status: 402 });
    const down = createLlmConfig({ settings: new SettingsRepo(db), audit: new AuditRepo(db), env: { DEEPSEEK_API_KEY: 'sk-envkey-abcd1234' }, secret: SECRET, fetch: async () => { throw new Error('boom'); } });
    expect(await down.test({ provider: 'deepseek', model: 'deepseek-chat' })).toMatchObject({ ok: false, code: 'network' });
  });

  test('неверное тело проверки отклоняется так же, как при сохранении', async () => {
    expect(await make().cfg.test({ provider: 'custom', model: 'm', baseUrl: 'http://x.org' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await make().cfg.test(null)).toMatchObject({ ok: false, code: 'bad_request' });
  });
});
