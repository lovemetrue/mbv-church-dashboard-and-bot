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
