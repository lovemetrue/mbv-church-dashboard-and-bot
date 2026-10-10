import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/home-groups/plan/settings.js';
import { NEIGHBORS } from '../src/home-groups/plan/geo.js';
import { bucketOf, buildPlan, exclusionReason, match } from '../src/home-groups/plan/engine.js';
import type {
  PlanEntry,
  PlanEntryProposal,
  PlanGroup,
  PlanRequest,
  PlanSettings,
} from '../src/home-groups/plan/types.js';

let nextGroupId = 1000;
let nextRequestId = 5000;

/** Группа, подходящая заявке по умолчанию; тесты портят по одному свойству. */
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

/** Заявка, у которой известны район и возраст — как у большинства реальных. */
const request = (patch: Partial<PlanRequest> = {}): PlanRequest => ({
  id: nextRequestId++,
  fio: 'Иванов Иван',
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

const SETTINGS = DEFAULT_SETTINGS;
const planFor = (requests: PlanRequest[], groups: PlanGroup[], settings: PlanSettings = SETTINGS) =>
  buildPlan({ requests, groups, settings });

const proposal = (entry: PlanEntry | undefined): PlanEntryProposal => {
  expect(entry?.kind).toBe('proposal');
  return entry as PlanEntryProposal;
};
/** Оценка единственного кандидата — для проверки формулы без плана. */
const scoreOf = (r: PlanRequest, g: PlanGroup, settings: PlanSettings = SETTINGS): number => {
  const ranked = match(r, [g], settings).ranked;
  expect(ranked, 'группа должна пройти отсев').toHaveLength(1);
  return ranked[0]!.score;
};
const reasonsOf = (r: PlanRequest, g: PlanGroup): string[] => match(r, [g], SETTINGS).ranked[0]!.reasons.map((x) => x.text);

describe('жёсткие отсевы группы для заявки', () => {
  const r = request();

  test('группа не в статусе «Функционирует» или «Кампания» отсеивается', () => {
    for (const status of ['На паузе', 'Закрыта', 'Потенциальная', 'Недвижимость']) {
      expect(exclusionReason(r, group({ status }), SETTINGS), status).not.toBeNull();
    }
    expect(exclusionReason(r, group({ status: 'Кампания' }), SETTINGS)).toBeNull();
    expect(exclusionReason(r, group({ status: 'Функционирует' }), SETTINGS)).toBeNull();
  });

  test('группа, закрытая для новых, отсеивается', () => {
    expect(exclusionReason(r, group({ acceptsNew: false }), SETTINGS)).toMatch(/не принимает/);
  });

  test('группа с отметкой «Не направлять» отсеивается', () => {
    expect(exclusionReason(r, group({ doNotRefer: true }), SETTINGS)).not.toBeNull();
  });

  test('заполненная группа отсеивается, а группа с одним свободным местом — нет', () => {
    expect(exclusionReason(r, group({ people: 10, capacity: 10 }), SETTINGS)).toMatch(/заполнена/);
    expect(exclusionReason(r, group({ people: 12, capacity: 10 }), SETTINGS)).toMatch(/заполнена/);
    expect(exclusionReason(r, group({ people: 9, capacity: 10 }), SETTINGS)).toBeNull();
  });

  test('число участников не указано: места считаем свободными и пишем об этом нейтральную причину', () => {
    const g = group({ people: null });
    expect(exclusionReason(r, g, SETTINGS)).toBeNull();
    const reasons = match(r, [g], SETTINGS).ranked[0]!.reasons;
    expect(reasons).toContainEqual({ tone: 'neutral', text: 'число участников не указано' });
  });

  test('непересекающиеся возрасты отсеивают, а касание на границе — нет (границы включительно)', () => {
    expect(exclusionReason(request({ ageRange: [25, 35] }), group({ ageRange: [36, 50] }), SETTINGS)).toMatch(/возраст/);
    expect(exclusionReason(request({ ageRange: [25, 35] }), group({ ageRange: [35, 50] }), SETTINGS)).toBeNull();
    expect(exclusionReason(request({ ageRange: [18, 24] }), group({ ageRange: [25, 35] }), SETTINGS)).toMatch(/возраст/);
  });

  test('возраст неизвестен у заявки или у группы — не отсев', () => {
    expect(exclusionReason(request({ ageRange: null }), group({ ageRange: [60, 70] }), SETTINGS)).toBeNull();
    expect(exclusionReason(request({ ageRange: [25, 35] }), group({ ageRange: null }), SETTINGS)).toBeNull();
  });

  test('чужой район отсеивает, соседний — нет', () => {
    const g = group({ district: 'Невский' });
    expect(exclusionReason(request({ district: 'Приморский' }), g, SETTINGS)).toMatch(/район/);
    expect(exclusionReason(request({ district: 'Красногвардейский' }), g, SETTINGS)).toBeNull();
  });

  test('соседство берётся из настроек, а не из кода', () => {
    const g = group({ district: 'Невский' });
    const custom: PlanSettings = { ...SETTINGS, neighbors: { ...NEIGHBORS, Приморский: ['Невский'] } };
    expect(exclusionReason(request({ district: 'Приморский' }), g, custom)).toBeNull();
  });

  test('район заявки неизвестен — район не отсеивает (план такой заявке всё равно не строится)', () => {
    expect(exclusionReason(request({ district: null }), group({ district: 'Невский' }), SETTINGS)).toBeNull();
  });

  test('группа с районом «Не указан» и «Онлайн» районом не отсеивается', () => {
    expect(exclusionReason(r, group({ district: 'Не указан' }), SETTINGS)).toBeNull();
    expect(exclusionReason(r, group({ district: 'Онлайн' }), SETTINGS)).toBeNull();
  });

  test('заявка, которой нужен только онлайн, не получает очных групп', () => {
    expect(exclusionReason(request({ district: 'Онлайн' }), group({ district: 'Приморский' }), SETTINGS)).toMatch(/район/);
    expect(exclusionReason(request({ district: 'Онлайн' }), group({ district: 'Онлайн' }), SETTINGS)).toBeNull();
  });

  test('отсеянные группы попадают в excluded с причиной и не попадают в ranked', () => {
    const full = group({ people: 10 });
    const ok = group();
    const result = match(r, [full, ok], SETTINGS);
    expect(result.ranked.map((x) => x.groupId)).toEqual([ok.id]);
    expect(result.excluded).toEqual([{ groupId: full.id, why: expect.stringMatching(/заполнена/) }]);
  });
});

describe('оценка совпадения: считается только по известным параметрам', () => {
  test('район и возраст совпали, остальное у заявки неизвестно → 100, как бы ни отличалась группа по дню и улице', () => {
    const r = request();
    expect(scoreOf(r, group({ day: 'Сб', slot: 'утро', street: 'Невский пр.' }))).toBe(100);
  });

  test('соседний район даёт половину веса района, остальное совпало → 80 при всех четырёх известных', () => {
    const r = request({ district: 'Красногвардейский', days: ['Чт'], slot: 'вечер', street: 'Индустриальный пр.' });
    const g = group({ district: 'Невский', street: 'Индустриальный пр.' });
    // (40×0,5 + 25 + 20 + 15) / 100
    expect(scoreOf(r, g)).toBe(80);
  });

  test('время: совпал день, но не время суток → половина веса времени', () => {
    const r = request({ days: ['Чт'], slot: 'вечер' });
    // (40 + 25 + 20×0,5) / (40 + 25 + 20) × 100 = 88,2
    expect(scoreOf(r, group({ day: 'Чт', slot: 'день' }))).toBe(88);
  });

  test('время: не совпало ничего → вес времени теряется целиком', () => {
    const r = request({ days: ['Пн'], slot: 'утро' });
    // (40 + 25) / 85 × 100 = 76,5
    expect(scoreOf(r, group({ day: 'Чт', slot: 'вечер' }))).toBe(76);
  });

  test('время: у группы времени нет вообще → нейтральные 0,5 и причина «уточнить»', () => {
    const r = request({ days: ['Чт'] });
    const g = group({ day: null, slot: null });
    expect(scoreOf(r, g)).toBe(88);
    expect(reasonsOf(r, g)).toContain('у группы не указано время');
  });

  test('время: у группы несколько дней (day = null), но вечер известен → день не штрафуется, вечер совпал', () => {
    const r = request({ days: ['Чт'], slot: 'вечер' });
    const g = group({ day: null, slot: 'вечер' });
    // день неизвестен (0,5), время суток совпало (1) → 0,75 от веса 20
    expect(scoreOf(r, g)).toBe(Math.round(((40 + 25 + 20 * 0.75) / 85) * 100));
  });

  test('улица: совпала → полный вес, другая → ноль, у группы нет → 0,5 с причиной', () => {
    const r = request({ street: 'Комендантский пр.' });
    expect(scoreOf(r, group({ street: 'комендантский пр.' }))).toBe(100);
    expect(scoreOf(r, group({ street: 'Дальняя ул.' }))).toBe(81); // 65 / 80
    const unknown = group({ street: null });
    expect(scoreOf(r, unknown)).toBe(Math.round(((65 + 7.5) / 80) * 100));
    expect(reasonsOf(r, unknown)).toContain('у группы нет улицы');
  });

  test('возраст группы неизвестен → половина веса возраста и причина', () => {
    const r = request();
    const g = group({ ageRange: null });
    expect(scoreOf(r, g)).toBe(Math.round(((40 + 12.5) / 65) * 100));
    expect(reasonsOf(r, g)).toContain('у группы не указан возраст');
  });

  test('возраст заявки неизвестен → возраст не учитывается вовсе, а не считается совпавшим', () => {
    const r = request({ ageRange: null });
    expect(scoreOf(r, group({ ageRange: [60, 70] }))).toBe(100);
    expect(reasonsOf(r, group({ ageRange: [60, 70] })).join('|')).not.toMatch(/возраст/);
  });

  test('группа без района: нейтральные 0,5 за район и причина', () => {
    const r = request();
    const g = group({ district: 'Не указан' });
    expect(scoreOf(r, g)).toBe(Math.round(((20 + 25) / 65) * 100));
    expect(match(r, [g], SETTINGS).ranked[0]!.reasons).toContainEqual({ tone: 'neutral', text: 'у группы не указан район' });
  });

  test('онлайн-группа: нейтральные 0,5 за район и причина «онлайн-группа»', () => {
    const r = request();
    const g = group({ district: 'Онлайн' });
    expect(scoreOf(r, g)).toBe(69);
    expect(reasonsOf(r, g)).toContain('онлайн-группа');
  });

  test('заявка, которой нужен онлайн, получает онлайн-группу с полным совпадением по району', () => {
    const r = request({ district: 'Онлайн' });
    const g = group({ district: 'Онлайн' });
    expect(scoreOf(r, g)).toBe(100);
    expect(match(r, [g], SETTINGS).ranked[0]!.reasons).toContainEqual({ tone: 'good', text: 'онлайн, как и просили' });
  });

  test('тот же район и соседний различаются причинами и цветом', () => {
    const same = match(request(), [group()], SETTINGS).ranked[0]!.reasons;
    expect(same).toContainEqual({ tone: 'good', text: 'тот же район' });
    const near = match(request({ district: 'Выборгский' }), [group()], SETTINGS).ranked[0]!.reasons;
    expect(near).toContainEqual({ tone: 'neutral', text: 'соседний район' });
  });

  test('веса берутся из настроек: обнулив вес района, получаем оценку только по возрасту', () => {
    const custom: PlanSettings = { ...SETTINGS, weights: { district: 0, age: 10, time: 0, street: 0 } };
    const r = request({ district: 'Красногвардейский' });
    expect(scoreOf(r, group({ district: 'Невский' }), custom)).toBe(100);
  });
});

describe('поправки к оценке', () => {
  const r = request();

  test('подтверждение старше staleDays снижает оценку на stalePenalty и объясняется', () => {
    const g = group({ verifiedDaysAgo: 31 });
    expect(scoreOf(r, g)).toBe(95);
    expect(match(r, [g], SETTINGS).ranked[0]!.reasons).toContainEqual({ tone: 'neutral', text: 'не проверялась 31 дн.' });
  });

  test('ровно staleDays дней — ещё без штрафа', () => {
    expect(scoreOf(r, group({ verifiedDaysAgo: 30 }))).toBe(100);
  });

  test('обратной связи не было вообще — штрафа нет, причина серая «обратной связи нет»', () => {
    const g = group({ verifiedDaysAgo: null });
    expect(scoreOf(r, g)).toBe(100);
    expect(match(r, [g], SETTINGS).ranked[0]!.reasons).toContainEqual({ tone: 'plain', text: 'обратной связи нет' });
  });

  test('одно свободное место снижает оценку на lastSeatPenalty, два — нет', () => {
    const last = group({ people: 9 });
    expect(scoreOf(r, last)).toBe(97);
    expect(reasonsOf(r, last)).toContain('почти заполнена');
    expect(scoreOf(r, group({ people: 8 }))).toBe(100);
  });

  test('обе поправки складываются', () => {
    expect(scoreOf(r, group({ people: 9, verifiedDaysAgo: 90 }))).toBe(92);
  });

  test('оценка не уходит ниже нуля', () => {
    // Заявка с единственным известным параметром — улицей, не совпавшей; штраф «устаревшей» не должен дать минус.
    const lonely = request({ district: null, ageRange: null, street: 'А ул.' });
    expect(scoreOf(lonely, group({ street: 'Б ул.', verifiedDaysAgo: 100 }))).toBe(0);
  });
});

describe('план на всю очередь: последнее место и две заявки', () => {
  /** Группа А с одним свободным местом подходит обеим заявкам, но «трудной» — только она. */
  const A = group({ id: 1, ageRange: [25, 45], people: 9, capacity: 10 });
  // B в соседнем районе: для «лёгкой» заявки А лучше по оценке, и вытеснение видно.
  const B = group({ id: 2, district: 'Выборгский', ageRange: [40, 60], people: 2, capacity: 10 });

  test('место получает заявка с единственным вариантом, а вытесненной объясняют, кто его занял', () => {
    // У R2 меньший id, но вариантов больше: порядок обработки определяет число вариантов, не id.
    const hard = request({ id: 20, fio: 'Трудная Тамара', ageRange: [30, 35] });
    const easy = request({ id: 10, fio: 'Лёгкий Леонид', ageRange: [40, 45] });
    const plan = planFor([easy, hard], [A, B]);

    expect(proposal(plan.entries.get(20)).main.groupId).toBe(1);
    const second = proposal(plan.entries.get(10));
    expect(second.main.groupId).toBe(2);
    expect(second.displaced).toEqual({ groupId: 1, takenBy: ['Трудная Тамара'] });
    expect(plan.takenBy.get(1)).toEqual([20]);
    expect(plan.takenBy.get(2)).toEqual([10]);
  });

  test('при равном числе вариантов место получает заявка с лучшим совпадением', () => {
    const g = group({ id: 3, street: 'Комендантский пр.', people: 9, capacity: 10 });
    const close = request({ id: 31, fio: 'Близкая', street: 'Комендантский пр.' });
    const far = request({ id: 30, fio: 'Дальняя', street: 'Другая ул.' });
    const plan = planFor([far, close], [g]);

    expect(proposal(plan.entries.get(31)).main.groupId).toBe(3);
    expect(plan.entries.get(30)).toEqual({
      kind: 'none',
      code: 'taken',
      reason: 'Свободные места разобраны другими заявками',
    });
  });

  test('при полном равенстве побеждает меньший id заявки: результат не зависит от порядка во входе', () => {
    const g = group({ id: 4, people: 9, capacity: 10 });
    const a = request({ id: 41 });
    const b = request({ id: 40 });
    expect(planFor([a, b], [g]).takenBy.get(4)).toEqual([40]);
    expect(planFor([b, a], [g]).takenBy.get(4)).toEqual([40]);
  });

  test('одинаковые группы различаются по id, а не по порядку во входе', () => {
    const late = group({ id: 9, people: 3 });
    const early = group({ id: 3, people: 3 });
    const r = request({ id: 90 });
    expect(match(r, [late, early], SETTINGS).ranked.map((c) => c.groupId)).toEqual([3, 9]);
    expect(match(r, [early, late], SETTINGS).ranked.map((c) => c.groupId)).toEqual([3, 9]);
    for (const input of [[late, early], [early, late]]) {
      const entry = proposal(planFor([r], input).entries.get(90));
      expect(entry.main.groupId).toBe(3);
      expect(entry.alternatives.map((a) => a.groupId)).toEqual([9]);
    }
  });

  test('вытесненной не бывает, если лучшая группа осталась свободной', () => {
    const lone = request();
    const plan = planFor([lone], [A, B]);
    expect(proposal(plan.entries.get(lone.id)).displaced).toBeNull();
  });
});

describe('план: выбор группы', () => {
  test('из близких по оценке побеждает менее заполненная группа', () => {
    const crowded = group({ id: 50, people: 8, capacity: 12 });
    const roomy = group({ id: 51, people: 2, capacity: 12 });
    const r = request();
    expect(proposal(planFor([r], [crowded, roomy]).entries.get(r.id)).main.groupId).toBe(51);
  });

  test('заметно лучшее совпадение важнее наполненности', () => {
    const better = group({ id: 52, people: 8, capacity: 12, street: 'Комендантский пр.' });
    const emptier = group({ id: 53, people: 1, capacity: 12, street: 'Другая ул.' });
    const r = request({ street: 'Комендантский пр.' });
    expect(proposal(planFor([r], [emptier, better]).entries.get(r.id)).main.groupId).toBe(52);
  });

  test('выбор человека (pinnedGroupId) побеждает, пока в его группе есть место', () => {
    const best = group({ id: 54, people: 0 });
    const pinned = group({ id: 55, people: 6 });
    const r = request({ pinnedGroupId: 55 });
    const entry = proposal(planFor([r], [best, pinned]).entries.get(r.id));
    expect(entry.main.groupId).toBe(55);
    expect(entry.alternatives.map((a) => a.groupId)).toEqual([54]);
  });

  test('выбор человека игнорируется, если группа уже не подходит или заполнена', () => {
    const best = group({ id: 56, people: 0 });
    const full = group({ id: 57, people: 10 });
    const r = request({ pinnedGroupId: 57 });
    expect(proposal(planFor([r], [best, full]).entries.get(r.id)).main.groupId).toBe(56);
  });

  test('запасных вариантов не больше двух, главный среди них не повторяется', () => {
    const groups = [1, 2, 3, 4].map((n) => group({ id: 60 + n, people: n }));
    const r = request();
    const entry = proposal(planFor([r], groups).entries.get(r.id));
    expect(entry.alternatives).toHaveLength(2);
    expect(entry.alternatives.map((a) => a.groupId)).not.toContain(entry.main.groupId);
  });

  test('запасные берутся только из групп, где ещё есть место', () => {
    const r1 = request({ id: 70, fio: 'Первая Пётр', ageRange: [30, 35] });
    const r2 = request({ id: 71, fio: 'Вторая Анна', ageRange: [30, 35] });
    // «only» лучше по району, но в нём одно место; «other» — в соседнем районе.
    const only = group({ id: 72, people: 9, capacity: 10 });
    const other = group({ id: 73, district: 'Выборгский', people: 0 });
    const plan = planFor([r1, r2], [only, other]);

    const first = proposal(plan.entries.get(70));
    expect(first.main.groupId).toBe(72);
    expect(first.alternatives.map((a) => a.groupId)).toEqual([73]);
    const second = proposal(plan.entries.get(71));
    expect(second.main.groupId).toBe(73);
    expect(second.alternatives).toEqual([]);
    expect(second.displaced).toEqual({ groupId: 72, takenBy: ['Первая Пётр'] });
  });

  test('у предложения есть причины и число известных параметров', () => {
    const r = request({ days: ['Чт'], slot: 'вечер' });
    const entry = proposal(planFor([r], [group()]).entries.get(r.id));
    expect(entry.knownParams).toBe(3);
    expect(entry.main.reasons.length).toBeGreaterThan(0);
    expect(entry.main.score).toBe(100);
  });
});

describe('план: пропущенные параметры', () => {
  const g = group({ id: 80, day: 'Чт', slot: 'вечер', street: 'Комендантский пр.', people: 0, capacity: 30 });

  test('заявка без дня, времени и улицы получает план по району и возрасту', () => {
    const r = request({ id: 81 });
    const entry = proposal(planFor([r], [g]).entries.get(81));
    expect(entry.main.groupId).toBe(80);
    expect(entry.knownParams).toBe(2);
  });

  test('при том же совпадении уверенность у неполной заявки ниже, чем у полной', () => {
    const full = request({ id: 82, days: ['Чт'], slot: 'вечер', street: 'Комендантский пр.' });
    const part = request({ id: 83 });
    const plan = planFor([full, part], [g]);
    const fullEntry = proposal(plan.entries.get(82));
    const partEntry = proposal(plan.entries.get(83));
    expect(fullEntry.main.score).toBe(100);
    expect(partEntry.main.score).toBe(100);
    expect(fullEntry.knownParams).toBe(4);
    expect(fullEntry.confidence).toBe(100);
    expect(partEntry.confidence).toBeLessThan(fullEntry.confidence);
    // 100 × (0,55 + 0,45 × 2/4) = 77,5
    expect(partEntry.confidence).toBe(78);
  });

  test('формула уверенности берёт пол и размах из настроек', () => {
    const custom: PlanSettings = { ...SETTINGS, confidenceFloor: 0.5, confidenceSpan: 0.5 };
    const r = request({ id: 84, days: ['Чт'] });
    // известно 3 из 4: 100 × (0,5 + 0,5 × 3/4) = 87,5
    expect(proposal(planFor([r], [g], custom).entries.get(84)).confidence).toBe(88);
  });

  test('возраст заявки неизвестен: план строится по району, а уверенность падает', () => {
    const r = request({ id: 85, ageRange: null });
    const entry = proposal(planFor([r], [g]).entries.get(85));
    expect(entry.knownParams).toBe(1);
    expect(entry.confidence).toBe(Math.round(100 * (0.55 + 0.45 * 0.25)));
  });
});

describe('план: заявки без плана', () => {
  test('район не распознан → «Место не распознано» с кодом place, группы не расходуются', () => {
    const lost = request({ id: 90, district: null, place: 'где-то на севере' });
    const found = request({ id: 91, fio: 'Нашёлся' });
    const g = group({ id: 92, people: 9, capacity: 10 });
    const plan = planFor([lost, found], [g]);
    expect(plan.entries.get(90)).toEqual({ kind: 'none', code: 'place', reason: 'Место не распознано' });
    expect(proposal(plan.entries.get(91)).main.groupId).toBe(92);
  });

  test('в районе нет подходящих групп → nogroup', () => {
    const r = request({ id: 93, district: 'Московский' });
    const plan = planFor([r], [group({ district: 'Приморский' })]);
    expect(plan.entries.get(93)).toEqual({
      kind: 'none',
      code: 'nogroup',
      reason: 'В районе нет групп, подходящих по возрасту',
    });
  });

  test('подходящие группы есть, но места разобраны другими → taken', () => {
    const g = group({ id: 94, people: 9, capacity: 10 });
    const plan = planFor([request({ id: 95 }), request({ id: 96 })], [g]);
    expect(plan.entries.get(96)).toMatchObject({ kind: 'none', code: 'taken' });
  });

  test('пустые входы не ломают движок', () => {
    expect(planFor([], []).entries.size).toBe(0);
    expect(planFor([request({ id: 97 })], []).entries.get(97)).toMatchObject({ code: 'nogroup' });
  });

  test('у каждой заявки из входа есть запись в плане', () => {
    const requests = [request({ id: 98 }), request({ id: 99, district: null }), request({ id: 100, district: 'Курортный' })];
    const plan = planFor(requests, [group()]);
    expect([...plan.entries.keys()].sort((a, b) => a - b)).toEqual([98, 99, 100]);
  });
});

describe('план: отказы из обзвона', () => {
  test('отклонённая группа не предлагается снова, берётся следующая', () => {
    const first = group({ id: 110, people: 0 });
    const second = group({ id: 111, people: 4 });
    const r = request({ id: 112, rejectedGroupIds: [110] });
    expect(proposal(planFor([r], [first, second]).entries.get(112)).main.groupId).toBe(111);
  });

  test('отклонённая группа не попадает и в запасные', () => {
    const groups = [group({ id: 113 }), group({ id: 114 }), group({ id: 115 })];
    const r = request({ id: 116, rejectedGroupIds: [113] });
    const entry = proposal(planFor([r], groups).entries.get(116));
    const all = [entry.main.groupId, ...entry.alternatives.map((a) => a.groupId)];
    expect(all).not.toContain(113);
  });

  test('«другой день»: группы с нежелательным днём исключаются', () => {
    const thu = group({ id: 117, day: 'Чт', people: 0 });
    const fri = group({ id: 118, day: 'Пт', people: 6 });
    const r = request({ id: 119, avoidDays: ['Чт'] });
    expect(proposal(planFor([r], [thu, fri]).entries.get(119)).main.groupId).toBe(118);
  });

  test('«другое время»: группы с нежелательным временем суток исключаются', () => {
    const evening = group({ id: 120, slot: 'вечер', people: 0 });
    const day = group({ id: 121, slot: 'день', people: 6 });
    const r = request({ id: 122, avoidSlots: ['вечер'] });
    expect(proposal(planFor([r], [evening, day]).entries.get(122)).main.groupId).toBe(121);
  });

  test('группа без дня не исключается нежеланием дня: неизвестное не равно нежелательному', () => {
    const floating = group({ id: 123, day: null });
    const r = request({ id: 124, avoidDays: ['Чт'] });
    expect(proposal(planFor([r], [floating]).entries.get(124)).main.groupId).toBe(123);
  });

  test('отклонены все подходящие группы → nogroup, а не taken', () => {
    const only = group({ id: 125 });
    const r = request({ id: 126, rejectedGroupIds: [125] });
    expect(planFor([r], [only]).entries.get(126)).toMatchObject({ kind: 'none', code: 'nogroup' });
  });

  test('отказ одной заявки освобождает место другой', () => {
    const g = group({ id: 127, people: 9, capacity: 10 });
    const refuses = request({ id: 128, rejectedGroupIds: [127] });
    const takes = request({ id: 129 });
    const plan = planFor([refuses, takes], [g]);
    expect(proposal(plan.entries.get(129)).main.groupId).toBe(127);
    expect(plan.entries.get(128)).toMatchObject({ kind: 'none' });
  });
});

describe('план: детерминированность и вместимость', () => {
  /** Простой воспроизводимый генератор: тест не должен зависеть от Math.random. */
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const shuffle = <T,>(rand: () => number, list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  const DISTRICT_POOL = ['Приморский', 'Выборгский', 'Калининский', 'Онлайн', 'Не указан'] as const;
  const AGES: PlanGroup['ageRange'][] = [null, [18, 25], [25, 35], [35, 50], [50, 60], [65, 120]];

  function scenario(seed: number) {
    const rand = rng(seed);
    const groups: PlanGroup[] = Array.from({ length: 2 + Math.floor(rand() * 6) }, (_, i) =>
      group({
        id: i + 1,
        district: pick(rand, DISTRICT_POOL),
        ageRange: pick(rand, AGES),
        day: pick(rand, ['Пн', 'Чт', 'Пт', null] as const),
        slot: pick(rand, ['утро', 'день', 'вечер', null] as const),
        street: pick(rand, ['Невский пр.', 'Лиговский пр.', null]),
        people: pick(rand, [null, 0, 3, 8, 9, 10, 12]),
        capacity: pick(rand, [4, 10, 12]),
        verifiedDaysAgo: pick(rand, [null, 3, 45]),
        status: pick(rand, ['Функционирует', 'Функционирует', 'Функционирует', 'Кампания', 'На паузе']),
        acceptsNew: rand() > 0.15,
        doNotRefer: rand() > 0.9,
      }),
    );
    const requests: PlanRequest[] = Array.from({ length: 3 + Math.floor(rand() * 12) }, (_, i) =>
      request({
        id: 100 + i,
        fio: `Фамилия${i} Имя${i}`,
        ageRange: pick(rand, AGES),
        district: pick(rand, [...DISTRICT_POOL.slice(0, 4), null]),
        days: pick<PlanRequest['days']>(rand, [[], ['Чт'], ['Пн', 'Пт']]),
        slot: pick(rand, [null, 'вечер', 'день'] as const),
        street: pick(rand, [null, 'Невский пр.']),
        rejectedGroupIds: rand() > 0.8 ? [pick(rand, groups).id] : [],
        avoidDays: rand() > 0.9 ? ['Чт'] : [],
        pinnedGroupId: rand() > 0.9 ? pick(rand, groups).id : null,
      }),
    );
    return { groups, requests, rand };
  }

  const canon = (plan: ReturnType<typeof planFor>) => ({
    entries: [...plan.entries].sort(([a], [b]) => a - b),
    takenBy: [...plan.takenBy].sort(([a], [b]) => a - b),
  });

  test('любая перестановка заявок и групп во входе даёт тот же план (300 случайных сценариев)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { groups, requests, rand } = scenario(seed);
      const base = canon(planFor(requests, groups));
      const shuffled = canon(planFor(shuffle(rand, requests), shuffle(rand, groups)));
      expect(shuffled, `seed ${seed}`).toEqual(base);
    }
  });

  test('ни одна группа не получает больше заявок, чем у неё свободных мест (300 случайных сценариев)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { groups, requests } = scenario(seed);
      const plan = planFor(requests, groups);
      for (const g of groups) {
        const free = Math.max(0, g.capacity - (g.people ?? 0));
        expect(plan.takenBy.get(g.id)?.length ?? 0, `seed ${seed}, группа ${g.id}`).toBeLessThanOrEqual(free);
      }
    }
  });

  test('каждая заявка получает ровно одну запись, а takenBy согласован с предложениями (300 сценариев)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { groups, requests } = scenario(seed);
      const plan = planFor(requests, groups);
      expect(plan.entries.size, `seed ${seed}`).toBe(requests.length);
      for (const [groupId, ids] of plan.takenBy) {
        for (const id of ids) expect(proposal(plan.entries.get(id)).main.groupId).toBe(groupId);
      }
      const proposals = [...plan.entries.values()].filter((e) => e.kind === 'proposal').length;
      expect([...plan.takenBy.values()].flat()).toHaveLength(proposals);
    }
  });

  test('повторный запуск на тех же данных даёт тот же план, а вход не изменяется', () => {
    const { groups, requests } = scenario(7);
    const before = structuredClone({ groups, requests });
    const a = canon(planFor(requests, groups));
    const b = canon(planFor(requests, groups));
    expect(b).toEqual(a);
    expect({ groups, requests }).toEqual(before);
  });
});

describe('bucketOf', () => {
  const settings = SETTINGS;
  const entry = (confidence: number): PlanEntry => ({
    kind: 'proposal',
    main: { groupId: 1, score: confidence, reasons: [] },
    confidence,
    knownParams: 4,
    alternatives: [],
    displaced: null,
  });

  test('«Исполнена» — done, «Аннулирована» — cancelled, независимо от плана', () => {
    expect(bucketOf({ status: 'Исполнена', entry: entry(90), callback: false, settings })).toBe('done');
    expect(bucketOf({ status: 'Исполнена', entry: undefined, callback: true, settings })).toBe('done');
    expect(bucketOf({ status: 'Аннулирована', entry: undefined, callback: false, settings })).toBe('cancelled');
    expect(bucketOf({ status: 'Аннулирована', entry: entry(10), callback: true, settings })).toBe('cancelled');
  });

  test('нет записи в плане или плана-предложения нет — human', () => {
    expect(bucketOf({ status: 'В работе', entry: undefined, callback: false, settings })).toBe('human');
    const none: PlanEntry = { kind: 'none', code: 'place', reason: 'Место не распознано' };
    expect(bucketOf({ status: 'В работе', entry: none, callback: false, settings })).toBe('human');
    expect(bucketOf({ status: 'В работе', entry: none, callback: true, settings })).toBe('human');
  });

  test('уверенность ниже порога — human, ровно на пороге — ready', () => {
    expect(bucketOf({ status: 'Новая', entry: entry(59), callback: false, settings })).toBe('human');
    expect(bucketOf({ status: 'Новая', entry: entry(60), callback: false, settings })).toBe('ready');
  });

  test('порог берётся из настроек', () => {
    const strict = { ...settings, humanThreshold: 80 };
    expect(bucketOf({ status: 'Новая', entry: entry(70), callback: false, settings: strict })).toBe('human');
  });

  test('хороший план и флаг «перезвонить» — callback, без флага — ready', () => {
    expect(bucketOf({ status: 'В работе', entry: entry(85), callback: true, settings })).toBe('callback');
    expect(bucketOf({ status: 'В работе', entry: entry(85), callback: false, settings })).toBe('ready');
  });

  test('слабый план при флаге «перезвонить» остаётся human: сначала нужно найти группу', () => {
    expect(bucketOf({ status: 'В работе', entry: entry(40), callback: true, settings })).toBe('human');
  });
});
