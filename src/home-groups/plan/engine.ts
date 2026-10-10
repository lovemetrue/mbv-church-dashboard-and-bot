import type { Reason } from '../contracts.js';
import { formatWhen } from './parse.js';
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

const PASSING_STATUSES = new Set(['Функционирует', 'Кампания']);
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

/** «Комендантский пр.» и «комендантский пр» — одна улица. */
const streetKey = (street: string): string =>
  street.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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
  reason: Reason;
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
 * Время: день и время суток сравниваются по отдельности и усредняются. Чего у группы не указано
 * (несколько дней в одной ячейке, «Плавающий», пустое время), считается нейтральным 0,5: мы не знаем,
 * подходит ли, а штрафовать группу за пробел в таблице несправедливо.
 */
function timePart(r: PlanRequest, g: PlanGroup, settings: PlanSettings): Part {
  const weight = settings.weights.time;
  if (g.day === null && g.slot === null) {
    return { weight, share: 0.5, reason: { tone: 'neutral', text: 'у группы не указано время' } };
  }
  const shares: number[] = [];
  if (r.days.length > 0) shares.push(g.day === null ? 0.5 : r.days.includes(g.day) ? 1 : 0);
  if (r.slot !== null) shares.push(g.slot === null ? 0.5 : r.slot === g.slot ? 1 : 0);
  const share = shares.reduce((sum, x) => sum + x, 0) / shares.length;
  const when = formatWhen(g.day, g.slot) ?? '';
  if (share === 1) return { weight, share, reason: { tone: 'good', text: `время совпало: ${when}` } };
  if (share === 0) return { weight, share, reason: { tone: 'bad', text: `время не совпало: ${when}` } };
  return { weight, share, reason: { tone: 'neutral', text: `время частично: ${when}` } };
}

function streetPart(r: PlanRequest, g: PlanGroup, settings: PlanSettings): Part {
  const weight = settings.weights.street;
  if (g.street === null) return { weight, share: 0.5, reason: { tone: 'neutral', text: 'у группы нет улицы' } };
  if (streetKey(g.street) === streetKey(r.street ?? '')) {
    return { weight, share: 1, reason: { tone: 'good', text: 'та же улица' } };
  }
  return { weight, share: 0, reason: { tone: 'plain', text: 'другая улица' } };
}

function scoreGroup(r: PlanRequest, g: PlanGroup, known: KnownParams, settings: PlanSettings): ScoredGroup {
  const parts: Part[] = [];
  if (known[0]) parts.push(districtPart(r, g, settings));
  if (known[1]) parts.push(agePart(g, settings));
  if (known[2]) parts.push(timePart(r, g, settings));
  if (known[3]) parts.push(streetPart(r, g, settings));

  // Только по известным параметрам: иначе заявка без улицы никогда не набрала бы 100.
  const weights = parts.reduce((sum, p) => sum + p.weight, 0);
  let score = weights > 0 ? (parts.reduce((sum, p) => sum + p.weight * p.share, 0) / weights) * 100 : 0;
  const reasons = parts.map((p) => p.reason);

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
      alternatives: ordered.filter((c) => c !== main).slice(0, 2),
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
