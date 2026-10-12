import { describe, expect, test } from 'vitest';
import { createDeepSeekClient, llmFromEnv, LlmError } from '../src/platform/llm/deepseek.js';

const ok = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

describe('клиент DeepSeek', () => {
  test('ключ берётся из окружения; без ключа помощник недоступен, а не падает', () => {
    expect(llmFromEnv({})).toBeNull();
    expect(llmFromEnv({ DEEPSEEK_API_KEY: '   ' })).toBeNull();
    expect(llmFromEnv({ DEEPSEEK_API_KEY: 'sk-test' })?.model).toBe('deepseek-chat');
    expect(llmFromEnv({ DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_MODEL: 'deepseek-reasoner' })?.model).toBe('deepseek-reasoner');
  });

  test('запрос уходит на адрес сервиса с ключом в заголовке, ответ разбирается', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createDeepSeekClient({
      apiKey: 'sk-secret', baseUrl: 'https://api.example.test', model: 'm',
      fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return ok('{"a":1}'); },
    });
    const res = await client.complete({ system: 'система', user: 'вопрос' });
    expect(res).toEqual({ text: '{"a":1}', promptTokens: 10, completionTokens: 5 });
    expect(calls[0]!.url).toBe('https://api.example.test/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-secret');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'm', temperature: 0, response_format: { type: 'json_object' } });
    expect(body.messages).toEqual([{ role: 'system', content: 'система' }, { role: 'user', content: 'вопрос' }]);
  });

  test('при 429 и 5xx повторяет запрос, при 401 сразу сообщает про ключ', async () => {
    let n = 0;
    const flaky = createDeepSeekClient({
      apiKey: 'k', model: 'm', retryDelayMs: 0,
      fetch: async () => (++n < 3 ? new Response('busy', { status: n === 1 ? 429 : 503 }) : ok('{}')),
    });
    expect((await flaky.complete({ system: 's', user: 'u' })).text).toBe('{}');
    expect(n).toBe(3);

    let m = 0;
    const bad = createDeepSeekClient({ apiKey: 'k', model: 'm', retryDelayMs: 0, fetch: async () => { m += 1; return new Response('no', { status: 401 }); } });
    await expect(bad.complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'auth' });
    expect(m).toBe(1);
  });

  test('ошибка не содержит ключ и тела запроса', async () => {
    const client = createDeepSeekClient({
      apiKey: 'sk-very-secret', model: 'm', retryDelayMs: 0, maxAttempts: 1,
      fetch: async () => new Response('ошибка сервиса: ваш запрос «Иванов 89110000000»', { status: 500 }),
    });
    const err = await client.complete({ system: 's', user: 'Иванов 89110000000' }).catch((e: unknown) => e as LlmError);
    expect(err).toBeInstanceOf(LlmError);
    expect(String(err.message)).not.toMatch(/sk-very-secret|Иванов|8911/);
  });

  test('пустой или не тот формат ответа — понятная ошибка', async () => {
    const client = createDeepSeekClient({ apiKey: 'k', model: 'm', fetch: async () => new Response('{"choices":[]}', { status: 200 }) });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'format' });
  });

  test('сетевой сбой и таймаут — ошибка network после повторов', async () => {
    const client = createDeepSeekClient({
      apiKey: 'k', model: 'm', retryDelayMs: 0, maxAttempts: 2,
      fetch: async () => { throw new TypeError('fetch failed'); },
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'network' });
  });
});

describe('разговор с вызовом инструментов', () => {
  const toolReply = new Response(JSON.stringify({
    choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query', arguments: '{"sql":"select 1"}' } }] } }],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
  }), { status: 200 });

  test('просьба выполнить запрос разбирается, а история уходит с вызовами и результатами', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createDeepSeekClient({
      apiKey: 'k', model: 'm',
      fetch: async (_url, init) => { bodies.push(JSON.parse(String(init!.body))); return bodies.length === 1 ? toolReply : ok('Готово'); },
    });
    const tools = [{ name: 'query', description: 'запрос', parameters: { type: 'object', properties: { sql: { type: 'string' } } } }];
    const first = await client.chat({ messages: [{ role: 'system', content: 'с' }, { role: 'user', content: 'в' }], tools });
    expect(first).toEqual({ content: null, toolCalls: [{ id: 'c1', name: 'query', arguments: '{"sql":"select 1"}' }], promptTokens: 7, completionTokens: 3 });
    expect(bodies[0]!['tools']).toEqual([{ type: 'function', function: tools[0] }]);
    expect(bodies[0]!['response_format']).toBeUndefined();

    const second = await client.chat({
      messages: [
        { role: 'user', content: 'в' },
        { role: 'assistant', content: null, toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: 'c1', content: '[{"n":1}]' },
      ],
      tools,
    });
    expect(second.content).toBe('Готово');
    expect((bodies[1]!['messages'] as unknown[]).slice(1)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query', arguments: '{"sql":"select 1"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '[{"n":1}]' },
    ]);
  });

  test('пустой ответ без вызовов — ошибка формата', async () => {
    const client = createDeepSeekClient({ apiKey: 'k', model: 'm', fetch: async () => new Response('{"choices":[{"message":{"content":null}}]}', { status: 200 }) });
    await expect(client.chat({ messages: [{ role: 'user', content: 'в' }] })).rejects.toMatchObject({ code: 'format' });
  });
});

describe('что сервис помощника ответил на ошибку (для проверки ключа в «Настройках»)', () => {
  const failing = (status: number, body: string, apiKey = 'sk-very-secret') =>
    createDeepSeekClient({ apiKey, model: 'm', retryDelayMs: 0, maxAttempts: 1, fetch: async () => new Response(body, { status }) });

  test('у ошибки есть код ответа и короткое пояснение провайдера из поля error.message', async () => {
    const err = await failing(401, JSON.stringify({ error: { message: 'Authentication Fails (auth header format should be Bearer sk-...)' } }))
      .complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(err).toMatchObject({ code: 'auth', status: 401 });
    expect(err.detail).toBe('Authentication Fails (auth header format should be Bearer sk-...)');
  });

  test('неверное имя модели (400) тоже объясняется словами провайдера', async () => {
    const err = await failing(400, JSON.stringify({ error: { message: 'Model Not Exist' } })).complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(err).toMatchObject({ code: 'format', status: 400, detail: 'Model Not Exist' });
  });

  test('если провайдер вернул в ошибке наш ключ, в пояснении он закрыт', async () => {
    const err = await failing(401, JSON.stringify({ error: { message: 'Incorrect API key provided: sk-very-secret. Also sk-other1234567890abcdef' } }))
      .complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(err.detail).not.toContain('sk-very-secret');
    expect(err.detail).not.toContain('sk-other1234567890abcdef');
    expect(err.detail).toContain('Incorrect API key provided');
  });

  test('ключ без привычной приставки (его точное значение) тоже закрыт, если провайдер его процитировал', async () => {
    const key = 'zq7Xk29PwLm4Rt81';
    const err = await failing(401, JSON.stringify({ error: { message: `Invalid key ${key} supplied` } }), key).complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(err.detail).toBe('Invalid key *** supplied');
  });

  test('пояснение обрезается, а тело, которое не разобрать как JSON, не показывается вовсе', async () => {
    const long = await failing(400, JSON.stringify({ error: { message: 'x'.repeat(1000) } })).complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(long.detail!.length).toBeLessThanOrEqual(300);
    const html = await failing(401, '<html>Иванов 89110000000</html>').complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(html.detail).toBeUndefined();
  });

  test('обычное сообщение ошибки по-прежнему без пояснения провайдера и без имени переменной окружения', async () => {
    const err = await failing(401, JSON.stringify({ error: { message: 'секретная подробность' } })).complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError);
    expect(err.message).not.toContain('секретная подробность');
    expect(err.message).not.toContain('DEEPSEEK_API_KEY');
  });

  test('при 402 говорится про счёт, при 429 после повторов — про лимит', async () => {
    expect(await failing(402, '{}').complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError)).toMatchObject({ code: 'auth', status: 402 });
    expect(await failing(429, '{}').complete({ system: 's', user: 'u' }).catch((e: unknown) => e as LlmError)).toMatchObject({ code: 'rate', status: 429 });
  });
});
