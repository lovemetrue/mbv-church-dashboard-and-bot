import { describe, expect, test } from 'vitest';
import { createViewsSource } from '../src/home-groups/api/snapshot.js';
import type { ViewsInput } from '../src/home-groups/api/views.js';
import { createFakeEngine } from './helpers/fakePlanEngine.js';

/**
 * Общий снимок представлений: данные читаются и план считается один раз на все ручки, а
 * одновременные запросы ждут один и тот же расчёт.
 */

const empty: ViewsInput = { groups: [], requests: [], participants: [], coordinators: [] };

function setup(ttlMs: number) {
  let clock = Date.parse('2026-10-10T09:00:00Z');
  let loads = 0;
  const pending: { resolve: (v: ViewsInput) => void; reject: (e: Error) => void }[] = [];
  const fake = createFakeEngine();
  const get = createViewsSource({
    load: () => { loads += 1; return new Promise<ViewsInput>((resolve, reject) => { pending.push({ resolve, reject }); }); },
    engine: fake.engine,
    ttlMs,
    now: () => new Date(clock),
  });
  return {
    get, fake,
    loads: () => loads,
    advance: (ms: number) => { clock += ms; },
    finish: (input: ViewsInput = empty) => { pending.shift()!.resolve(input); },
    fail: (message: string) => { pending.shift()!.reject(new Error(message)); },
  };
}

describe('общий снимок представлений', () => {
  test('одновременные запросы ждут один расчёт, а не запускают свои', async () => {
    const s = setup(0);
    const calls = [s.get(), s.get(), s.get(), s.get(), s.get()];
    expect(s.loads()).toBe(1);
    s.finish();
    const results = await Promise.all(calls);
    expect(new Set(results).size).toBe(1);
    expect(s.fake.calls.plan).toHaveLength(1);
  });

  test('пока снимок свеж, повторный запрос его же и получает, базу не трогая', async () => {
    const s = setup(10_000);
    const first = s.get();
    s.finish();
    const a = await first;
    s.advance(9_999);
    const b = await s.get();
    expect(b).toBe(a);
    expect(s.loads()).toBe(1);
  });

  test('по истечении срока данные читаются и план считается заново', async () => {
    const s = setup(10_000);
    const first = s.get();
    s.finish();
    const a = await first;
    s.advance(10_000);
    const second = s.get();
    expect(s.loads()).toBe(2);
    s.finish();
    expect(await second).not.toBe(a);
    expect(s.fake.calls.plan).toHaveLength(2);
  });

  test('при нулевом сроке каждый последовательный запрос считает заново', async () => {
    const s = setup(0);
    for (let i = 1; i <= 3; i += 1) {
      const p = s.get();
      s.finish();
      await p;
      expect(s.loads()).toBe(i);
    }
  });

  test('запрос, пришедший во время расчёта после истечения срока, тоже присоединяется к нему', async () => {
    const s = setup(10_000);
    const first = s.get();
    s.finish();
    await first;
    s.advance(20_000);
    const a = s.get();
    s.advance(500);
    const b = s.get();
    expect(s.loads()).toBe(2);
    s.finish();
    expect(await a).toBe(await b);
  });

  test('сбой чтения не кэшируется: следующий запрос пробует снова', async () => {
    const s = setup(10_000);
    const failing = s.get();
    s.fail('база недоступна');
    await expect(failing).rejects.toThrow('база недоступна');

    const retry = s.get();
    expect(s.loads()).toBe(2);
    s.finish();
    await expect(retry).resolves.toBeDefined();
  });

  test('все ожидающие получают одну и ту же ошибку', async () => {
    const s = setup(0);
    const calls = [s.get(), s.get()];
    s.fail('сбой');
    const results = await Promise.allSettled(calls);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  test('время в представлениях — момент начала чтения', async () => {
    const s = setup(0);
    const p = s.get();
    s.advance(3_000);
    s.finish();
    expect((await p).today.generatedAt).toBe('2026-10-10T09:00:00.000Z');
  });

  test('после сбоя свежий снимок прежнего расчёта не подсовывается, если срок вышел', async () => {
    const s = setup(1_000);
    const ok = s.get();
    s.finish();
    await ok;
    s.advance(5_000);
    const failing = s.get();
    s.fail('сбой');
    await expect(failing).rejects.toThrow('сбой');
  });
});

describe('сброс снимка после действия координатора', () => {
  test('после сброса свежий снимок не отдаётся: список сразу показывает результат действия', async () => {
    const s = setup(10_000);
    const first = s.get();
    s.finish();
    const a = await first;
    s.get.invalidate();
    const second = s.get();
    expect(s.loads()).toBe(2);
    s.finish();
    expect(await second).not.toBe(a);
  });

  test('расчёт, начатый до сброса, не возвращает устаревший снимок в кэш', async () => {
    const s = setup(10_000);
    const stale = s.get();
    s.get.invalidate();
    s.finish();
    await stale;
    // Устаревший расчёт завершился после сброса: следующий запрос обязан читать заново.
    const next = s.get();
    expect(s.loads()).toBe(2);
    s.finish();
    await next;
  });
});

