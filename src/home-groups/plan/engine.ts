import type { Reason } from '../contracts.js';
import { matchesMetro } from '../../core/matching.js';
import { distanceMeters } from '../geocode.js';
import { streetKey } from './street.js';
import type {
  PlanEntry,
  PlanEntryProposal,
  PlanGroup,
  PlanInput,
  PlanOutput,
  PlanRequest,
  PlanSettings,
  ScoredGroup,
} from './types.js';

/**
 * Движок подбора: оценка группы для заявки и план на всю очередь.
 * Чистые функции — без базы, сети и часов (текущее время сюда не приходит вовсе: «сколько дней
 * назад» считает вызывающий и передаёт числом). Логика взята из кликабельного прототипа
 * (`match()` и `plan()`), с поправками на реальные данные: возраст заявки бывает неизвестен,
 * у групп бывают не указаны район, возраст и число участников.
 */

const PASSING_STATUSES = new Set(['Функционирует']);
/** Районы-«не районы»: у группы они районом считаться не могут, поэтому не отсеивают и не совпадают. */
const NO_DISTRICT = 'Не указан';
const ONLINE = 'Онлайн';

/**
 * Насколько наполненность группы влияет на выбор между близкими по оценке (в очках оценки).
 * Из двух почти равных групп побеждает та, где народу меньше, — людей расселяем равномерно, но
 * заметно лучшее совпадение (десятки очков) перебить это не должно.
 */
const FILL_BONUS = 6;

const freePlaces = (g: PlanGroup): number => g.capacity - (g.people ?? 0);

const overlaps = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] <= b[1] && b[0] <= a[1];

// ── какие параметры известны ────────────────────────────────────────────────

export type KnownParams = readonly [district: boolean, age: boolean, time: boolean, street: boolean];

/** Известны ли у заявки район, возраст, день и время, улица (в таком порядке). */
export function knownParamsOf(r: PlanRequest): KnownParams {
  return [r.district !== null, r.ageRange !== null, r.days.length > 0 || r.slot !== null, r.street !== null];
}

const countKnown = (known: KnownParams): number => known.filter(Boolean).length;

// ── жёсткие отсевы ──────────────────────────────────────────────────────────

/**
 * Почему группа не может быть предложена заявке; null — может. Это ответ на вопрос «можно ли
 * вообще», он не зависит от других заявок (занятость мест учитывает план).
 * Район заявки неизвестен — по району не отсеиваем: такой заявке план не строится, а отсев по
 * району без района был бы произвольным.
 */
export function exclusionReason(r: PlanRequest, g: PlanGroup, settings: PlanSettings): string | null {
  if (!PASSING_STATUSES.has(g.status)) return `статус «${g.status}»`;
  if (!g.acceptsNew) return 'не принимает новых';
  if (g.doNotRefer) return 'отмечена «Не направлять»';
  if (g.chamber) return 'камерная группа';
  if (freePlaces(g) <= 0) return 'группа заполнена';
  if (r.ageRange && g.ageRange && !overlaps(r.ageRange, g.ageRange)) return 'возраст группы не подходит';
  if (r.district !== null && !districtReachable(r.district, g.district, settings)) return `другой район (${g.district})`;
  return null;
}

function districtReachable(wanted: string, actual: string, settings: PlanSettings): boolean {
  if (wanted === actual) return true;
  // Группе без района и онлайн-группе ехать никуда не надо / район неизвестен: не отсев, а нейтральная оценка.
  if (actual === NO_DISTRICT || actual === ONLINE) return true;
  return settings.neighbors[wanted]?.includes(actual) ?? false;
}

// ── оценка ──────────────────────────────────────────────────────────────────

interface Part {
  weight: number;
  /** Доля совпадения 0–1. */
  share: number;
  /** null — отдельной причины нет (её уже назвала соседняя часть). */
  reason: Reason | null;
}

function districtPart(r: PlanRequest, g: PlanGroup, settings: PlanSettings): Part {
  const weight = settings.weights.district;
  if (g.district === NO_DISTRICT) {
    return { weight, share: 0.5, reason: { tone: 'neutral', text: 'у группы не указан район' } };
  }
  if (r.district === ONLINE && g.district === ONLINE) {
    return { weight, share: 1, reason: { tone: 'good', text: 'онлайн, как и просили' } };
  }
  if (g.district === ONLINE) return { weight, share: 0.5, reason: { tone: 'neutral', text: 'онлайн-группа' } };
  if (g.district === r.district) return { weight, share: 1, reason: { tone: 'good', text: 'тот же район' } };
  return { weight, share: 0.5, reason: { tone: 'neutral', text: 'соседний район' } };
}

function agePart(g: PlanGroup, settings: PlanSettings): Part {
  const weight = settings.weights.age;
  // Пересечение гарантировано отсевом, поэтому у группы с известным возрастом это полное совпадение.
  if (g.ageRange) return { weight, share: 1, reason: { tone: 'good', text: 'возраст подходит' } };
  return { weight, share: 0.5, reason: { tone: 'neutral', text: 'у группы не указан возраст' } };
}

/**
 * День недели весит как район (`weights.day`, см. `DISTRICT_WEIGHT`). У группы день неизвестен, когда в ячейке
 * несколько дней («Среда, Четверг»), «Плавающий» или пусто: это нейтральные 0,5 — не знаем, подходит ли, а штрафовать
 * группу за пробел в таблице несправедливо. Когда неизвестно и время суток, причина одна на оба (`timeUnknown`).
 */
function dayPart(r: PlanRequest, g: PlanGroup, settings: PlanSettings, timeUnknown: boolean): Part {
  const weight = settings.weights.day;
  if (g.day === null) {
    return { weight, share: 0.5, reason: { tone: 'neutral', text: timeUnknown ? 'у группы не указано время' : 'день группы не указан' } };
  }
  if (r.days.includes(g.day)) return { weight, share: 1, reason: { tone: 'good', text: `день совпал: ${g.day}` } };
  return { weight, share: 0, reason: { tone: 'bad', text: `день не совпал: ${g.day}` } };
}

/** Время суток: вес отдельный и меньший, чем у дня. Неизвестное у группы — нейтральные 0,5, как и у дня. */
function slotPart(r: PlanRequest, g: PlanGroup, settings: PlanSettings, timeUnknown: boolean): Part {
  const weight = settings.weights.slot;
  if (g.slot === null) {
    // Причину «время не указано» уже назвал день, повторять её незачем.
    return { weight, share: 0.5, reason: timeUnknown && r.days.length > 0 ? null : { tone: 'neutral', text: timeUnknown ? 'у группы не указано время' : 'время суток группы не указано' } };
  }
  if (r.slot === g.slot) return { weight, share: 1, reason: { tone: 'good', text: `время суток совпало: ${g.slot}` } };
  return { weight, share: 0, reason: { tone: 'bad', text: `время суток не совпало: ${g.slot}` } };
}

/** Расстояние словами: «350 м», «2,4 км». */
const distanceText = (m: number): string => (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1).replace('.', ',')} км`);

/** Поправка на неточность точки: середина улицы может быть в километре от дома, а центр посёлка — ещё дальше. */
const TOLERANCE_M = { house: 0, street: 600, area: 2000 } as const;

/**
 * Близость по координатам: домашняя группа может быть в соседнем квартале, а названия улиц у них разные. Ступени — по
 * пешей доступности: до полукилометра как «рядом», дальше доля падает, за шесть километров — ноль. Если точка грубая (адрес
 * без дома или только посёлок), из расстояния вычитается поправка, а в причине стоит «около».
 */
function distancePart(weight: number, rawMeters: number, a: PlanRequest['coords'], b: PlanGroup['coords']): Part {
  const tolerance = TOLERANCE_M[a?.accuracy ?? 'house'] + TOLERANCE_M[b?.accuracy ?? 'house'];
  const meters = Math.max(0, rawMeters - tolerance);
  const text = `${tolerance > 0 ? 'около ' : ''}${distanceText(rawMeters)}`;
  if (meters <= 500) return { weight, share: 1, reason: { tone: 'good', text: `адрес рядом: ${text}` } };
  if (meters <= 1500) return { weight, share: 0.75, reason: { tone: 'good', text: `адрес близко: ${text}` } };
  if (meters <= 3000) return { weight, share: 0.5, reason: { tone: 'neutral', text: `адрес ${tolerance > 0 ? '' : 'в '}${text}` } };
  if (meters <= 6000) return { weight, share: 0.25, reason: { tone: 'plain', text: `адрес далеко: ${text}` } };
  return { weight, share: 0, reason: { tone: 'plain', text: `адрес очень далеко: ${text}` } };
}

function streetPart(r: PlanRequest, g: PlanGroup, settings: PlanSettings): Part {
  const weight = settings.weights.street;
  // Координаты точнее названия улицы, но есть не у всех адресов (не нашли, ключа геокодера нет): тогда — как раньше.
  if (r.coords && g.coords) return distancePart(weight, distanceMeters(r.coords, g.coords), r.coords, g.coords);
  if (g.street === null) {
    // Адреса у группы нет — сверяем по метро или ориентиру. Человек мог назвать станцию и в «улице», и в «районе».
    if (g.metro === null) return { weight, share: 0.5, reason: { tone: 'neutral', text: 'у группы нет адреса и метро' } };
    const said = [r.street, r.place].filter(Boolean).join(' ');
    if (matchesMetro(said, g.metro)) return { weight, share: 1, reason: { tone: 'good', text: `рядом: ${g.metro}` } };
    // Улицу человека со станцией не сравнить, поэтому «не совпало» не штраф, а просто нет бонуса.
    return { weight, share: 0.5, reason: { tone: 'neutral', text: `метро группы: ${g.metro}` } };
  }
  // Человек пишет «ул. Рылеева, 32», у группы — «Рылеева»: сравниваем названия без типа, дома и падежа.
  const wanted = streetKey(r.street);
  const actual = streetKey(g.street);
  if (wanted === null || actual === null) return { weight, share: 0.5, reason: { tone: 'neutral', text: 'улицу не удалось сравнить' } };
  if (wanted === actual) return { weight, share: 1, reason: { tone: 'good', text: 'та же улица' } };
  return { weight, share: 0, reason: { tone: 'plain', text: 'другая улица' } };
}

function scoreGroup(r: PlanRequest, g: PlanGroup, known: KnownParams, settings: PlanSettings): ScoredGroup {
  const parts: Part[] = [];
  if (known[0]) parts.push(districtPart(r, g, settings));
  if (known[1]) parts.push(agePart(g, settings));
  if (known[2]) {
    // День и время суток считаются каждый сам и только если человек их назвал: «по вторникам» ничего не говорит о часах.
    const timeUnknown = g.day === null && g.slot === null;
    if (r.days.length > 0) parts.push(dayPart(r, g, settings, timeUnknown));
    if (r.slot !== null) parts.push(slotPart(r, g, settings, timeUnknown));
  }
  if (known[3]) parts.push(streetPart(r, g, settings));

  // Только по известным параметрам: иначе заявка без улицы никогда не набрала бы 100.
  const weights = parts.reduce((sum, p) => sum + p.weight, 0);
  let score = weights > 0 ? (parts.reduce((sum, p) => sum + p.weight * p.share, 0) / weights) * 100 : 0;
  const reasons = parts.map((p) => p.reason).filter((x): x is Reason => x !== null);

  if (g.people === null) reasons.push({ tone: 'neutral', text: 'число участников не указано' });
  if (g.verifiedDaysAgo === null) {
    reasons.push({ tone: 'plain', text: 'обратной связи нет' });
  } else if (g.verifiedDaysAgo > settings.staleDays) {
    score -= settings.stalePenalty;
    reasons.push({ tone: 'neutral', text: `не проверялась ${g.verifiedDaysAgo} дн.` });
  }
  if (freePlaces(g) <= 1) {
    score -= settings.lastSeatPenalty;
    reasons.push({ tone: 'neutral', text: 'почти заполнена' });
  }
  return { groupId: g.id, score: Math.max(0, Math.round(score)), reasons };
}

/**
 * Насколько человек подходит будущей группе — из обращения «хочу открыть группу» или потенциальной. Статус, «Не
 * направлять» и места не проверяются: группы ещё нет, координатор при звонке говорит «могли бы направить к вам N
 * человек». Остальное — как в обычном подборе: возраст и район отсекают, район, день, время и улица дают оценку.
 * null — человек не подходит.
 */
export function scoreProspect(r: PlanRequest, g: PlanGroup, settings: PlanSettings): ScoredGroup | null {
  const open: PlanGroup = { ...g, status: 'Функционирует', acceptsNew: true, doNotRefer: false, chamber: false, people: 0, capacity: Math.max(g.capacity, 1) };
  if (exclusionReason(r, open, settings) !== null) return null;
  return scoreGroup(r, open, knownParamsOf(r), settings);
}

export interface MatchResult {
  /** Подходящие группы: лучшая первой; при равной оценке — с меньшим id, чтобы порядок был однозначным. */
  ranked: ScoredGroup[];
  excluded: { groupId: number; why: string }[];
  known: KnownParams;
}

/** Подбор для одной заявки без учёта других заявок: оценка и отсев каждой группы. */
export function match(r: PlanRequest, groups: readonly PlanGroup[], settings: PlanSettings): MatchResult {
  const known = knownParamsOf(r);
  const ranked: ScoredGroup[] = [];
  const excluded: MatchResult['excluded'] = [];
  for (const g of groups) {
    const why = exclusionReason(r, g, settings);
    if (why !== null) excluded.push({ groupId: g.id, why });
    else ranked.push(scoreGroup(r, g, known, settings));
  }
  ranked.sort((a, b) => b.score - a.score || a.groupId - b.groupId);
  return { ranked, excluded, known };
}

/**
 * Запасные варианты: первым идёт лучшая из НОВЫХ групп (кроме главной), потом следующая по оценке. Так под самой подходящей
 * группой координатор всегда видит самую подходящую из новых: их надо наполнять людьми, а старые и так заполнены.
 */
function pickAlternatives(ordered: readonly ScoredGroup[], main: ScoredGroup, groupById: ReadonlyMap<number, PlanGroup>): ScoredGroup[] {
  const rest = ordered.filter((c) => c !== main);
  const bestNew = rest.find((c) => groupById.get(c.groupId)?.isNew === true);
  if (!bestNew) return rest.slice(0, 2);
  return [bestNew, ...rest.filter((c) => c !== bestNew)].slice(0, 2);
}

// ── план на всю очередь ─────────────────────────────────────────────────────

interface Work {
  request: PlanRequest;
  /** Кандидаты после отказов из обзвона. */
  candidates: ScoredGroup[];
  known: KnownParams;
}

/**
 * План на всю очередь сразу. Порядок обработки: сначала заявки с наименьшим числом вариантов
 * (иначе «лёгкая» заявка заберёт место, которое у «трудной» единственное), затем с лучшей оценкой,
 * затем по id — порядок во входе на результат не влияет. Отказы (`rejectedGroupIds`, `avoidDays`,
 * `avoidSlots`) убирают кандидатов до выбора.
 */
export function buildPlan(input: PlanInput): PlanOutput {
  const { requests, groups, settings } = input;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const remaining = new Map(groups.map((g) => [g.id, freePlaces(g)]));
  const fioOf = new Map(requests.map((r) => [r.id, r.fio]));
  const decided = new Map<number, PlanEntry>();
  const takenBy = new Map<number, number[]>();

  const work: Work[] = [];
  for (const request of requests) {
    if (request.district === null) {
      decided.set(request.id, { kind: 'none', code: 'place', reason: 'Место не распознано' });
      continue;
    }
    const { ranked, known } = match(request, groups, settings);
    const candidates = ranked.filter((c) => {
      const g = groupById.get(c.groupId)!;
      if (request.rejectedGroupIds.includes(g.id)) return false;
      // Неизвестный день группы нежеланием дня не исключается: «не знаем» не значит «нежелательно».
      if (g.day !== null && request.avoidDays.includes(g.day)) return false;
      if (g.slot !== null && request.avoidSlots.includes(g.slot)) return false;
      return true;
    });
    work.push({ request, candidates, known });
  }

  // Закреплённые (накопленные) предложения идут первыми: их место уже обещано, и новая «трудная»
  // заявка не должна его отнимать. Остальные — от трудных к лёгким, как раньше.
  const isPinned = (w: Work): boolean =>
    w.request.pinnedGroupId !== null && w.candidates.some((c) => c.groupId === w.request.pinnedGroupId);
  work.sort(
    (a, b) =>
      Number(isPinned(b)) - Number(isPinned(a)) ||
      a.candidates.length - b.candidates.length ||
      (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0) ||
      a.request.id - b.request.id,
  );

  for (const { request, candidates, known } of work) {
    const available = candidates.filter((c) => (remaining.get(c.groupId) ?? 0) > 0);
    if (available.length === 0) {
      decided.set(
        request.id,
        candidates.length > 0
          ? { kind: 'none', code: 'taken', reason: 'Свободные места разобраны другими заявками' }
          : { kind: 'none', code: 'nogroup', reason: 'В районе нет групп, подходящих по возрасту' },
      );
      continue;
    }

    const adjusted = (c: ScoredGroup): number => {
      const g = groupById.get(c.groupId)!;
      return c.score + (1 - (g.people ?? 0) / g.capacity) * FILL_BONUS;
    };
    // Хвост по id избыточен (кандидаты уже отсортированы по id, а sort стабилен), но порядок не должен
    // зависеть от того, что кто-то изменит сортировку в `match`.
    const ordered = [...available].sort(
      (a, b) => adjusted(b) - adjusted(a) || b.score - a.score || a.groupId - b.groupId,
    );
    const pinned = request.pinnedGroupId === null ? undefined : ordered.find((c) => c.groupId === request.pinnedGroupId);
    const main = pinned ?? ordered[0]!;

    remaining.set(main.groupId, remaining.get(main.groupId)! - 1);
    takenBy.set(main.groupId, [...(takenBy.get(main.groupId) ?? []), request.id]);

    // Лучшая по оценке группа, место в которой уже отдано другим, — то, что нужно объяснить человеку.
    const best = candidates[0]!;
    const displaced =
      best.groupId !== main.groupId && (remaining.get(best.groupId) ?? 0) <= 0
        ? {
            groupId: best.groupId,
            takenBy: (takenBy.get(best.groupId) ?? []).map((id) => fioOf.get(id) ?? ''),
          }
        : null;

    const knownParams = countKnown(known);
    const proposal: PlanEntryProposal = {
      kind: 'proposal',
      main,
      confidence: Math.round(main.score * (settings.confidenceFloor + (settings.confidenceSpan * knownParams) / 4)),
      knownParams,
      alternatives: pickAlternatives(ordered, main, groupById),
      displaced,
    };
    decided.set(request.id, proposal);
  }

  // Записи отдаём по возрастанию id заявки: обход Map у вызывающего не должен зависеть от порядка обработки.
  const entries = new Map([...decided].sort(([a], [b]) => a - b));
  return { entries, takenBy };
}

// ── куда относится заявка ───────────────────────────────────────────────────

/** Нужна ли помощь человека: плана нет, предложения нет или уверенность ниже порога. */
export function needsHuman(entry: PlanEntry | undefined, settings: PlanSettings): boolean {
  return !entry || entry.kind === 'none' || entry.confidence < settings.humanThreshold;
}

export function bucketOf(args: {
  status: string;
  entry: PlanEntry | undefined;
  callback: boolean;
  settings: PlanSettings;
}): 'ready' | 'callback' | 'human' | 'done' | 'cancelled' {
  if (args.status === 'Исполнена') return 'done';
  if (args.status === 'Аннулирована') return 'cancelled';
  // Отметка «нужен звонок» — решение координатора, и оно сильнее расчёта: человек уже взял заявку
  // на себя (позвонит и уточнит), поэтому она не висит в «нужна помощь», даже если плана нет.
  if (args.callback) return 'callback';
  return needsHuman(args.entry, args.settings) ? 'human' : 'ready';
}
