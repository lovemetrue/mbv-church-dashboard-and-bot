import { describe, expect, test } from 'vitest';
import { buildPlan } from '../src/home-groups/plan/engine.js';
import { DEFAULT_SETTINGS } from '../src/home-groups/plan/settings.js';
import { buildTodaySummary } from '../src/home-groups/plan/summary.js';
import type { PlanEntry, PlanGroup, PlanRequest } from '../src/home-groups/plan/types.js';

let nextGroupId = 1;
let nextRequestId = 1;

const group = (patch: Partial<PlanGroup> = {}): PlanGroup => ({
  id: nextGroupId++,
  no: null,
  leader: 'Ведущий',
  district: 'Приморский',
  metro: null,
  ageRange: [25, 35],
  day: 'Чт',
  slot: 'вечер',
  street: null,
  people: 5,
  capacity: 10,
  status: 'Функционирует',
  acceptsNew: true,
  doNotRefer: false,
  verifiedDaysAgo: 5,
  ...patch,
});

const request = (patch: Partial<PlanRequest> = {}): PlanRequest => ({
  id: nextRequestId++,
  fio: 'Иванов Иван Иванович',
  ageRange: [25, 35],
  district: 'Приморский',
  place: null,
  days: [],
  slot: null,
  street: null,
  rejectedGroupIds: [],
  avoidDays: [],
  avoidSlots: [],
  pinnedGroupId: null,
  waitingDays: 3,
  ...patch,
});

const settings = DEFAULT_SETTINGS;
const NOGROUP: PlanEntry = { kind: 'none', code: 'nogroup', reason: 'В районе нет групп, подходящих по возрасту' };
const proposalWith = (confidence: number): PlanEntry => ({
  kind: 'proposal',
  main: { groupId: 1, score: confidence, reasons: [] },
  confidence,
  knownParams: 4,
  alternatives: [],
  displaced: null,
});

const summary = (requests: PlanRequest[], groups: PlanGroup[], entries = new Map<number, PlanEntry>()) =>
  buildTodaySummary({ requests, groups, entries, settings });
const cellOf = (s: ReturnType<typeof summary>, district: string, age: string) =>
  s.matrix.find((row) => row.district === district)?.cells.find((c) => c.age === age);

describe('матрица «район × возраст»', () => {
  test('колонки возраста — те же, что в разборе возраста, и в каждой строке есть ячейка каждой', () => {
    const s = summary([request()], [group()]);
    expect(s.ageColumns).toEqual(['до 18', '18–25', '25–40', '40–55', '55–65', '65+', 'Возраст не указан']);
    expect(s.matrix[0]!.cells.map((c) => c.age)).toEqual(s.ageColumns);
  });

  test('спрос — открытые заявки района и возрастной колонки, предложение — свободные места принимающих групп', () => {
    const groups = [group({ people: 6, capacity: 10 }), group({ people: 8, capacity: 10 })];
    const requests = [request(), request(), request({ ageRange: [45, 55] })];
    const s = summary(requests, groups);
    expect(cellOf(s, 'Приморский', '25–40')).toMatchObject({ age: '25–40', demand: 2, supply: 6, net: 4, level: 'ok' });
    expect(cellOf(s, 'Приморский', '40–55')).toMatchObject({ demand: 1, supply: 0 });
  });

  test('группа с диапазоном в несколько колонок считается во всех, которые задевает', () => {
    const s = summary([request()], [group({ ageRange: [35, 50], people: 6, capacity: 10 })]);
    expect(cellOf(s, 'Приморский', '25–40')!.supply).toBe(4);
    expect(cellOf(s, 'Приморский', '40–55')!.supply).toBe(4);
    expect(cellOf(s, 'Приморский', '55–65')!.supply).toBe(0);
    expect(cellOf(s, 'Приморский', '18–25')!.supply).toBe(0);
  });

  test('группа с неизвестным возрастом считается во всех колонках', () => {
    const s = summary([], [group({ ageRange: null, people: 7, capacity: 10 })]);
    // Все возрастные колонки; особая «Возраст не указан» — только для спроса.
    for (const age of s.ageColumns.filter((a) => a !== 'Возраст не указан')) expect(cellOf(s, 'Приморский', age)!.supply, age).toBe(3);
  });

  test('места в группах, которые не принимают, в предложение не входят', () => {
    const closed = [
      group({ status: 'На паузе' }),
      group({ status: 'Закрыта' }),
      group({ acceptsNew: false }),
      group({ doNotRefer: true }),
      group({ people: 10, capacity: 10 }),
    ];
    const s = summary([request()], closed);
    expect(cellOf(s, 'Приморский', '25–40')).toMatchObject({ demand: 1, supply: 0 });
  });

  test('группа «Кампания» принимает людей, число участников «не указано» значит все места свободны', () => {
    const s = summary([], [group({ status: 'Кампания', people: null, capacity: 10 })]);
    expect(cellOf(s, 'Приморский', '25–40')!.supply).toBe(10);
  });

  test('группа без района строкой матрицы не становится', () => {
    const s = summary([], [group({ district: 'Не указан' })]);
    expect(s.matrix).toEqual([]);
  });

  test('заявки без района собираются в особую строку, без возраста — в особую колонку: проблему видно, а не прячут', () => {
    const noDistrict = request({ district: null });
    const noAge = request({ ageRange: null, district: 'Невский' });
    const s = summary([noDistrict, noAge], [group({ district: 'Невский', people: 10 })]);
    expect(s.matrix.map((row) => row.district).sort()).toEqual(['Невский', 'Район не определён']);
    expect(cellOf(s, 'Район не определён', '25–40')).toMatchObject({ demand: 1, supply: 0, requestIds: [noDistrict.id] });
    expect(cellOf(s, 'Невский', 'Возраст не указан')).toMatchObject({ demand: 1, requestIds: [noAge.id], groupIds: [] });
  });

  test('заявка без района и без возраста попадает в их пересечение', () => {
    const r = request({ district: null, ageRange: null });
    const s = summary([r], []);
    expect(cellOf(s, 'Район не определён', 'Возраст не указан')).toMatchObject({ demand: 1, requestIds: [r.id] });
  });

  test('места в особые колонку и строку не засчитываются: группа без возраста идёт в обычные колонки', () => {
    const s = summary([], [group({ ageRange: null, district: 'Невский' })]);
    expect(cellOf(s, 'Невский', 'Возраст не указан')).toMatchObject({ supply: 0, groupIds: [] });
    expect(cellOf(s, 'Невский', '25–40')!.supply).toBeGreaterThan(0);
  });

  test('в ячейке перечислены заявки и группы, которые дают спрос и места; группы без свободных мест не перечисляются', () => {
    const r1 = request();
    const r2 = request();
    const open = group({ people: 6, capacity: 10 });
    const full = group({ people: 10, capacity: 10 });
    const closed = group({ status: 'Закрыта' });
    const s = summary([r1, r2], [open, full, closed]);
    const cell = cellOf(s, 'Приморский', '25–40')!;
    expect(cell.requestIds).toEqual([r1.id, r2.id]);
    expect(cell.groupIds).toEqual([open.id]);
  });

  test('места района в итоге считаются без двойного счёта: группа с несколькими возрастами — один раз', () => {
    const wide = group({ ageRange: [20, 40], people: 5, capacity: 10 });
    const narrow = group({ ageRange: [26, 30], people: 8, capacity: 10 });
    const s = summary([], [wide, narrow]);
    // По ячейкам wide входит в две колонки, но в итоге района её 5 мест — один раз.
    expect(s.matrix[0]!.supplyTotal).toBe(5 + 2);
    expect(s.matrix[0]!.cells.reduce((sum, c) => sum + c.supply, 0)).toBeGreaterThan(7);
  });

  test('группа без свободных мест и не принимающая в итог мест не входит', () => {
    const s = summary([], [group({ people: 10, capacity: 10 }), group({ status: 'Закрыта' }), group({ people: 5, capacity: 10 })]);
    expect(s.matrix[0]!.supplyTotal).toBe(5);
  });

  test('группа с диапазоном в несколько колонок перечисляется в каждой из них', () => {
    const wide = group({ ageRange: [20, 40], people: 5, capacity: 10 });
    const s = summary([], [wide]);
    for (const age of ['18–25', '25–40']) expect(cellOf(s, 'Приморский', age)!.groupIds).toEqual([wide.id]);
    expect(cellOf(s, 'Приморский', '40–55')!.groupIds).toEqual([]);
  });

  test('показываются только районы, где есть спрос или места', () => {
    const s = summary([request({ district: 'Невский' })], [group({ district: 'Приморский', people: 10 })]);
    expect(s.matrix.map((r) => r.district)).toEqual(['Невский']);
  });

  test('уровни ячейки: нет мест при спросе — crit, мест меньше спроса — warn, места есть — ok, пусто — zero', () => {
    const groups = [group({ people: 8, capacity: 10 })]; // 2 места в «25–40» и в Приморском
    const requests = [
      request({ ageRange: [47, 47] }), // 40–55: спрос 1, мест нет
      request(),
      request(),
      request(), // 25–40: спрос 3 при 2 местах
    ];
    const s = summary(requests, groups);
    expect(cellOf(s, 'Приморский', '40–55')).toMatchObject({ demand: 1, supply: 0, net: -1, level: 'crit' });
    expect(cellOf(s, 'Приморский', '25–40')).toMatchObject({ demand: 3, supply: 2, net: -1, level: 'warn' });
    expect(cellOf(s, 'Приморский', 'до 18')).toMatchObject({ demand: 0, supply: 0, net: 0, level: 'zero' });
    const ok = summary([request()], [group({ people: 5 })]);
    expect(cellOf(ok, 'Приморский', '25–40')).toMatchObject({ demand: 1, supply: 5, net: 4, level: 'ok' });
  });

  test('места при нулевом спросе — ok, ровно впритык — ok', () => {
    expect(cellOf(summary([], [group({ people: 5 })]), 'Приморский', '25–40')!.level).toBe('ok');
    expect(cellOf(summary([request()], [group({ people: 9 })]), 'Приморский', '25–40')).toMatchObject({ net: 0, level: 'ok' });
  });

  test('районы идут по убыванию спроса, при равенстве — по алфавиту', () => {
    const requests = [
      ...[1, 2, 3].map(() => request({ district: 'Невский' })),
      ...[1, 2].map(() => request({ district: 'Калининский' })),
      request({ district: 'Выборгский' }),
      request({ district: 'Адмиралтейский' }),
    ];
    const s = summary(requests, []);
    expect(s.matrix.map((r) => r.district)).toEqual(['Невский', 'Калининский', 'Адмиралтейский', 'Выборгский']);
  });

  test('район только с местами, без спроса, идёт после районов со спросом', () => {
    const s = summary([request({ district: 'Невский' })], [group({ district: 'Адмиралтейский', people: 0 })]);
    expect(s.matrix.map((r) => r.district)).toEqual(['Невский', 'Адмиралтейский']);
  });
});

describe('кластеры «не хватает группы»', () => {
  test('двое и больше без подходящих групп в районе — кластер с именами, возрастами и днями', () => {
    const a = request({ id: 101, fio: 'Петрова Мария Ивановна', ageRange: [25, 35], days: ['Чт', 'Пн'] });
    const b = request({ id: 102, fio: 'Сидоров Олег', ageRange: [45, 55], days: ['Чт'] });
    const c = request({ id: 103, fio: 'Орлова Анна', ageRange: [28, 30], days: ['Вт', 'Чт'] });
    const entries = new Map<number, PlanEntry>([[101, NOGROUP], [102, NOGROUP], [103, NOGROUP]]);
    const s = summary([c, a, b], [], entries);

    expect(s.clusters).toEqual([
      {
        district: 'Приморский',
        requestIds: [101, 102, 103],
        firstNames: ['Мария', 'Олег', 'Анна'],
        ages: ['25–40', '40–55'],
        days: ['Чт', 'Пн'],
      },
    ]);
  });

  test('имя — второе слово ФИО, а из одного слова берётся оно само', () => {
    const entries = new Map<number, PlanEntry>([[111, NOGROUP], [112, NOGROUP]]);
    const s = summary([request({ id: 111, fio: 'Кузнецов' }), request({ id: 112, fio: '  Белова   Ирина ' })], [], entries);
    expect(s.clusters[0]!.firstNames).toEqual(['Кузнецов', 'Ирина']);
  });

  test('один человек в районе — не кластер, а одиночная ситуация', () => {
    const only = request({ id: 121, fio: 'Один Иван' });
    const s = summary([only], [], new Map([[121, NOGROUP]]));
    expect(s.clusters).toEqual([]);
    expect(s.singles.map((x) => x.requestId)).toEqual([121]);
  });

  test('в кластер идут только «в районе нет групп»: места разобраны и район не распознан — нет', () => {
    const taken: PlanEntry = { kind: 'none', code: 'taken', reason: 'Свободные места разобраны другими заявками' };
    const place: PlanEntry = { kind: 'none', code: 'place', reason: 'Место не распознано' };
    const requests = [request({ id: 131 }), request({ id: 132 }), request({ id: 133, district: null })];
    const s = summary(requests, [], new Map([[131, taken], [132, taken], [133, place]]));
    expect(s.clusters).toEqual([]);
  });

  test('кластеры разных районов считаются отдельно и идут от большего к меньшему', () => {
    const requests = [
      request({ id: 141, district: 'Невский' }),
      request({ id: 142, district: 'Невский' }),
      request({ id: 143, district: 'Выборгский' }),
      request({ id: 144, district: 'Выборгский' }),
      request({ id: 145, district: 'Выборгский' }),
    ];
    const entries = new Map(requests.map((r): [number, PlanEntry] => [r.id, NOGROUP]));
    expect(summary(requests, [], entries).clusters.map((c) => [c.district, c.requestIds.length])).toEqual([
      ['Выборгский', 3],
      ['Невский', 2],
    ]);
  });

  test('дни: берутся два самых частых; если заявки без дней — пусто; возраст неизвестен — в ages не попадает', () => {
    const requests = [
      request({ id: 151, days: ['Пт'], ageRange: null }),
      request({ id: 152, days: ['Пт', 'Вт'] }),
      request({ id: 153, days: ['Вт', 'Сб'] }),
      request({ id: 154, days: ['Пт'] }),
    ];
    const entries = new Map(requests.map((r): [number, PlanEntry] => [r.id, NOGROUP]));
    const cluster = summary(requests, [], entries).clusters[0]!;
    expect(cluster.days).toEqual(['Пт', 'Вт']);
    expect(cluster.ages).toEqual(['25–40']);

    const none = [request({ id: 155 }), request({ id: 156 })];
    const emptyDays = summary(none, [], new Map(none.map((r): [number, PlanEntry] => [r.id, NOGROUP]))).clusters[0]!;
    expect(emptyDays.days).toEqual([]);
  });
});

describe('одиночные ситуации', () => {
  test('заявка без плана попадает в singles с причиной плана', () => {
    const lost = request({ id: 201, place: 'где-то на севере', district: null });
    const entry: PlanEntry = { kind: 'none', code: 'place', reason: 'Место не распознано' };
    const s = summary([lost], [], new Map([[201, entry]]));
    expect(s.singles).toEqual([{ requestId: 201, fio: lost.fio, place: 'где-то на севере', reason: 'Место не распознано' }]);
  });

  test('слабое предложение попадает в singles с причиной «Уверенность плана низкая (N)»', () => {
    const weak = request({ id: 211 });
    const s = summary([weak], [], new Map([[211, proposalWith(42)]]));
    expect(s.singles).toEqual([{ requestId: 211, fio: weak.fio, place: null, reason: 'Уверенность плана низкая (42)' }]);
  });

  test('хорошее предложение (уверенность на пороге и выше) в singles не попадает', () => {
    const s = summary([request({ id: 221 }), request({ id: 222 })], [], new Map([[221, proposalWith(60)], [222, proposalWith(95)]]));
    expect(s.singles).toEqual([]);
  });

  test('входящие в кластер в singles не повторяются', () => {
    const requests = [request({ id: 231 }), request({ id: 232 }), request({ id: 233, district: 'Невский' })];
    const s = summary(requests, [], new Map(requests.map((r): [number, PlanEntry] => [r.id, NOGROUP])));
    expect(s.clusters[0]!.requestIds).toEqual([231, 232]);
    expect(s.singles.map((x) => x.requestId)).toEqual([233]);
  });

  test('заявка без записи в плане — тоже ситуация для человека', () => {
    const s = summary([request({ id: 241 })], []);
    expect(s.singles).toEqual([{ requestId: 241, fio: expect.any(String), place: null, reason: 'План не составлен' }]);
  });
});

describe('сводка на настоящем плане', () => {
  test('без групп в районе двое оказываются кластером, а третий с хорошей группой — нет', () => {
    const near = group({ district: 'Калининский', people: 2 });
    const requests = [
      request({ id: 301, district: 'Невский' }),
      request({ id: 302, district: 'Невский' }),
      request({ id: 303, district: 'Калининский' }),
    ];
    const plan = buildPlan({ requests, groups: [near], settings });
    const s = buildTodaySummary({ requests, groups: [near], entries: plan.entries, settings });
    expect(s.clusters.map((c) => [c.district, c.requestIds])).toEqual([['Невский', [301, 302]]]);
    expect(s.singles.map((x) => x.requestId)).toEqual([]);
    expect(cellOf(s, 'Невский', '25–40')).toMatchObject({ demand: 2, supply: 0, level: 'crit' });
    expect(cellOf(s, 'Калининский', '25–40')).toMatchObject({ demand: 1, supply: 8, level: 'ok' });
  });
});
