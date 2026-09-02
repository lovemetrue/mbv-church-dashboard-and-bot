import { describe, expect, test } from 'vitest';
import { RateLimiter } from '../src/broadcast/throttle.js';

/** Управляемые часы и сон: тест проверяет расчёт паузы, а не реально ждёт. */
function fakeClock() {
  let now = 1_000_000;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RateLimiter', () => {
  test('первая отправка идёт без задержки', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock.now, clock.sleep);
    await limiter.take();
    expect(clock.slept).toEqual([]);
  });

  test('следующие отправки разносятся на интервал, заданный частотой', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock.now, clock.sleep);
    await limiter.take();
    await limiter.take();
    await limiter.take();
    expect(clock.slept).toEqual([100, 100]);
  });

  test('при частоте 20 в секунду интервал 50 мс', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(20, clock.now, clock.sleep);
    await limiter.take();
    await limiter.take();
    expect(clock.slept).toEqual([50]);
  });

  test('после долгой паузы отправка идёт сразу, без накопленного долга', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock.now, clock.sleep);
    await limiter.take();
    clock.advance(5_000);
    await limiter.take();
    expect(clock.slept).toEqual([]);
  });

  test('пауза учитывает время, потраченное на саму отправку', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(10, clock.now, clock.sleep);
    await limiter.take();
    clock.advance(60); // отправка заняла 60 мс из интервала в 100 мс
    await limiter.take();
    expect(clock.slept).toEqual([40]);
  });
});
