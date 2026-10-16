import { describe, expect, test } from 'vitest';
import type { RequestItem } from '../src/home-groups/contracts.js';
import { buildTeam } from '../src/home-groups/api/team.js';

const item = (over: Partial<RequestItem> & { id: number }): RequestItem => ({
  fio: `Заявитель ${over.id}`, phone: null, ageLabel: null, place: null, district: null, days: [], slot: null, street: null,
  source: 'Бот', status: 'Новая', bucket: 'ready', callback: false, waitingDays: 1, dataFill: [false, false, false, false],
  proposal: null, noPlan: null, scheduleInfo: { source: null, text: null }, streetInfo: { source: null, text: null },
  original: [], finalGroup: null, finalGroupText: null, responsible: null, note: null, log: [], ...over,
} as RequestItem);

const AT = '2026-10-11T10:00:00.000Z';

describe('сводка для руководителя координаторов', () => {
  test('считает открытые заявки: закрытые и аннулированные в счёт не идут', () => {
    const t = buildTeam([item({ id: 1 }), item({ id: 2, bucket: 'done' }), item({ id: 3, bucket: 'cancelled' })], [], AT);
    expect(t.totals).toMatchObject({ open: 1, unassigned: 1 });
  });

  test('«Всего заявок» — общее число: исполненные не вычитаются, а считаются отдельно', () => {
    const t = buildTeam([item({ id: 1 }), item({ id: 2, bucket: 'done' }), item({ id: 3, bucket: 'done' }), item({ id: 4, bucket: 'cancelled' })], [], AT);
    expect(t.totals).toMatchObject({ all: 4, done: 2, open: 1 });
  });

  test('сроки ожидания раскладываются по корзинам, включая «дата неизвестна»', () => {
    const t = buildTeam([
      item({ id: 1, waitingDays: 0 }), item({ id: 2, waitingDays: 2 }), item({ id: 3, waitingDays: 3 }), item({ id: 4, waitingDays: 7 }),
      item({ id: 5, waitingDays: 8 }), item({ id: 6, waitingDays: 14 }), item({ id: 7, waitingDays: 15 }), item({ id: 8, waitingDays: null }),
    ], [], AT);
    expect(t.aging).toEqual([
      { label: '0–2 дня', count: 2 }, { label: '3–7 дней', count: 2 }, { label: '8–14 дней', count: 2 },
      { label: '15 дней и больше', count: 1 }, { label: 'Дата неизвестна', count: 1 },
    ]);
    expect(t.totals.over7).toBe(3);
  });

  test('нагрузка по координаторам: сначала те, у кого больше, «никто не взял» отдельной строкой', () => {
    const t = buildTeam([
      item({ id: 1, responsible: 'Анна' }), item({ id: 2, responsible: 'Анна', callback: true, bucket: 'callback', waitingDays: 10 }),
      item({ id: 3, responsible: 'Борис', waitingDays: 20 }), item({ id: 4 }), item({ id: 5 }), item({ id: 6 }),
    ], [], AT);
    expect(t.workload).toEqual([
      { name: null, open: 3, callback: 0, over7: 0, oldestDays: 1 },
      { name: 'Анна', open: 2, callback: 1, over7: 1, oldestDays: 10 },
      { name: 'Борис', open: 1, callback: 0, over7: 1, oldestDays: 20 },
    ]);
    expect(t.totals).toMatchObject({ unassigned: 3, callback: 1 });
  });

  test('заявки без движения — старейшие первыми, только дольше недели, не больше двадцати', () => {
    const many = Array.from({ length: 25 }, (_, i) => item({ id: i + 1, waitingDays: 8 + i }));
    const t = buildTeam([...many, item({ id: 100, waitingDays: 3 })], [], AT);
    expect(t.stuck).toHaveLength(20);
    expect(t.stuck[0]).toMatchObject({ id: 25, waitingDays: 32 });
    expect(t.stuck.every((s) => s.waitingDays > 7)).toBe(true);
  });

  test('«без движения» — только то, что ждёт дольше недели, свежие заявки сюда не попадают', () => {
    const t = buildTeam([item({ id: 1, waitingDays: 3 }), item({ id: 2, waitingDays: 7 }), item({ id: 3, waitingDays: 8 })], [], AT);
    expect(t.stuck.map((s) => s.id)).toEqual([3]);
  });

  test('действия за неделю собираются по логинам, утверждения идут в итог', () => {
    const t = buildTeam([], [
      { actor: 'anna', action: 'request.call', n: 4 }, { actor: 'anna', action: 'request.approve', n: 2 },
      { actor: 'boris', action: 'request.edit', n: 1 }, { actor: 'boris', action: 'request.approve', n: 1 },
      { actor: 'boris', action: 'request.reject', n: 3 }, { actor: 'boris', action: 'request.assign', n: 5 },
    ], AT);
    expect(t.activity).toEqual([
      { actor: 'anna', calls: 4, approved: 2, rejected: 0, edits: 0, assigned: 0 },
      { actor: 'boris', calls: 0, approved: 1, rejected: 3, edits: 1, assigned: 5 },
    ]);
    expect(t.totals.approvedWeek).toBe(3);
  });

  test('пустые данные не ломают сводку', () => {
    const t = buildTeam([], [], AT);
    expect(t.totals).toEqual({ open: 0, all: 0, done: 0, unassigned: 0, callback: 0, over7: 0, approvedWeek: 0, otherOpen: 0 });
    expect(t.workload).toEqual([]);
    expect(t.stuck).toEqual([]);
  });
});
