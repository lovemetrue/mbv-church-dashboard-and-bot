import { describe, expect, test } from 'vitest';
import { UpdateQueue } from '../src/core/updateQueue.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Задача, которую завершает тест: так видно, кто в какой момент выполняется. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}

describe('очередь апдейтов', () => {
  test('апдейты одного человека идут строго по порядку', async () => {
    const q = new UpdateQueue(10, () => {});
    const order: string[] = [];
    const g = gate();
    await q.submit('u1', async () => { await g.opened; order.push('первый'); });
    await q.submit('u1', async () => { order.push('второй'); });
    await tick();
    expect(order).toEqual([]);
    g.open();
    await q.idle();
    expect(order).toEqual(['первый', 'второй']);
  });

  test('апдейты разных людей выполняются одновременно, а не друг за другом', async () => {
    const q = new UpdateQueue(10, () => {});
    const g = gate();
    let running = 0;
    let peak = 0;
    for (let i = 0; i < 5; i++) {
      await q.submit(`u${i}`, async () => { running++; peak = Math.max(peak, running); await g.opened; running--; });
    }
    await tick();
    expect(peak).toBe(5);
    g.open();
    await q.idle();
  });

  test('больше лимита одновременно не работает: submit ждёт свободного места', async () => {
    const q = new UpdateQueue(3, () => {});
    const g = gate();
    let running = 0;
    let peak = 0;
    let admitted = 0;
    const submits = Array.from({ length: 8 }, (_, i) =>
      q.submit(`u${i}`, async () => { running++; peak = Math.max(peak, running); await g.opened; running--; })
        .then(() => { admitted++; }));
    await tick();
    // Принято ровно три, остальные ждут: именно это останавливает опрос платформы.
    expect(admitted).toBe(3);
    g.open();
    await Promise.all(submits);
    await q.idle();
    expect(peak).toBeLessThanOrEqual(3);
    expect(admitted).toBe(8);
  });

  test('сбой одного апдейта уходит в onError и не останавливает остальных', async () => {
    const errors: unknown[] = [];
    const q = new UpdateQueue(5, (e) => errors.push(e));
    const done: string[] = [];
    await q.submit('u1', async () => { throw new Error('упал'); });
    await q.submit('u1', async () => { done.push('после сбоя того же человека'); });
    await q.submit('u2', async () => { done.push('другой человек'); });
    await q.idle();
    expect(errors).toHaveLength(1);
    expect(done.sort()).toEqual(['другой человек', 'после сбоя того же человека']);
  });

  test('idle ждёт всё принятое и после этого очередь пуста', async () => {
    const q = new UpdateQueue(5, () => {});
    let finished = 0;
    for (let i = 0; i < 4; i++) await q.submit(`u${i}`, async () => { await tick(); finished++; });
    await q.idle();
    expect(finished).toBe(4);
    expect(q.pending).toBe(0);
  });
});
