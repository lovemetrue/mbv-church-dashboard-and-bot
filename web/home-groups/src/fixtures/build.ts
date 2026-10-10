/**
 * Сборка представлений контракта из сырых данных (raw.ts) для режима фикстур.
 *
 * Это НЕ серверный движок подбора, а упрощённая копия его идей: нужна только затем, чтобы
 * счётчики, матрица, корзины и карточки в демо-данных сходились между собой. Если сервер
 * считает иначе, правда — на сервере.
 */
import type {
  Bucket,
  Candidate,
  CellLevel,
  Cluster,
  CoordinatorItem,
  CoordinatorsView,
  Counters,
  GroupBrief,
  GroupItem,
  GroupsView,
  HealthItem,
  MatrixRow,
  NoPlan,
  PeopleView,
  PersonItem,
  Proposal,
  Reason,
  RequestItem,
  RequestsView,
  Single,
  TodayView,
} from '@contracts';
import {
  AGE_COLUMNS,
  COORDINATOR_ROLES,
  DISTRICTS,
  GENERATED_AT,
  NEIGHBORS,
  RAW_EXTRA_PEOPLE,
  RAW_GROUPS,
  RAW_REQUESTS,
  SERVANTS,
  type RawGroup,
  type RawRequest,
} from './raw';

const DEFAULT_CAPACITY = 10;
const WEIGHTS = { district: 40, age: 25, time: 20, street: 15 };
/** Порог уверенности, ниже которого заявка уходит в «Нужна помощь». */
const CONFIDENCE_THRESHOLD = 60;

const capOf = (g: RawGroup): number => g.capacity ?? DEFAULT_CAPACITY;
const freeOf = (g: RawGroup): number => Math.max(0, capOf(g) - (g.people ?? 0));
const accepting = (g: RawGroup): boolean => g.status === 'Функционирует' && g.acceptsNew && !g.doNotRefer;

export function groupBrief(g: RawGroup): GroupBrief {
  return {
    id: g.id,
    no: g.no,
    code: `ДГ-${String(g.no ?? 100 + g.id).padStart(4, '0')}`,
    leader: g.leader,
    district: g.district,
    metro: g.metro,
    whenText: g.day ? (g.slot ? `${g.day}, ${g.slot}` : g.day) : null,
    people: g.people,
    capacity: capOf(g),
    free: freeOf(g),
    format: g.format,
  };
}

interface Scored {
  g: RawGroup;
  score: number;
  reasons: Reason[];
}

interface Known {
  district: boolean;
  age: boolean;
  time: boolean;
  street: boolean;
}

function knownOf(r: RawRequest): Known {
  return { district: !!r.district, age: !!r.age, time: r.days.length > 0 || !!r.slot, street: !!r.street };
}
const knownCount = (k: Known): number => Object.values(k).filter(Boolean).length;

/** Оценка всех подходящих групп для заявки; параметры, которых нет у человека, не учитываются. */
function rank(r: RawRequest, groups: RawGroup[]): Scored[] {
  const known = knownOf(r);
  const out: Scored[] = [];
  for (const g of groups) {
    if (!accepting(g) || freeOf(g) <= 0) continue;
    if (!g.ages.includes(r.age)) continue;
    let dist = 0;
    if (known.district) {
      if (g.district === r.district) dist = 1;
      else if ((NEIGHBORS[r.district ?? ''] ?? []).includes(g.district)) dist = 0.5;
      else continue;
    }
    const reasons: Reason[] = [];
    let sum = 0;
    let wsum = 0;
    if (known.district) {
      sum += WEIGHTS.district * dist;
      wsum += WEIGHTS.district;
      reasons.push(dist === 1 ? { tone: 'good', text: 'тот же район' } : { tone: 'neutral', text: 'соседний район' });
    }
    sum += WEIGHTS.age;
    wsum += WEIGHTS.age;
    reasons.push({ tone: 'good', text: 'возраст подходит' });
    if (known.time) {
      let s: number;
      if (!g.day) {
        s = 0.5;
        reasons.push({ tone: 'neutral', text: 'у группы не указано время' });
      } else {
        const parts: number[] = [];
        if (r.days.length) parts.push(r.days.includes(g.day) ? 1 : 0);
        if (r.slot) parts.push(r.slot === g.slot ? 1 : 0);
        s = parts.reduce((a, b) => a + b, 0) / parts.length;
        const when = `${g.day}, ${g.slot ?? ''}`.replace(/, $/, '');
        reasons.push({
          tone: s === 1 ? 'good' : s > 0 ? 'neutral' : 'bad',
          text: s === 1 ? `время совпало: ${when}` : s > 0 ? `время частично: ${when}` : `время не совпало: ${when}`,
        });
      }
      sum += WEIGHTS.time * s;
      wsum += WEIGHTS.time;
    }
    if (known.street) {
      let s: number;
      if (!g.street) {
        s = 0.5;
        reasons.push({ tone: 'neutral', text: 'у группы нет улицы' });
      } else if (g.street === r.street) {
        s = 1;
        reasons.push({ tone: 'good', text: 'та же улица' });
      } else {
        s = 0;
        reasons.push({ tone: 'plain', text: 'другая улица' });
      }
      sum += WEIGHTS.street * s;
      wsum += WEIGHTS.street;
    }
    let score = (sum / wsum) * 100;
    if ((g.verifiedDaysAgo ?? 999) > 30) {
      score -= 5;
      reasons.push({
        tone: 'neutral',
        text: g.verifiedDaysAgo == null ? 'не проверялась' : `не проверялась ${g.verifiedDaysAgo} дн.`,
      });
    }
    if (freeOf(g) <= 1) {
      score -= 3;
      reasons.push({ tone: 'neutral', text: 'почти заполнена' });
    }
    out.push({ g, score: Math.max(0, Math.round(score)), reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

const toCandidate = (s: Scored, confidence: number | null): Candidate => ({
  group: groupBrief(s.g),
  score: s.score,
  confidence,
  reasons: s.reasons,
});

interface PlanEntry {
  proposal: Proposal | null;
  noPlan: NoPlan | null;
  responsible: string;
}

interface Plan {
  byRequest: Map<number, PlanEntry>;
  takenBy: Map<number, number[]>;
}

const isOpen = (r: RawRequest): boolean => !r.cancelled && r.status !== 'Исполнена';

/** План на всю очередь: сначала заявки с наименьшим числом вариантов, место отдаём по очереди. */
export function buildPlan(requests: RawRequest[] = RAW_REQUESTS, groups: RawGroup[] = RAW_GROUPS): Plan {
  const remaining = new Map(groups.map((g) => [g.id, freeOf(g)]));
  const open = requests.filter(isOpen);
  const info = open.map((r) => ({ r, ranked: rank(r, groups) }));
  info.sort(
    (a, b) => a.ranked.length - b.ranked.length || (b.ranked[0]?.score ?? 0) - (a.ranked[0]?.score ?? 0),
  );
  const byRequest = new Map<number, PlanEntry>();
  const takenBy = new Map<number, number[]>();
  const names = new Map(requests.map((r) => [r.id, r.fio]));

  for (const { r, ranked } of info) {
    if (!r.district) {
      byRequest.set(r.id, {
        proposal: null,
        noPlan: { code: 'place', reason: 'Место не распознано' },
        responsible: '',
      });
      continue;
    }
    const avail = ranked.filter((c) => (remaining.get(c.g.id) ?? 0) > 0);
    if (!avail.length) {
      const taken = ranked.length > 0;
      byRequest.set(r.id, {
        proposal: null,
        noPlan: {
          code: taken ? 'taken' : 'nogroup',
          reason: taken
            ? 'Свободные места разобраны другими заявками'
            : 'В районе нет групп, подходящих по возрасту',
        },
        responsible: '',
      });
      continue;
    }
    // Чуть предпочитаем менее заполненную группу при близких оценках.
    const adj = (c: Scored) => c.score + (1 - (c.g.people ?? 0) / capOf(c.g)) * 6;
    const sorted = [...avail].sort((a, b) => adj(b) - adj(a));
    const pick = sorted[0]!;
    remaining.set(pick.g.id, (remaining.get(pick.g.id) ?? 0) - 1);
    takenBy.set(pick.g.id, [...(takenBy.get(pick.g.id) ?? []), r.id]);

    const best = ranked[0]!;
    let displaced: Proposal['displaced'] = null;
    if (best.g.id !== pick.g.id && (remaining.get(best.g.id) ?? 0) <= 0) {
      displaced = {
        group: groupBrief(best.g),
        takenBy: (takenBy.get(best.g.id) ?? []).map((id) => names.get(id) ?? ''),
      };
    }
    const kn = knownCount(knownOf(r));
    const confidence = Math.round(pick.score * (0.55 + 0.45 * (kn / 4)));
    byRequest.set(r.id, {
      proposal: {
        main: toCandidate(pick, confidence),
        knownParams: kn,
        alternatives: sorted.slice(1, 3).map((c) => toCandidate(c, null)),
        displaced,
      },
      noPlan: null,
      responsible: '',
    });
  }

  // Ответственный назначается по нагрузке.
  const load = new Map(SERVANTS.map((s) => [s, 0]));
  [...open]
    .sort((a, b) => a.id - b.id)
    .forEach((r) => {
      const who = [...SERVANTS].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]!;
      load.set(who, (load.get(who) ?? 0) + 1);
      const entry = byRequest.get(r.id);
      if (entry) entry.responsible = who;
    });
  return { byRequest, takenBy };
}

function bucketOf(r: RawRequest, entry: PlanEntry | undefined): Bucket {
  if (r.cancelled) return 'cancelled';
  if (r.status === 'Исполнена') return 'done';
  const p = entry?.proposal;
  if (!p || (p.main.confidence ?? 0) < CONFIDENCE_THRESHOLD) return 'human';
  return r.callback ? 'callback' : 'ready';
}

const BUCKET_ORDER: Record<Bucket, number> = { callback: 0, ready: 1, human: 2, done: 3, cancelled: 4 };

function countersOf(items: { bucket: Bucket }[]): Counters {
  const c: Counters = { ready: 0, callback: 0, human: 0, done: 0, cancelled: 0 };
  for (const it of items) c[it.bucket]++;
  return c;
}

export function buildRequests(): RequestsView {
  const plan = buildPlan();
  const all: RequestItem[] = RAW_REQUESTS.map((r) => {
    const entry = plan.byRequest.get(r.id);
    const fin = r.finalGroupId != null ? RAW_GROUPS.find((x) => x.id === r.finalGroupId) : undefined;
    return {
      id: r.id,
      fio: r.fio,
      phone: r.phone,
      ageLabel: r.ageLabel,
      place: r.place,
      district: r.district,
      days: r.days,
      slot: r.slot,
      street: r.street,
      source: r.source,
      status: r.status,
      bucket: bucketOf(r, entry),
      waitingDays: r.waitingDays,
      dataFill: [!!r.district, !!r.age, r.days.length > 0 || !!r.slot, !!r.street],
      proposal: entry?.proposal ?? null,
      noPlan: entry?.noPlan ?? null,
      finalGroup: fin ? groupBrief(fin) : null,
      finalGroupText: r.finalGroupText,
      responsible: entry?.responsible || null,
      note: r.note,
      log: r.log,
    };
  });
  const counters = countersOf(all);
  const items = all
    .filter((x) => x.bucket !== 'cancelled')
    .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);
  return { generatedAt: GENERATED_AT, items, counters };
}

export function buildToday(): TodayView {
  const { items, counters } = buildRequests();
  const open = items.filter((i) => i.bucket !== 'done');

  const matrix: MatrixRow[] = DISTRICTS.map((district) => ({
    district,
    cells: AGE_COLUMNS.map((age) => {
      const demand = open.filter((r) => r.district === district && ageKey(r.ageLabel) === age).length;
      const supply = RAW_GROUPS.filter((g) => g.district === district && accepting(g) && g.ages.includes(age)).reduce(
        (s, g) => s + freeOf(g),
        0,
      );
      const net = supply - demand;
      const level: CellLevel =
        demand > 0 && supply === 0 ? 'crit' : net < 0 ? 'warn' : supply === 0 && demand === 0 ? 'zero' : 'ok';
      return { age, demand, supply, net, level };
    }),
  }));

  const noGroup = open.filter((r) => r.noPlan?.code === 'nogroup' && r.district);
  const byDistrict = new Map<string, RequestItem[]>();
  for (const r of noGroup) byDistrict.set(r.district!, [...(byDistrict.get(r.district!) ?? []), r]);
  const clusters: Cluster[] = [];
  const inCluster = new Set<number>();
  for (const [district, list] of byDistrict) {
    if (list.length < 2) continue;
    list.forEach((r) => inCluster.add(r.id));
    const dayCount = new Map<string, number>();
    list.forEach((r) => r.days.forEach((d) => dayCount.set(d, (dayCount.get(d) ?? 0) + 1)));
    clusters.push({
      district,
      requestIds: list.map((r) => r.id),
      firstNames: list.map((r) => r.fio.split(' ')[0] ?? r.fio),
      ages: [...new Set(list.map((r) => ageKey(r.ageLabel) ?? r.ageLabel ?? ''))].sort(),
      days: [...dayCount.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 2),
    });
  }
  const singles: Single[] = items
    .filter((r) => r.bucket === 'human' && !inCluster.has(r.id))
    .map((r) => ({
      requestId: r.id,
      fio: r.fio,
      place: r.place,
      reason: r.noPlan?.reason ?? 'Уверенного варианта нет',
    }));

  return {
    generatedAt: GENERATED_AT,
    counters,
    assigned: counters.ready + counters.callback + counters.done,
    total: items.length,
    ageColumns: AGE_COLUMNS,
    matrix,
    clusters,
    singles,
  };
}

/** Подпись возраста из заявки приводим к столбцу матрицы: «35-45 лет» → «36–45». */
function ageKey(label: string | null): string | null {
  if (!label) return null;
  const raw = RAW_REQUESTS.find((r) => r.ageLabel === label);
  return raw ? raw.age : AGE_COLUMNS.includes(label) ? label : null;
}

function healthOf(g: RawGroup): { score: number; items: HealthItem[] } {
  const items: HealthItem[] = [
    { ok: !!g.leader, label: 'Ведущий указан', points: 10 },
    { ok: !!g.phone, label: 'Телефон ведущего', points: 15 },
    { ok: !!(g.day && g.slot), label: 'День и время', points: 20 },
    { ok: !!g.street, label: 'Улица для подбора рядом', points: 15 },
    {
      ok: g.verifiedDaysAgo != null && g.verifiedDaysAgo <= 30,
      label:
        'Подтверждена ведущим за 30 дней' +
        (g.verifiedDaysAgo != null && g.verifiedDaysAgo > 30 ? ` (было ${g.verifiedDaysAgo} дн. назад)` : ''),
      points: 30,
    },
    { ok: g.capacity != null, label: 'Вместимость указана', points: 10 },
  ];
  return { score: items.reduce((a, i) => a + (i.ok ? i.points : 0), 0), items };
}

export function buildGroups(): GroupsView {
  const plan = buildPlan();
  const requests = buildRequests().items;
  const items: GroupItem[] = RAW_GROUPS.map((g) => ({
    ...groupBrief(g),
    coLeader: g.coLeader,
    phone: g.phone,
    ageText: g.ages.join(', '),
    day: g.day,
    slot: g.slot,
    status: g.status,
    acceptsNew: g.acceptsNew,
    doNotRefer: g.doNotRefer,
    composition: g.composition,
    coordinator: g.coordinator,
    verifiedDaysAgo: g.verifiedDaysAgo,
    comment: g.comment,
    health: healthOf(g),
    plannedRequests: (plan.takenBy.get(g.id) ?? []).map((id) => {
      const req = requests.find((x) => x.id === id)!;
      return {
        id,
        fio: req.fio,
        ageLabel: req.ageLabel,
        place: req.place,
        confidence: req.proposal?.main.confidence ?? 0,
      };
    }),
  }));
  return { generatedAt: GENERATED_AT, items };
}

export function buildPeople(): PeopleView {
  const requests = buildRequests();
  const fromRequests: PersonItem[] = RAW_REQUESTS.map((raw) => {
    const item = requests.items.find((x) => x.id === raw.id);
    return {
      key: `r${raw.id}`,
      fio: raw.fio,
      phone: raw.phone,
      ageLabel: raw.ageLabel,
      district: raw.district,
      from: raw.source,
      mdgLabel: raw.cancelled ? 'Отказался от групп' : item?.bucket === 'done' ? 'Уже в группе' : 'Хочет в группу',
      date: dateMinus(raw.waitingDays),
      requestId: raw.id,
    };
  });
  const extras: PersonItem[] = RAW_EXTRA_PEOPLE.map((p) => ({ ...p, requestId: null }));
  return { generatedAt: GENERATED_AT, items: [...fromRequests, ...extras] };
}

function dateMinus(days: number | null): string | null {
  if (days == null) return null;
  return new Date(Date.UTC(2026, 9, 9 - days)).toISOString().slice(0, 10);
}

export function buildCoordinators(): CoordinatorsView {
  const names = [...new Set(RAW_GROUPS.map((g) => g.coordinator).filter((n): n is string => !!n))];
  const items: CoordinatorItem[] = names.map((name, i) => {
    const gs = RAW_GROUPS.filter((g) => g.coordinator === name);
    return {
      id: i + 1,
      name,
      role: COORDINATOR_ROLES[name] ?? 'Координатор',
      groups: gs.length,
      people: gs.reduce((a, g) => a + (g.people ?? 0), 0),
      verified30: gs.filter((g) => g.verifiedDaysAgo != null && g.verifiedDaysAgo <= 30).length,
    };
  });
  return { generatedAt: GENERATED_AT, items };
}
