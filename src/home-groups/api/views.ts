import type { DashboardGroup } from '../../db/repos/groups.repo.js';
import type { DashboardRequest } from '../../db/repos/requests.repo.js';
import type { RegisteredParticipant } from '../../db/repos/users.repo.js';
import type { CoordinatorRow } from '../../db/repos/coordinators.repo.js';
import { formatPhone } from '../../core/phone.js';
import type {
  Bucket, Candidate, Counters, CoordinatorItem, CoordinatorsView, GroupBrief, GroupItem, GroupsView,
  HealthItem, LogEntry, NoPlan, PeopleView, PersonItem, Proposal, RequestItem, RequestsView, TodayView,
} from '../contracts.js';
import type {
  PlanEngineApi, PlanEntry, PlanEntryProposal, PlanGroup, PlanOutput, PlanRequest, ScoredGroup,
} from '../plan/types.js';
import { daysSince, localIsoDate, validIsoDate } from './dates.js';

/** Уже загруженные строки: функция ниже ничего не читает из базы и не знает про сеть. */
export interface ViewsInput {
  groups: DashboardGroup[];
  requests: DashboardRequest[];
  participants: RegisteredParticipant[];
  coordinators: CoordinatorRow[];
}

export interface ViewsOptions {
  /** Вместимость группы, пока в базе нет такой колонки (этап A). */
  defaultCapacity?: number;
  /** Пояс, в котором считаются «сегодня» и «дней назад». */
  timeZone?: string;
}

/** Всё, что отдают ручки API, посчитанное за один проход по одному снимку данных. */
export interface Views {
  today: TodayView;
  requests: RequestsView;
  groups: GroupsView;
  people: PeopleView;
  coordinators: CoordinatorsView;
}

const DEFAULT_CAPACITY = 10;
const DEFAULT_TIME_ZONE = 'Europe/Moscow';

/** Статусы, после которых заявка в план не идёт (совпадает с `CLOSED_STATUSES` в репозитории). */
const DONE = 'Исполнена';
const CANCELLED = 'Аннулирована';

/** Порядок на экране «Заявки»: сначала то, что требует звонка. Отказов в списке нет. */
const BUCKET_ORDER: Partial<Record<Bucket, number>> = { callback: 0, ready: 1, human: 2, done: 3 };

/** Подписи корзин для строки «Заявка: …» в списке людей (как в прототипе, со строчной буквы). */
const BUCKET_NAMES: Record<Bucket, string> = {
  ready: 'готово к утверждению',
  callback: 'перезвонить',
  human: 'нужна помощь в сопоставлении',
  done: 'утверждено',
  cancelled: 'отказ',
};

const MDG_LABELS: Record<string, string> = {
  open: 'Откроет свою группу',
  home: 'Даст дом для группы',
  join: 'Хочет в группу',
  member: 'Уже в группе',
  leader: 'Ведёт группу',
};
const MDG_NO_ANSWER = 'Не ответил';

const ORIGIN_LABELS: Record<string, string> = { 'бот': 'Бот', 'таблица': 'Таблица', 'ui': 'Дашборд' };

/** Окно «обратная связь свежая» для здоровья группы и сводки координаторов. */
const FRESH_FEEDBACK_DAYS = 30;

const nonBlank = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

const groupCode = (id: number): string => `ДГ-${String(id).padStart(4, '0')}`;

/** Телефон для показа: первый из списка номеров, иначе как записан; российский форматируем, остальное — как есть. */
function displayPhone(phones: readonly string[] | null | undefined, phone: string | null | undefined): string | null {
  return nonBlank(formatPhone(nonBlank(phones?.[0]) ?? nonBlank(phone)));
}

function sourceLabel(origin: string | null | undefined, source: string | null | undefined): string {
  const base = ORIGIN_LABELS[origin ?? ''] ?? 'Дашборд';
  const detail = nonBlank(source);
  // «Таблица» в колонке «источник» — то же самое, что происхождение; дубль в подписи ни к чему.
  if (!detail || [base, origin ?? ''].some((s) => s.toLowerCase() === detail.toLowerCase())) return base;
  return `${base} · ${detail}`;
}

function joinParts(parts: (string | null | undefined)[], sep: string): string | null {
  const present = parts.map(nonBlank).filter((p): p is string => p !== null);
  return present.length ? present.join(sep) : null;
}

/**
 * Чистая сборка всех представлений. Движок внедряется: в тестах подставляется поддельный,
 * в бою — настоящий (`composition.ts`).
 *
 * Группа со статусом «Закрыта»/«Недвижимость» входит и в справочник, и в движок: справочник
 * показывает всё, а отсеивать неподходящее для подбора — забота самого движка, а не этого слоя.
 */
export function buildViews(input: ViewsInput, engine: PlanEngineApi, now: Date, options: ViewsOptions = {}): Views {
  const defaultCapacity = options.defaultCapacity ?? DEFAULT_CAPACITY;
  const today = localIsoDate(now, options.timeZone ?? DEFAULT_TIME_ZONE);
  const generatedAt = now.toISOString();
  const settings = { ...engine.DEFAULT_SETTINGS, defaultCapacity };

  // ── группы ────────────────────────────────────────────────────────────────
  const planGroups: PlanGroup[] = input.groups.map((g) => {
    const when = engine.parseGroupWhen(g.day, g.time);
    return {
      id: g.id,
      no: g.no,
      leader: g.leader,
      district: g.district,
      metro: nonBlank(g.metro),
      ageRange: engine.parseAgeRange(g.age),
      day: when.day,
      slot: when.slot,
      // Улицу для подбора отдельной колонкой ещё не завели, а закрытый `address` сюда нельзя ни при каких условиях.
      street: null,
      people: g.people,
      capacity: defaultCapacity,
      status: g.status,
      // Пусто = принимает: «НЕТ» ставят явно, когда группа полна или не хочет новых.
      acceptsNew: g.open_to_new?.trim().toUpperCase() !== 'НЕТ',
      doNotRefer: g.do_not_refer,
      verifiedDaysAgo: daysSince(validIsoDate(g.feedback_at), today),
    };
  });
  const planGroupById = new Map(planGroups.map((g) => [g.id, g]));
  const sourceGroupById = new Map(input.groups.map((g) => [g.id, g]));

  const brief = (id: number): GroupBrief | null => {
    const p = planGroupById.get(id);
    const g = sourceGroupById.get(id);
    if (!p || !g) return null;
    return {
      id: p.id,
      no: p.no,
      code: groupCode(p.id),
      leader: p.leader,
      district: p.district,
      metro: p.metro,
      whenText: engine.formatWhen(p.day, p.slot),
      people: p.people,
      capacity: p.capacity,
      free: Math.max(0, p.capacity - (p.people ?? 0)),
      format: nonBlank(g.format),
    };
  };

  const metroIndex = engine.buildMetroIndex(input.groups);

  // ── заявки ────────────────────────────────────────────────────────────────
  const joinRequests = input.requests.filter((r) => r.type === 'join_group');

  const planRequestOf = (r: DashboardRequest): PlanRequest => ({
    id: r.id,
    fio: nonBlank(r.fio) ?? 'Без имени',
    ageRange: engine.parseAgeRange(r.age),
    district: engine.resolveDistrict(nonBlank(r.place), metroIndex),
    place: nonBlank(r.place),
    // Удобные дни, время и улица пока лежат в свободном тексте анкеты; разбирать его — этап B.
    days: [],
    slot: null,
    street: null,
    rejectedGroupIds: [],
    avoidDays: [],
    avoidSlots: [],
    pinnedGroupId: null,
    waitingDays: daysSince(validIsoDate(r.date), today),
  });

  const joinById = new Map(joinRequests.map((r) => [r.id, r]));
  const planRequests = new Map(joinRequests.map((r) => [r.id, planRequestOf(r)]));
  const openRequests = joinRequests.filter((r) => r.status !== DONE && r.status !== CANCELLED);
  const openPlanRequests = openRequests.map((r) => planRequests.get(r.id)!);

  const plan: PlanOutput = engine.buildPlan({ requests: openPlanRequests, groups: planGroups, settings });

  const bucketById = new Map<number, Bucket>();
  for (const r of joinRequests) {
    bucketById.set(r.id, engine.bucketOf({
      status: r.status, entry: plan.entries.get(r.id), callback: false, settings,
    }));
  }

  const counters: Counters = { ready: 0, callback: 0, human: 0, done: 0, cancelled: 0 };
  for (const b of bucketById.values()) counters[b] += 1;

  const summary = engine.buildTodaySummary({
    requests: openPlanRequests, entries: plan.entries, groups: planGroups, settings,
  });

  const candidate = (s: ScoredGroup, confidence: number | null): Candidate | null => {
    const group = brief(s.groupId);
    return group ? { group, score: s.score, confidence, reasons: s.reasons } : null;
  };

  const proposalOf = (e: PlanEntryProposal): Proposal | null => {
    const main = candidate(e.main, e.confidence);
    if (!main) return null;
    const displacedGroup = e.displaced ? brief(e.displaced.groupId) : null;
    return {
      main,
      knownParams: e.knownParams,
      alternatives: e.alternatives.map((a) => candidate(a, null)).filter((c): c is Candidate => c !== null),
      displaced: e.displaced && displacedGroup ? { group: displacedGroup, takenBy: e.displaced.takenBy } : null,
    };
  };

  const splitEntry = (entry: PlanEntry | undefined): { proposal: Proposal | null; noPlan: NoPlan | null } => {
    if (!entry) return { proposal: null, noPlan: null };
    if (entry.kind === 'none') return { proposal: null, noPlan: { code: entry.code, reason: entry.reason } };
    const proposal = proposalOf(entry);
    // Движок назвал группу, которой нет в справочнике, — не показываем полуплан.
    return proposal
      ? { proposal, noPlan: null }
      : { proposal: null, noPlan: { code: 'nogroup', reason: 'Предложенная группа не найдена в справочнике' } };
  };

  const logOf = (r: DashboardRequest, finalBrief: GroupBrief | null): LogEntry[] => {
    const log: LogEntry[] = [{ at: validIsoDate(r.date), text: `Заявка создана (${sourceLabel(r.origin, r.source)})` }];
    const recommended = nonBlank(r.recommended);
    if (recommended) log.push({ at: validIsoDate(r.recommended_at), text: `Рекомендована группа: ${recommended}` });
    const approved = nonBlank(r.final_group)
      ?? (r.status === DONE && finalBrief ? `${finalBrief.code}, ${finalBrief.leader}` : null);
    if (approved) log.push({ at: null, text: `Утверждена: ${approved}` });
    const cancelReason = nonBlank(r.cancel_reason);
    if (cancelReason) log.push({ at: null, text: `Причина аннулирования: ${cancelReason}` });
    const attendance = nonBlank(r.attendance);
    if (attendance) log.push({ at: null, text: `Контроль посещения: ${attendance}` });
    return log;
  };

  const requestItems: RequestItem[] = [];
  for (const r of joinRequests) {
    const bucket = bucketById.get(r.id)!;
    if (bucket === 'cancelled') continue;
    const pr = planRequests.get(r.id)!;
    const { proposal, noPlan } = splitEntry(plan.entries.get(r.id));
    const finalBrief = bucket === 'done' && r.group_id !== null ? brief(r.group_id) : null;
    requestItems.push({
      id: r.id,
      fio: pr.fio,
      phone: displayPhone(r.phones, r.phone),
      ageLabel: nonBlank(r.age),
      place: pr.place,
      district: pr.district,
      days: pr.days,
      slot: pr.slot,
      street: pr.street,
      source: sourceLabel(r.origin, r.source),
      status: r.status,
      bucket,
      waitingDays: pr.waitingDays,
      dataFill: [pr.district !== null, pr.ageRange !== null, pr.days.length > 0 || pr.slot !== null, pr.street !== null],
      proposal,
      noPlan,
      finalGroup: finalBrief,
      finalGroupText: bucket === 'done' && !finalBrief ? nonBlank(r.final_group) : null,
      responsible: nonBlank(r.responsible),
      note: joinParts([r.note, r.extra], ' | '),
      log: logOf(r, finalBrief),
    });
  }
  requestItems.sort((a, b) =>
    (BUCKET_ORDER[a.bucket] ?? 99) - (BUCKET_ORDER[b.bucket] ?? 99)
    || (b.waitingDays ?? -1) - (a.waitingDays ?? -1)
    || a.id - b.id);

  // ── справочник: группы ────────────────────────────────────────────────────
  const plannedByGroup = new Map<number, GroupItem['plannedRequests']>();
  for (const [groupId, requestIds] of plan.takenBy) {
    const list: GroupItem['plannedRequests'] = [];
    for (const id of requestIds) {
      const entry = plan.entries.get(id);
      const pr = planRequests.get(id);
      if (entry?.kind !== 'proposal' || !pr) continue;
      const src = joinById.get(id);
      list.push({ id, fio: pr.fio, ageLabel: nonBlank(src?.age), place: pr.place, confidence: entry.confidence });
    }
    plannedByGroup.set(groupId, list);
  }

  const groupItems: GroupItem[] = input.groups.map((g) => {
    const p = planGroupById.get(g.id)!;
    const b = brief(g.id)!;
    return {
      ...b,
      coLeader: nonBlank(g.co_leader),
      phone: displayPhone(g.phones, g.phone),
      ageText: nonBlank(g.age),
      day: p.day,
      slot: p.slot,
      status: g.status,
      acceptsNew: p.acceptsNew,
      doNotRefer: p.doNotRefer,
      composition: nonBlank(g.composition),
      coordinator: nonBlank(g.coordinator),
      verifiedDaysAgo: p.verifiedDaysAgo,
      comment: nonBlank(g.comment),
      health: groupHealth(g, p),
      plannedRequests: plannedByGroup.get(g.id) ?? [],
    };
  });

  // ── справочник: люди ──────────────────────────────────────────────────────
  const joinRequestByUser = new Map<number, number>();
  for (const r of joinRequests) {
    // Несколько заявок на одного человека: показываем самую свежую (больший id).
    if (r.user_id !== null && r.id > (joinRequestByUser.get(r.user_id) ?? 0)) joinRequestByUser.set(r.user_id, r.id);
  }

  const people: PersonItem[] = [];
  for (const u of input.participants) {
    people.push({
      key: `u${u.id}`,
      fio: nonBlank(u.full_name) ?? 'Без имени',
      phone: nonBlank(formatPhone(nonBlank(u.phone))),
      ageLabel: nonBlank(u.age),
      district: engine.resolveDistrict(nonBlank(u.location), metroIndex),
      // Заведённый служителем вручную: платформа в записи условная, чата с ботом нет.
      from: !u.has_chat ? 'Форма регистрации' : u.platform === 'max' ? 'Бот · MAX' : 'Бот · Telegram',
      mdgLabel: (u.mdg_status && MDG_LABELS[u.mdg_status]) || MDG_NO_ANSWER,
      date: localIsoDate(new Date(u.registered_at), options.timeZone ?? DEFAULT_TIME_ZONE),
      requestId: joinRequestByUser.get(u.id) ?? null,
    });
  }
  for (const r of joinRequests) {
    if (r.user_id !== null) continue;
    const pr = planRequests.get(r.id)!;
    people.push({
      key: `r${r.id}`,
      fio: pr.fio,
      phone: displayPhone(r.phones, r.phone),
      ageLabel: nonBlank(r.age),
      district: pr.district,
      from: sourceLabel(r.origin, r.source),
      mdgLabel: `Заявка: ${BUCKET_NAMES[bucketById.get(r.id)!]}`,
      date: validIsoDate(r.date),
      requestId: r.id,
    });
  }
  people.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.key.localeCompare(b.key));

  // ── справочник: координаторы ──────────────────────────────────────────────
  const coordinatorItems: CoordinatorItem[] = input.coordinators.map((c) => {
    const name = c.name.trim().toLowerCase();
    const own = planGroups.filter((p) => sourceGroupById.get(p.id)?.coordinator?.trim().toLowerCase() === name);
    return {
      id: c.id,
      name: c.name,
      role: c.role,
      groups: own.length,
      people: own.reduce((sum, p) => sum + (p.people ?? 0), 0),
      verified30: own.filter((p) => p.verifiedDaysAgo !== null && p.verifiedDaysAgo <= FRESH_FEEDBACK_DAYS).length,
    };
  });

  return {
    today: {
      generatedAt,
      counters,
      // «Распределено X из Y»: отказ из знаменателя убираем — человек ушёл, распределять его не надо.
      assigned: counters.ready + counters.callback + counters.done,
      total: joinRequests.length - counters.cancelled,
      ageColumns: summary.ageColumns,
      matrix: summary.matrix,
      clusters: summary.clusters,
      singles: summary.singles,
    },
    requests: { generatedAt, items: requestItems, counters },
    groups: { generatedAt, items: groupItems },
    people: { generatedAt, items: people },
    coordinators: { generatedAt, items: coordinatorItems },
  };
}

/**
 * Здоровье группы: 100 баллов по полям, которые уже есть в базе (этап A). Пункты и вес
 * показываем человеку, поэтому подписи — это и есть подсказка, что именно исправить.
 */
function groupHealth(g: DashboardGroup, p: PlanGroup): { score: number; items: HealthItem[] } {
  const items: HealthItem[] = [
    { ok: nonBlank(g.leader) !== null, label: 'Ведущий указан', points: 10 },
    { ok: displayPhone(g.phones, g.phone) !== null, label: 'Телефон ведущего', points: 15 },
    { ok: p.day !== null && p.slot !== null, label: 'День и время', points: 20 },
    { ok: g.district !== 'Не указан' && p.metro !== null, label: 'Район и метро', points: 15 },
    {
      ok: p.verifiedDaysAgo !== null && p.verifiedDaysAgo <= FRESH_FEEDBACK_DAYS,
      label: 'Обратная связь за 30 дней',
      points: 30,
    },
    { ok: g.people !== null, label: 'Число участников указано', points: 10 },
  ];
  return { score: items.reduce((sum, i) => sum + (i.ok ? i.points : 0), 0), items };
}
