import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { bucketOf, buildPlan, buildTodaySummary } from '../src/home-groups/plan/index.js';
import { DEFAULT_SETTINGS } from '../src/home-groups/plan/settings.js';
import { buildMetroIndex, resolveDistrict } from '../src/home-groups/plan/geo.js';
import { parseAgeRange, parseGroupWhen } from '../src/home-groups/plan/parse.js';
import type { PlanGroup, PlanRequest } from '../src/home-groups/plan/types.js';

/**
 * Прогон движка на настоящей выгрузке таблицы церкви (dashboard/data.json). Адаптер «строка таблицы →
 * PlanGroup/PlanRequest» здесь локальный: боевой живёт на сервере, а этот тест проверяет инварианты
 * движка на реальных, неаккуратно заполненных данных. «Сегодня» зафиксировано, чтобы тест не
 * зависел от часов.
 */

interface GroupRow {
  no: number | null;
  leader: string;
  open_to_new: string | null;
  age: string | null;
  district: string;
  metro: string | null;
  day: string | null;
  time: string | null;
  people: number | null;
  feedback_at: string | null;
  comment: string | null;
  status: string;
}
interface RequestRow {
  fio: string;
  status: string;
  date: string | null;
  age: string | null;
  place: string | null;
  final_group: string | null;
}
const table = JSON.parse(readFileSync(new URL('../dashboard/data.json', import.meta.url), 'utf8')) as {
  groups: GroupRow[];
  requests: RequestRow[];
};

const TODAY = Date.UTC(2026, 9, 10);
const daysAgo = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? null : Math.max(0, Math.round((TODAY - then) / 86_400_000));
};

const metroIndex = buildMetroIndex(table.groups.map((g) => ({ metro: g.metro, district: g.district })));

const groups: PlanGroup[] = table.groups.map((row, i) => {
  const when = parseGroupWhen(row.day, row.time);
  return {
    id: i + 1,
    no: row.no,
    leader: row.leader,
    district: row.district || 'Не указан',
    metro: row.metro || null,
    ageRange: parseAgeRange(row.age),
    day: when.day,
    slot: when.slot,
    street: null,
    people: row.people,
    capacity: DEFAULT_SETTINGS.defaultCapacity,
    status: row.status,
    acceptsNew: (row.open_to_new ?? '').trim().toLowerCase() !== 'нет',
    doNotRefer: /не направл/i.test(row.comment ?? ''),
    verifiedDaysAgo: daysAgo(row.feedback_at),
  };
});

const CLOSED = new Set(['Исполнена', 'Аннулирована']);
const openRows = table.requests.map((row, i) => ({ row, id: i + 1 })).filter(({ row }) => !CLOSED.has(row.status) && !row.final_group);

const requests: PlanRequest[] = openRows.map(({ row, id }) => ({
  id,
  fio: row.fio,
  ageRange: parseAgeRange(row.age),
  district: resolveDistrict(row.place, metroIndex),
  place: row.place,
  days: [],
  slot: null,
  street: null,
  rejectedGroupIds: [],
  avoidDays: [],
  avoidSlots: [],
  pinnedGroupId: null,
  waitingDays: daysAgo(row.date),
}));

const run = (input = requests) => buildPlan({ requests: input, groups, settings: DEFAULT_SETTINGS });
const plan = run();

describe('движок на настоящей выгрузке таблицы церкви', () => {
  test('в выгрузке достаточно данных, чтобы проверка что-то значила', () => {
    expect(groups.length).toBeGreaterThan(100);
    expect(requests.length).toBeGreaterThan(50);
  });

  test('у каждой открытой заявки есть запись в плане', () => {
    expect(plan.entries.size).toBe(requests.length);
    for (const r of requests) expect(plan.entries.has(r.id), `заявка ${r.id}`).toBe(true);
  });

  test('ни одна группа не переполнена планом', () => {
    for (const g of groups) {
      const free = Math.max(0, g.capacity - (g.people ?? 0));
      expect(plan.takenBy.get(g.id)?.length ?? 0, `группа ${g.id} (№${g.no})`).toBeLessThanOrEqual(free);
    }
  });

  test('предложены только группы, которые принимают новых, и только в доступных районах', () => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const [requestId, entry] of plan.entries) {
      if (entry.kind !== 'proposal') continue;
      const g = byId.get(entry.main.groupId)!;
      const r = requests.find((x) => x.id === requestId)!;
      expect(['Функционирует', 'Кампания']).toContain(g.status);
      expect(g.acceptsNew).toBe(true);
      expect(g.doNotRefer).toBe(false);
      if (r.ageRange && g.ageRange) {
        expect(r.ageRange[0] <= g.ageRange[1] && g.ageRange[0] <= r.ageRange[1], `заявка ${requestId}`).toBe(true);
      }
      const reachable =
        g.district === r.district ||
        g.district === 'Не указан' ||
        g.district === 'Онлайн' ||
        DEFAULT_SETTINGS.neighbors[r.district!]?.includes(g.district);
      expect(reachable, `заявка ${requestId}: ${r.district} → ${g.district}`).toBe(true);
    }
  });

  test('повторный запуск и обратный порядок заявок дают тот же план', () => {
    const canon = (p: ReturnType<typeof run>) => [...p.entries].sort(([a], [b]) => a - b);
    expect(canon(run())).toEqual(canon(plan));
    expect(canon(run([...requests].reverse()))).toEqual(canon(plan));
  });

  test('заявки без района не получают группу и объясняются «Место не распознано»', () => {
    const lost = requests.filter((r) => r.district === null);
    expect(lost.length).toBeGreaterThan(0);
    for (const r of lost) expect(plan.entries.get(r.id)).toEqual({ kind: 'none', code: 'place', reason: 'Место не распознано' });
  });

  test('сводка «Сегодня» строится без исключений и согласована с планом', () => {
    const summary = buildTodaySummary({ requests, entries: plan.entries, groups, settings: DEFAULT_SETTINGS });
    expect(summary.ageColumns).toHaveLength(5);
    for (const row of summary.matrix) {
      expect(row.cells).toHaveLength(5);
      for (const cell of row.cells) expect(cell.net).toBe(cell.supply - cell.demand);
    }
    const clustered = summary.clusters.flatMap((c) => c.requestIds);
    for (const s of summary.singles) expect(clustered).not.toContain(s.requestId);
    // Каждая заявка «нужна помощь» — либо в кластере, либо в singles, либо ни там ни там, но не дважды.
    const human = requests.filter((r) => bucketOf({ status: 'В работе', entry: plan.entries.get(r.id), callback: false, settings: DEFAULT_SETTINGS }) === 'human');
    expect(summary.singles.length).toBeLessThanOrEqual(human.length);
  });

  test('цифры по выгрузке (для отчёта): печатаются при HG_STATS=1', () => {
    if (!process.env['HG_STATS']) return;
    const buckets = { ready: 0, human: 0 };
    const reasons = new Map<string, number>();
    for (const r of requests) {
      const entry = plan.entries.get(r.id);
      const bucket = bucketOf({ status: 'В работе', entry, callback: false, settings: DEFAULT_SETTINGS });
      if (bucket === 'ready') buckets.ready++;
      else buckets.human++;
      if (entry?.kind === 'none') reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
      else if (bucket === 'human') reasons.set('Уверенность плана ниже порога', (reasons.get('Уверенность плана ниже порога') ?? 0) + 1);
    }
    const withDistrict = requests.filter((r) => r.district !== null).length;
    const withPlace = requests.filter((r) => r.place).length;
    const recognizedOfPlace = requests.filter((r) => r.place && r.district !== null).length;
    console.info(
      JSON.stringify(
        {
          открытыхЗаявок: requests.length,
          ready: buckets.ready,
          human: buckets.human,
          сНепустымPlace: withPlace,
          районРаспознанИзPlace: recognizedOfPlace,
          всегоСРайоном: withDistrict,
          безРайона: requests.length - withDistrict,
          безВозраста: requests.filter((r) => r.ageRange === null).length,
          нераспознанныйPlace: requests.filter((r) => r.place && r.district === null).map((r) => r.place),
          топПричин: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5),
        },
        null,
        2,
      ),
    );
  });
});
