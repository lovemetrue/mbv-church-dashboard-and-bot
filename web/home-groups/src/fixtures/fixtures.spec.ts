import { describe, expect, test } from 'vitest';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';

describe('фикстуры', () => {
  test('счётчики сходятся со списком заявок, отказы в список не попадают', () => {
    const r = buildRequests();
    const byBucket = (b: string) => r.items.filter((i) => i.bucket === b).length;
    expect(r.counters.ready).toBe(byBucket('ready'));
    expect(r.counters.human).toBe(byBucket('human'));
    expect(r.counters.done).toBe(byBucket('done'));
    expect(r.items.some((i) => i.bucket === 'cancelled')).toBe(false);
    expect(r.counters.cancelled).toBeGreaterThan(0);
  });

  test('«Распределено X из Y» считается как в контракте: готово, перезвонить и утверждено из всех, кроме отказов', () => {
    const t = buildToday();
    expect(t.assigned).toBe(t.counters.ready + t.counters.callback + t.counters.done);
    expect(t.total).toBe(t.counters.ready + t.counters.callback + t.counters.human + t.counters.done);
  });

  test('в этапе A корзины «перезвонить» нет: флага на сервере ещё нет', () => {
    expect(buildToday().counters.callback).toBe(0);
  });

  test('данных достаточно для всех экранов и в них есть редкие случаи', () => {
    const r = buildRequests();
    expect(r.items.length).toBeGreaterThanOrEqual(15);
    expect(buildGroups().items.length).toBeGreaterThanOrEqual(12);
    expect(buildPeople().items.length).toBeGreaterThanOrEqual(20);
    expect(buildCoordinators().items).toHaveLength(4);
    expect(r.items.some((i) => i.proposal?.displaced)).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'place')).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'taken')).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'nogroup')).toBe(true);
    expect(r.items.some((i) => i.bucket === 'human' && i.proposal)).toBe(true);
    expect(r.items.some((i) => i.dataFill.includes(false))).toBe(true);
  });

  test('место в группе не отдаётся двум заявкам сверх свободных', () => {
    const groups = buildGroups().items;
    for (const g of groups) expect(g.plannedRequests.length).toBeLessThanOrEqual(g.free);
  });

  test('у каждой клетки матрицы уровень согласован со спросом и местами', () => {
    for (const row of buildToday().matrix)
      for (const c of row.cells) {
        expect(c.net).toBe(c.supply - c.demand);
        if (c.demand > 0 && c.supply === 0) expect(c.level).toBe('crit');
      }
  });
});
