import type { DashboardGroup } from '../../db/repos/groups.repo.js';
import type { MemberRow, PersonRow } from '../../db/repos/members.repo.js';
import type { StoredHint } from '../../db/repos/hints.repo.js';
import type { StrangeMarkRow } from '../../db/repos/strange.repo.js';
import { diffSnapshots, inputSnapshot, type InputSnapshot } from '../plan/signature.js';
import { streetName } from '../plan/street.js';
import { addressKey } from '../geocode.js';
import { gistOf } from '../reconcile/gist.js';
import { reconcileOf } from '../reconcile/plan.js';
import { baseHash, needsOf, anyNeed, scriptFactsOf, type AssistantCandidate, type RawBrief } from '../assistant/brief.js';
import type { ActivityRow, AuditRow } from '../../db/repos/audit.repo.js';
import type { DashboardRequest } from '../../db/repos/requests.repo.js';
import type { RegisteredParticipant } from '../../db/repos/users.repo.js';
import type { CoordinatorRow } from '../../db/repos/coordinators.repo.js';
import { ALL_DISTRICTS, groupCode, groupGender } from '../../core/groups.js';
import { genderFromFio } from '../../core/gender.js';
import { GENDER_BY_AI, type GenderRow } from '../../db/repos/genders.repo.js';
import { AGE_GROUPS } from '../../core/texts.js';
import { inputSignature } from '../plan/signature.js';
import { formatPhone } from '../../core/phone.js';
import { CONTACT_LABEL } from '../../core/csv.js';
import type { GroupDraftView } from '../contracts.js';
import type {
  Bucket, Candidate, Counters, CoordinatorItem, CoordinatorsView, GroupBrief, GroupItem, GroupsView,
  GenderInfo, HealthItem, LogEntry, MatchingStatus, NoPlan, StrangeMark, DataChange, OriginalField, ParamInfo, RequestTableFields, PeopleView, PersonItem, Proposal, RequestItem, AssistantNote, AssistantReviewItem, GroupMember, OtherItem, Prospects, ProspectItem, RequestsView, TeamView, TodayView,
} from '../contracts.js';
import type {
  Day, PlanEngineApi, PlanEntry, PlanEntryProposal, PlanGroup, PlanOutput, PlanRequest, ScoredGroup, Slot,
} from '../plan/types.js';
import { buildTeam } from './team.js';
import { addMonthsIso, daysSince, localIsoDate, validIsoDate } from './dates.js';

/** Уже загруженные строки: функция ниже ничего не читает из базы и не знает про сеть. */
export interface ViewsInput {
  groups: DashboardGroup[];
  requests: DashboardRequest[];
  participants: RegisteredParticipant[];
  coordinators: CoordinatorRow[];
  /** Группы, которые координатор уже отклонил для заявки (заявка → группы). Нет — значит, отказов не было. */
  rejectedGroups?: ReadonlyMap<number, readonly number[]>;
  /** Действия над заявками из журнала: показываются в ленте карточки. */
  audit?: readonly AuditRow[];
  /** Действия за неделю по людям (для сводки руководителя). */
  activity?: readonly ActivityRow[];
  /** Разбор помощника по заявкам (см. `request_hints`): подставляется там, где скрипт ничего не понял. */
  hints?: ReadonlyMap<number, StoredHint>;
  /** Метки «Странный человек»: ключ человека (u12, r345, p7) → кто и когда поставил. */
  strange?: ReadonlyMap<string, StrangeMarkRow>;
  /** Пол, поставленный вручную или по подсказке модели (миграция 055): ключ человека → пол. Остальным пол — из ФИО. */
  genders?: ReadonlyMap<string, GenderRow>;
  /** Состав групп, внесённый вручную. */
  members?: readonly MemberRow[];
  /** Карточки людей, внесённые вручную. */
  persons?: readonly PersonRow[];
  /** Подключён ли помощник (есть ключ) и включён ли он в настройках. */
  assistant?: { available: boolean; enabled: boolean };
  /**
   * Накопленные предложения (заявка → группа и кто предложил). Они закрепляют выбор: движок
   * сохраняет группу, пока она остаётся доступной, и подбирает новые заявки вокруг неё.
   */
  activeProposals?: ReadonlyMap<number, { groupId: number | null; source: 'script' | 'agent' | 'manual'; inputHash?: string | null; inputSnapshot?: InputSnapshot | null }>;
  /** Сколько человек утвердил сервис в группу после последней обратной связи ведущего. */
  placedNew?: ReadonlyMap<number, number>;
  /** Кэш координат адресов (ключ — `addressKey`); нет записи или null — адрес не геокодирован или не найден. */
  geo?: ReadonlyMap<string, { lat: number; lon: number } | null>;
  /** Настройки подбора: автоматический ли он и когда запускали в последний раз. */
  matching?: { auto: boolean; lastRun: MatchingStatus['lastRun'] };
}

/** Разбор удобного времени человека: что подходит и что нет. */
interface HumanWhen { days: Day[]; slot: Slot | null; avoidDays: Day[]; avoidSlots: Slot[] }

export interface ViewsOptions {
  /** Вместимость группы, пока в базе нет такой колонки (этап A). */
  defaultCapacity?: number;
  /** Пояс, в котором считаются «сегодня» и «дней назад». */
  timeZone?: string;
}

/** Всё, что отдают ручки API, посчитанное за один проход по одному снимку данных. */
export interface Views {
  team: TeamView;
  today: TodayView;
  requests: RequestsView;
  groups: GroupsView;
  people: PeopleView;
  coordinators: CoordinatorsView;
  /**
   * Черновики «Создать группу по заявке» (по номеру заявки): отдаются по одному, `GET /requests/:id/group-draft`, а
   * не вместе со списком — открывают их редко, а полей много.
   */
  groupDrafts: Map<number, GroupDraftView>;
}

const DEFAULT_CAPACITY = 10;
const DEFAULT_TIME_ZONE = 'Europe/Moscow';

/** Статусы, после которых заявка в план не идёт (совпадает с `CLOSED_STATUSES` в репозитории). */
const DONE = 'Исполнена';
/** Сколько месяцев после открытия группа считается новой и сколько человек должно набраться к этому сроку, чтобы росток снялся, а не завял. */
const NEW_GROUP_MONTHS = 4;
const NEW_GROUP_MIN_PEOPLE = 3;
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

const REJECT_REASON_TEXT: Record<string, string> = {
  time: 'не подошло время',
  far: 'далеко',
  age: 'не подходит возраст или состав',
  declined: 'человек отказался',
  other: 'другое',
};

const CANCEL_TEXT: Record<string, string> = {
  declined: 'отказались', no_answer: 'не отвечают', duplicate: 'дубль заявки', self_found: 'нашли группу сами', other: 'другое',
};

const TYPE_LABEL: Record<OtherItem['type'], string> = {
  join_group: 'Хочет в домашнюю группу', lead_group: 'Хочет открыть группу или дать дом', question: 'Вопрос служителю',
  already_member: 'Уже состоит в группе', already_leader: 'Уже ведёт группу',
};
const OTHER_CLOSED_LIMIT = 200;
/** Сколько подходящих людей показать у обращения «хочу открыть группу»: всего — числом, по именам — первых. */
const PROSPECTS_SHOWN = 20;

const CALL_RESULT_TEXT: Record<string, string> = {
  reached: 'Звонок: дозвонились', no_answer: 'Звонок: не дозвонились', later: 'Звонок: просили перезвонить позже', refused: 'Звонок: отказался',
};

/** Строка ленты по записи журнала; null — запись для ленты не предназначена. Личных данных в журнале нет. */
function auditText(a: AuditRow): string | null {
  const after = a.after ?? {};
  switch (a.action) {
    case 'request.approve':
      return `Утверждено: ${String(after['final_group'] ?? '—')} · ${a.actor}`;
    case 'request.reject': {
      const id = Number(after['rejected_group_id']);
      const reason = REJECT_REASON_TEXT[String(after['reason'])] ?? String(after['reason'] ?? '');
      const note = nonBlank(a.note);
      return `Отклонена группа ${Number.isFinite(id) ? groupCode(id) : '—'}: ${reason}${note ? ` («${note}»)` : ''} · ${a.actor}`;
    }
    case 'request.need_call':
      return `Отмечено «нужен звонок» · ${a.actor}`;
    case 'request.group_created': {
      const id = Number(after['groupId']);
      return `По заявке заведена группа ${Number.isFinite(id) ? groupCode(id) : '—'} · ${a.actor}`;
    }
    case 'request.need_call_off':
      return `Отметка «нужен звонок» снята · ${a.actor}`;
    case 'request.params': {
      const parts: string[] = [];
      if (after['street'] === true) parts.push('улица');
      if (after['street'] === false) parts.push('правка улицы снята');
      if (after['schedule'] === true) parts.push('удобное время');
      if (after['schedule'] === false) parts.push('правка времени снята');
      return `Уточнено вручную: ${parts.join(', ') || 'параметры подбора'} · ${a.actor}`;
    }
    case 'request.edit': {
      const names: Record<string, string> = {
        fio: 'ФИО', phone: 'телефон', age: 'возраст', place: 'район', note: 'комментарий', address: 'улица и дом', schedule: 'удобное время',
        hobby: 'хобби', profession: 'профессия', family: 'семья', source: 'источник', ministry: 'служение', extra: 'дополнительно',
        recommended: 'рекомендованная группа', recommendedAt: 'дата рекомендации', finalGroup: 'ходит в группу', attendance: 'контроль посещения',
      };
      const fields = Array.isArray(after['fields']) ? (after['fields'] as unknown[]).map((f) => names[String(f)] ?? String(f)) : [];
      return `Исправлено вручную: ${fields.join(', ') || 'данные заявки'} · ${a.actor}`;
    }
    case 'request.assign': {
      const who = nonBlank(typeof after['responsible'] === 'string' ? after['responsible'] : null);
      return who ? `В работе у: ${who} · ${a.actor}` : `Снята ответственность за заявку · ${a.actor}`;
    }
    case 'request.call': {
      const text = CALL_RESULT_TEXT[String(after['result'])] ?? 'Звонок';
      const note = nonBlank(a.note);
      return `${text}${note ? ` («${note}»)` : ''} · ${a.actor}`;
    }
    case 'request.close': {
      const note = nonBlank(a.note);
      const what = after['outcome'] === 'cancel'
        ? `Аннулирована: ${CANCEL_TEXT[String(after['reason'])] ?? 'причина не указана'}`
        : 'Отмечена обработанной';
      return `${what}${note ? ` («${note}»)` : ''} · ${a.actor}`;
    }
    case 'request.reopen':
      return `Возвращена в работу · ${a.actor}`;
    case 'request.data_changed': {
      const fields = Array.isArray(after['fields']) ? (after['fields'] as unknown[]).map(String).filter(Boolean) : [];
      return fields.length > 0 ? `Данные для подбора изменились: ${fields.join(', ').toLowerCase()}` : 'Данные для подбора изменились';
    }
    case 'request.strange':
      return after['value'] === true ? `Отмечено «странный человек» · ${a.actor}` : `Метка «странный человек» снята · ${a.actor}`;
    case 'request.reconcile': {
      // group_ids — все группы; у записей до «нескольких групп» только group_id.
      const raw = Array.isArray(after['group_ids']) ? after['group_ids'] : [after['group_id']];
      const ids = raw.map(Number).filter((n) => Number.isFinite(n));
      const codes = ids.length ? ids.map((n) => groupCode(n)).join(', ') : '—';
      const many = ids.length > 1;
      const already = after['already'] === true ? ' (уже было)' : '';
      return after['kind'] === 'leader'
        ? `Разобрано: ${many ? 'группы' : 'группа'} ${codes} ${many ? 'связаны' : 'связана'} с этим ведущим${already} · ${a.actor}`
        : `Разобрано: внесён в состав ${many ? 'групп' : 'группы'} ${codes}${already} · ${a.actor}`;
    }
    default:
      return null;
  }
}

/** Число участников с учётом утверждённых после обратной связи; неизвестное остаётся неизвестным, пока никого не утвердили. */
const effectivePeople = (people: number | null, placed: number): number | null =>
  placed > 0 ? (people ?? 0) + placed : people;

/** Откуда значение: правка координатора важнее ответа из анкеты. */
function paramInfo(manual: string | null | undefined, anketa: string | null | undefined): ParamInfo {
  const m = nonBlank(manual);
  if (m) return { text: m, source: 'manual' };
  const a = nonBlank(anketa);
  return a ? { text: a, source: 'anketa' } : { text: null, source: null };
}

/**
 * Заявка «как пришла»: то, что человек заполнил сам (в боте или в форме), без пометок служителей.
 * Нужна, чтобы координатор мог сверить, правильно ли система поняла карточку. Пустое не показываем.
 */
function originalFields(r: DashboardRequest): OriginalField[] {
  const rows: [string, string | null][] = [
    ['ФИО', nonBlank(r.fio)],
    ['Телефон', displayPhone(r.phones, r.phone)],
    ['Возраст', nonBlank(r.age)],
    ['Район и метро (как написал)', nonBlank(r.place)],
    ['Церковь', nonBlank(r.church)],
    ['Ответ про малую группу', r.mdg_status ? (MDG_LABELS[r.mdg_status] ?? null) : null],
    ['Кто ведущий', nonBlank(r.leader_name)],
    ['Удобные дни и время', nonBlank(r.schedule)],
    ['Улица и дом', nonBlank(r.address)],
    ['Вопрос или сообщение', nonBlank(r.text)],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== null).map(([label, value]) => ({ label, value }));
}

function tableFieldsOf(r: DashboardRequest): RequestTableFields {
  return {
    note: nonBlank(r.note), source: nonBlank(r.source), ministry: nonBlank(r.ministry), extra: nonBlank(r.extra),
    recommended: nonBlank(r.recommended), recommendedAt: validIsoDate(r.recommended_at), finalGroup: nonBlank(r.final_group),
    attendance: nonBlank(r.attendance),
  };
}

function sourceOfProposal(
  stored: { groupId: number | null; source: 'script' | 'agent' | 'manual' } | undefined, shownGroupId: number,
): 'script' | 'agent' {
  // «manual» — выбор координатора; в интерфейсе он такой же «не расчёт»: показываем как расчёт, а не как модель.
  return stored && stored.groupId === shownGroupId && stored.source === 'agent' ? 'agent' : 'script';
}

const nonBlank = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};


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
  return buildViewsWithPlan(input, engine, now, options).views;
}

/** Представления и сам план: автоматический подбор берёт из плана то, что нужно сохранить. */
export function buildViewsWithPlan(
  input: ViewsInput, engine: PlanEngineApi, now: Date, options: ViewsOptions = {},
): { views: Views; plan: PlanOutput; openRequestIds: number[]; signatures: Map<number, string>; snapshots: Map<number, InputSnapshot>; assistantCandidates: AssistantCandidate[] } {
  const defaultCapacity = options.defaultCapacity ?? DEFAULT_CAPACITY;
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const today = localIsoDate(now, timeZone);
  const generatedAt = now.toISOString();
  const settings = { ...engine.DEFAULT_SETTINGS, defaultCapacity };

  // Сколько человек в группе, считая ручной состав и утверждённых сервисом: число из таблицы бывает пустым или отстаёт.
  const memberCounts = new Map<number, number>();
  const bump = (groupId: number) => memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1);
  for (const m of input.members ?? []) bump(m.group_id);
  for (const r of input.requests) if (r.status === DONE && r.group_id !== null) bump(r.group_id);
  const headcount = (g: { id: number; people: number | null }): number =>
    Math.max(effectivePeople(g.people, input.placedNew?.get(g.id) ?? 0) ?? 0, memberCounts.get(g.id) ?? 0);
  // Росток — признак новизны действующей группы: только «Функционирует» и только первые четыре месяца после открытия, сколько бы
  // людей ни было (дата — `opened_on`, её ставит база при переводе в «Функционирует»). «На паузе», «Потенциальная» и
  // прочие ростка не получают. У старых групп даты открытия нет — они не новые.
  const isNewGroup = (g: { status: string; opened_on: string | null }): boolean =>
    g.status === 'Функционирует' && !!g.opened_on && (addMonthsIso(g.opened_on, NEW_GROUP_MONTHS) ?? '') > today;
  // Оранжевый росток (поле `empty`) — тоже только у «Функционирует», когда срок новой группы вышел, а людей мало. Если набралось
  // хотя бы три человека, отметка просто снимается; не набралось (у группы с датой открытия) — росток оранжевый. Совсем без людей
  // он оранжевый и у старых групп без даты. У новой группы его нет.
  const isWiltedGroup = (g: { id: number; status: string; opened_on: string | null; people: number | null }): boolean => {
    if (g.status !== 'Функционирует' || isNewGroup(g)) return false;
    const n = headcount(g);
    return n === 0 || (!!g.opened_on && n < NEW_GROUP_MIN_PEOPLE);
  };
  const coordsOf = (address: string | null | undefined) => input.geo?.get(addressKey(address) ?? '') ?? null;
  // Есть запись с точкой — «found», запись «не нашли» — «missing», записи нет (не спрашивали или геокодер выключен) — null.
  const geoStateOf = (address: string | null | undefined): 'found' | 'missing' | null => {
    const key = addressKey(address);
    if (key === null || !input.geo?.has(key)) return null;
    return input.geo.get(key) ? 'found' : 'missing';
  };

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
      // В подбор идёт только название улицы без дома: «Рылеева 30» и «ул. Рылеева, 32» — одна улица. Пустой адрес —
      // подбор откатывается на метро или ориентир (`metro`).
      street: streetName(g.address),
      coords: coordsOf(g.address),
      // Утверждённых сервисом после обратной связи ведущий в число ещё не внёс — добавляем сами.
      people: effectivePeople(g.people, input.placedNew?.get(g.id) ?? 0),
      // Своя вместимость группы; не задана — общая (HG_DEFAULT_CAPACITY).
      capacity: g.capacity ?? defaultCapacity,
      status: g.status,
      // Пусто = принимает: «НЕТ» ставят явно, когда группа полна или не хочет новых.
      acceptsNew: g.open_to_new?.trim().toUpperCase() !== 'НЕТ',
      doNotRefer: g.do_not_refer,
      chamber: g.chamber,
      gender: groupGender(g.composition),
      verifiedDaysAgo: daysSince(validIsoDate(g.feedback_at), today),
      isNew: isNewGroup(g),
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
      direction: g.direction,
      isNew: isNewGroup(g),
      empty: isWiltedGroup(g),
    };
  };

  const metroIndex = engine.buildMetroIndex(input.groups);

  // ── заявки ────────────────────────────────────────────────────────────────
  const joinRequests = input.requests.filter((r) => r.type === 'join_group');

  // ── пол ───────────────────────────────────────────────────────────────────
  // Поставленный вручную или моделью (по ключу человека) важнее вывода из ФИО: ФИО бывает неоднозначным.
  const genders = input.genders ?? new Map<string, GenderRow>();
  const genderOf = (key: string, fio: string | null | undefined): GenderInfo => {
    const own = genders.get(key);
    if (own) return { value: own.gender, by: own.by === GENDER_BY_AI ? 'ai' : 'manual' };
    const guessed = genderFromFio(fio);
    return { value: guessed, by: guessed ? 'fio' : null };
  };
  const requestKey = (r: DashboardRequest): string => (r.user_id !== null ? `u${r.user_id}` : `r${r.id}`);

  /** Удобное время человека: подходящие дни и время суток и то, что он назвал неподходящим («кроме воскресенья»). */
  const humanWhen = (text: string | null): HumanWhen => {
    const w = engine.parseHumanSchedule(text);
    return { days: w.days, slot: w.slot, avoidDays: w.avoidDays, avoidSlots: w.avoidSlots };
  };

  /** Удобное время и улица: правка координатора важнее ответа из анкеты. */
  const scheduleOf = (r: DashboardRequest): ParamInfo => paramInfo(r.manual_schedule, r.schedule);
  const streetOf = (r: DashboardRequest): ParamInfo => paramInfo(r.manual_street, r.address);

  /** Записи человека, которые читает помощник (после очистки от контактов), и разбор скриптом. */
  const briefOf = (r: DashboardRequest): RawBrief => ({ place: nonBlank(r.place), age: nonBlank(r.age), schedule: scheduleOf(r).text });
  /** Разбор помощника применяется, только пока запись та же, по которой он сделан. */
  const hintOf = (r: DashboardRequest): StoredHint | null => {
    const h = input.hints?.get(r.id);
    return h && h.baseHash === baseHash(briefOf(r)) ? h : null;
  };

  /** Что подставил помощник вместо непонятого скриптом — для пометки «проверьте» и для расчёта. */
  const resolveWithHint = (r: DashboardRequest) => {
    const b = briefOf(r);
    const hint = hintOf(r);
    const scriptDistrict = engine.resolveDistrict(b.place, metroIndex);
    const scriptAge = engine.parseAgeRange(r.age);
    const scriptWhen = humanWhen(b.schedule);
    // «Кроме воскресенья» — тоже понятый ответ: помощника из-за него звать не нужно.
    const whenKnown = scriptWhen.days.length > 0 || scriptWhen.slot !== null || scriptWhen.avoidDays.length > 0 || scriptWhen.avoidSlots.length > 0;
    const filled: ('район' | 'возраст' | 'время')[] = [];
    let district = scriptDistrict;
    let ageRange = scriptAge;
    let when = scriptWhen;
    if (hint) {
      if (district === null && hint.district) { district = hint.district; filled.push('район'); }
      const hintAge = hint.age ? engine.parseAgeRange(hint.age) : null;
      if (ageRange === null && hintAge) { ageRange = hintAge; filled.push('возраст'); }
      if (!whenKnown && (hint.days.length > 0 || hint.slot)) {
        when = { days: hint.days as Day[], slot: (hint.slot as Slot | null) ?? null, avoidDays: [], avoidSlots: [] };
        filled.push('время');
      }
    }
    return {
      district, ageRange, when, filled, hint,
      needs: needsOf(b, { district: scriptDistrict, ageKnown: scriptAge !== null, whenKnown }),
      // Что понял скрипт сам (без подстановок помощника) — это и уходит помощнику как уже известное.
      script: { district: scriptDistrict, ageKnown: scriptAge !== null, when: scriptWhen },
    };
  };

  const planRequestOf = (r: DashboardRequest): PlanRequest => {
    const resolved = resolveWithHint(r);
    return {
      id: r.id,
      fio: nonBlank(r.fio) ?? 'Без имени',
      gender: genderOf(requestKey(r), r.fio).value,
      ageRange: resolved.ageRange,
      district: resolved.district,
      place: nonBlank(r.place),
      // Удобные дни и время — свободный текст человека или правка координатора; разбираем его честно:
      // что неясно, остаётся пустым (или берётся из разбора помощника, если он есть).
      days: resolved.when.days,
      slot: resolved.when.slot,
      street: streetOf(r).text,
      coords: coordsOf(streetOf(r).text),
      rejectedGroupIds: [...(input.rejectedGroups?.get(r.id) ?? [])],
      avoidDays: resolved.when.avoidDays,
      avoidSlots: resolved.when.avoidSlots,
      pinnedGroupId: null,
      waitingDays: daysSince(validIsoDate(r.date), today),
    };
  };

  // ── группа, заведённая по заявке ─────────────────────────────────────────
  // Связь — `source_request_id` (миграция 032): потенциальная группа из «хочу открыть» или «Создать группу по заявке».
  const groupBySourceRequest = new Map<number, DashboardGroup>();
  for (const g of input.groups) if (g.source_request_id != null) groupBySourceRequest.set(g.source_request_id, g);
  const ownGroupOf = (r: DashboardRequest): { id: number; code: string } | null => {
    const g = groupBySourceRequest.get(r.id);
    return g ? { id: g.id, code: groupCode(g.id) } : null;
  };
  const DISTRICT_SET: ReadonlySet<string> = new Set(ALL_DISTRICTS);
  const AGE_SET: ReadonlySet<string> = new Set(AGE_GROUPS);
  /**
   * Поля формы «Новая группа» по заявке: ведущий — сам человек, район и улица — как их понял подбор, день — если человек
   * назвал ровно один. Группа новая, поэтому «Потенциальная»: в подбор она пойдёт, когда её переведут в «Функционирует».
   * Всё, что в поля не легло (место словами, удобное время), уходит в комментарий: служитель допишет руками.
   */
  const groupDraftOf = (r: DashboardRequest): GroupDraftView => {
    const lead = planRequestOf(r);
    const place = nonBlank(r.place);
    const schedule = scheduleOf(r).text;
    const age = nonBlank(r.age);
    const phone = nonBlank(r.phone) ?? nonBlank(r.phones?.[0]);
    const fields: Record<string, string> = {
      leader: nonBlank(r.fio) ?? '',
      status: 'Потенциальная',
      comment: [
        `Заведена по заявке №${r.id} («${TYPE_LABEL[r.type as OtherItem['type']] ?? 'обращение'}»)`,
        place ? `Место: ${place}` : null,
        schedule ? `Удобное время: ${schedule}` : null,
      ].filter(Boolean).join('. ') + '.',
      ...(phone ? { phone } : {}),
      ...(lead.district && DISTRICT_SET.has(lead.district) ? { district: lead.district } : {}),
      ...(age && AGE_SET.has(age) ? { age } : {}),
      ...(lead.street ? { address: lead.street } : {}),
      ...(lead.days.length === 1 ? { day: lead.days[0]! } : {}),
    };
    return { requestId: r.id, fio: nonBlank(r.fio) ?? 'Без имени', fields, ownGroup: ownGroupOf(r) };
  };

  // ── метка «Странный человек» ──────────────────────────────────────────────
  // Метка лежит на ключе человека (u12, r345, p7), а записей на одного человека бывает несколько (регистрация, заявка из
  // таблицы, карточка): поэтому метка действует и на тот же телефон. Так её не потерять, если заявку завели по-другому.
  const strangeMarks = input.strange ?? new Map<string, StrangeMarkRow>();
  const phoneIdent = (phone: string | null | undefined): string | null => {
    const digits = (phone ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
  };
  const phonesOfKey = new Map<string, string[]>();
  const addPhones = (key: string, phones: readonly (string | null | undefined)[]) => {
    const idents = phones.map(phoneIdent).filter((x): x is string => x !== null);
    if (idents.length > 0) phonesOfKey.set(key, [...(phonesOfKey.get(key) ?? []), ...idents]);
  };
  for (const u of input.participants) addPhones(`u${u.id}`, [u.phone]);
  for (const p of input.persons ?? []) addPhones(`p${p.id}`, [p.phone]);
  for (const r of input.requests) addPhones(r.user_id !== null ? `u${r.user_id}` : `r${r.id}`, [r.phone, ...r.phones]);
  const strangeByPhone = new Map<string, StrangeMarkRow>();
  for (const [key, row] of strangeMarks) for (const ident of phonesOfKey.get(key) ?? []) strangeByPhone.set(ident, row);
  const toStrange = (row: StrangeMarkRow): StrangeMark => ({ by: row.by, at: new Date(row.at).toISOString(), note: row.note });
  const strangeOf = (key: string, phones: readonly (string | null | undefined)[]): StrangeMark | null => {
    const own = strangeMarks.get(key);
    if (own) return toStrange(own);
    for (const phone of phones) {
      const ident = phoneIdent(phone);
      const byPhone = ident !== null ? strangeByPhone.get(ident) : undefined;
      if (byPhone) return toStrange(byPhone);
    }
    return null;
  };
  const strangeOfRequest = (r: DashboardRequest): StrangeMark | null =>
    strangeOf(r.user_id !== null ? `u${r.user_id}` : `r${r.id}`, [r.phone, ...r.phones]);

  const joinById = new Map(joinRequests.map((r) => [r.id, r]));
  // Отпечаток данных заявки и закрепление: предложение, полученное по другим данным, устарело —
  // его группа не закрепляется, заявку пересчитает следующий «Закрепить подбор» или «Подобрать заново».
  const signatures = new Map<number, string>();
  const snapshots = new Map<number, InputSnapshot>();
  const dataChanged = new Set<number>();
  const planRequests = new Map<number, PlanRequest>();
  for (const r of joinRequests) {
    const base = planRequestOf(r);
    const signature = inputSignature(base);
    signatures.set(r.id, signature);
    snapshots.set(r.id, inputSnapshot(base));
    const stored = input.activeProposals?.get(r.id);
    const changed = stored !== undefined && stored.groupId !== null && stored.inputHash != null && stored.inputHash !== signature;
    if (changed) dataChanged.add(r.id);
    planRequests.set(r.id, { ...base, pinnedGroupId: changed ? null : (stored?.groupId ?? null) });
  }
  const openRequests = joinRequests.filter((r) => r.status !== DONE && r.status !== CANCELLED);
  // Отмеченные «странными» в подбор обычных групп не идут и мест не занимают: для них нужна отдельная группа, и решает человек.
  const strangeIds = new Set(openRequests.filter((r) => strangeOfRequest(r) !== null).map((r) => r.id));
  const openPlanRequests = openRequests.filter((r) => !strangeIds.has(r.id)).map((r) => planRequests.get(r.id)!);

  const plan: PlanOutput = engine.buildPlan({ requests: openPlanRequests, groups: planGroups, settings });
  for (const id of strangeIds) {
    plan.entries.set(id, { kind: 'none', code: 'strange', reason: 'Отмечен как «странный человек»: нужна отдельная группа, подберите её вручную' });
  }

  const bucketById = new Map<number, Bucket>();
  for (const r of joinRequests) {
    bucketById.set(r.id, engine.bucketOf({
      status: r.status, entry: plan.entries.get(r.id), callback: r.callback, settings,
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

  // Что изменилось у заявки с тех пор, как предложили группу: разница между снимком у предложения и текущими данными.
  const changesOf = (requestId: number): DataChange[] | null => {
    if (!dataChanged.has(requestId)) return null;
    const before = input.activeProposals?.get(requestId)?.inputSnapshot;
    const now = snapshots.get(requestId);
    return before && now ? diffSnapshots(before, now) : null;
  };

  const proposalOf = (e: PlanEntryProposal, requestId: number): Proposal | null => {
    const main = candidate(e.main, e.confidence);
    if (!main) return null;
    const displacedGroup = e.displaced ? brief(e.displaced.groupId) : null;
    return {
      // Закреплено, если в «предварительно» уже лежит предложение именно на эту группу.
      saved: input.activeProposals?.get(requestId)?.groupId === main.group.id && !dataChanged.has(requestId),
      dataChanged: dataChanged.has(requestId),
      changes: changesOf(requestId),
      // Источник — тот, кто предложил эту группу и сохранил предложение; иначе это свежий расчёт.
      source: sourceOfProposal(input.activeProposals?.get(requestId), main.group.id),
      main,
      knownParams: e.knownParams,
      alternatives: e.alternatives.map((a) => candidate(a, a.confidence ?? null)).filter((c): c is Candidate => c !== null),
      displaced: e.displaced && displacedGroup ? { group: displacedGroup, takenBy: e.displaced.takenBy } : null,
    };
  };

  const splitEntry = (entry: PlanEntry | undefined, requestId: number): { proposal: Proposal | null; noPlan: NoPlan | null } => {
    if (!entry) return { proposal: null, noPlan: null };
    if (entry.kind === 'none') return { proposal: null, noPlan: { code: entry.code, reason: entry.reason } };
    const proposal = proposalOf(entry, requestId);
    // Движок назвал группу, которой нет в справочнике, — не показываем полуплан.
    return proposal
      ? { proposal, noPlan: null }
      : { proposal: null, noPlan: { code: 'nogroup', reason: 'Предложенная группа не найдена в справочнике' } };
  };

  const auditByRequest = new Map<number, AuditRow[]>();
  for (const a of input.audit ?? []) auditByRequest.set(a.entity_id, [...(auditByRequest.get(a.entity_id) ?? []), a]);

  const logOf = (r: DashboardRequest, finalBrief: GroupBrief | null): LogEntry[] => {
    const log: LogEntry[] = [{ at: validIsoDate(r.date), text: `Заявка создана (${sourceLabel(r.origin, r.source)})` }];
    const recommended = nonBlank(r.recommended);
    if (recommended) log.push({ at: validIsoDate(r.recommended_at), text: `Рекомендована группа: ${recommended}` });
    const trail = auditByRequest.get(r.id) ?? [];
    const approved = nonBlank(r.final_group)
      ?? (r.status === DONE && finalBrief ? `${finalBrief.code}, ${finalBrief.leader}` : null);
    // Если утверждение есть в журнале, строка о нём придёт оттуда — с автором и датой.
    if (approved && !trail.some((a) => a.action === 'request.approve')) log.push({ at: null, text: `Утверждена: ${approved}` });
    for (const a of trail) {
      const text = auditText(a);
      if (text) log.push({ at: a.at ? localIsoDate(a.at, timeZone) : null, text });
    }
    const cancelReason = nonBlank(r.cancel_reason);
    if (cancelReason) log.push({ at: null, text: `Причина аннулирования: ${cancelReason}` });
    const attendance = nonBlank(r.attendance);
    if (attendance) log.push({ at: null, text: `Контроль посещения: ${attendance}` });
    return log;
  };

  /** Разбор помощника для карточки: что он определил (проверьте) и что советует спросить. */
  const assistantNote = (r: DashboardRequest): AssistantNote | null => {
    const { hint, filled } = resolveWithHint(r);
    if (!hint || (filled.length === 0 && hint.questions.length === 0 && !hint.note)) return null;
    return { filled, questions: [...hint.questions], note: hint.note ?? null };
  };

  // Что помощник может разобрать сейчас: открытые заявки, где в записи есть текст, а скрипт его не понял, и разбора ещё нет.
  const assistantCandidates: AssistantCandidate[] = [];
  // Окно «ИИ-разбор»: разобранные, где чего-то не хватает (ждут служителя), и ещё не разобранные.
  const reviewed: AssistantReviewItem[] = [];
  const unreviewed: AssistantReviewItem[] = [];
  for (const r of openRequests) {
    const resolved = resolveWithHint(r);
    if (!anyNeed(resolved.needs)) continue;
    const b = briefOf(r);
    const missing = (['район', 'возраст', 'время'] as const).filter((f, i) =>
      [resolved.needs.district, resolved.needs.age, resolved.needs.time][i] && !resolved.filled.includes(f));
    const item = (state: AssistantReviewItem['state']): AssistantReviewItem => ({
      requestId: r.id, fio: nonBlank(r.fio) ?? 'Без имени', state, missing, filled: resolved.filled,
      questions: [...(resolved.hint?.questions ?? [])], note: resolved.hint?.note ?? null,
      place: b.place, age: b.age, schedule: b.schedule,
    });
    // Помощнику уходит и то, что скрипт уже понял (район, дни, время суток), чтобы он не разбирал это заново.
    if (!resolved.hint) {
      assistantCandidates.push({ id: r.id, brief: b, needs: resolved.needs, script: scriptFactsOf(resolved.script) });
      unreviewed.push(item('new'));
    } else if (missing.length > 0) {
      reviewed.push(item('reviewed'));
    }
  }

  const requestItems: RequestItem[] = [];
  for (const r of joinRequests) {
    const bucket = bucketById.get(r.id)!;
    if (bucket === 'cancelled') continue;
    const pr = planRequests.get(r.id)!;
    const { proposal, noPlan } = splitEntry(plan.entries.get(r.id), r.id);
    const finalBrief = bucket === 'done' && r.group_id !== null ? brief(r.group_id) : null;
    requestItems.push({
      id: r.id,
      personKey: r.user_id !== null ? `u${r.user_id}` : `r${r.id}`,
      strange: strangeOfRequest(r),
      gender: genderOf(requestKey(r), r.fio),
      contactsHidden: false,
      fio: pr.fio,
      phone: displayPhone(r.phones, r.phone),
      ageLabel: nonBlank(r.age),
      place: pr.place,
      district: pr.district,
      days: pr.days,
      slot: pr.slot,
      scheduleInfo: scheduleOf(r),
      streetInfo: streetOf(r),
      streetGeo: geoStateOf(streetOf(r).text),
      hobby: nonBlank(r.hobby), profession: nonBlank(r.profession), family: nonBlank(r.family),
      original: originalFields(r),
      street: pr.street,
      source: sourceLabel(r.origin, r.source),
      status: r.status,
      bucket,
      callback: r.callback,
      waitingDays: pr.waitingDays,
      dataFill: [pr.district !== null, pr.ageRange !== null, pr.days.length > 0 || pr.slot !== null, pr.street !== null],
      proposal,
      noPlan,
      assistant: assistantNote(r),
      finalGroup: finalBrief,
      ownGroup: ownGroupOf(r),
      finalGroupText: bucket === 'done' && !finalBrief ? nonBlank(r.final_group) : null,
      responsible: nonBlank(r.responsible),
      note: joinParts([r.note, r.extra], ' | '),
      table: tableFieldsOf(r),
      log: logOf(r, finalBrief),
    });
  }
  // ── «Хотят открыть группу»: кого можно направить в будущую группу ───────────
  // Координатор при звонке говорит «могли бы направить к вам N человек»: считаем всех открытых «хочу в группу», кому
  // будущая группа подходит, даже если подбор уже предложил им другую (её код — рядом). Будущая группа — потенциальная,
  // заведённая по обращению (`source_request_id`, миграция 032), а без неё — ответы самого обращения.
  const prospectsOf = (r: DashboardRequest): Prospects => {
    const linked = groupBySourceRequest.get(r.id);
    let future = linked ? planGroupById.get(linked.id) ?? null : null;
    if (!future) {
      const lead = planRequestOf(r);
      if (lead.district === null && !lead.coords) return { futureGroup: null, unknownPlace: true, total: 0, items: [] };
      future = {
        id: -r.id, no: null, leader: nonBlank(r.fio) ?? '', district: lead.district ?? 'Не указан', metro: null,
        ageRange: lead.ageRange, day: lead.days[0] ?? null, slot: lead.slot, street: lead.street, coords: lead.coords ?? null,
        people: 0, capacity: defaultCapacity, status: 'Потенциальная', acceptsNew: true, doNotRefer: false, verifiedDaysAgo: null,
      };
    }
    const scored = openPlanRequests
      .map((pr) => ({ pr, s: engine.scoreProspect(pr, future!, settings) }))
      .filter((x): x is { pr: PlanRequest; s: NonNullable<typeof x.s> } => x.s !== null)
      .sort((a, b) => b.s.score - a.s.score || (b.pr.waitingDays ?? -1) - (a.pr.waitingDays ?? -1) || a.pr.id - b.pr.id);
    const items = scored.slice(0, PROSPECTS_SHOWN).map(({ pr, s }): ProspectItem => {
      const entry = plan.entries.get(pr.id);
      const src = joinById.get(pr.id);
      return {
        requestId: pr.id, fio: pr.fio, ageLabel: nonBlank(src?.age), place: nonBlank(src?.place), score: s.score, reasons: s.reasons,
        proposed: entry?.kind === 'proposal' ? groupCode(entry.main.groupId) : null,
      };
    });
    return { futureGroup: linked ? { id: linked.id, code: groupCode(linked.id) } : null, unknownPlace: false, total: scored.length, items };
  };

  // Остальные обращения: всё, что не идёт в подбор, и аннулированные «хочу в группу» (чтобы вернуть в работу).
  const otherAll = input.requests.filter((r) => r.type !== 'join_group' || bucketById.get(r.id) === 'cancelled');
  const nonJoin = input.requests.filter((r) => r.type !== 'join_group');
  const otherState = (r: DashboardRequest): OtherItem['state'] => (r.status === DONE ? 'done' : r.status === CANCELLED ? 'cancelled' : 'open');
  /**
   * Чем закончилось закрытое обращение. Берём последнюю закрывающую запись журнала: разбор по справочникам
   * («Разобрать все готовые» закрывает пачкой и ответственного не ставит — отсюда «обработано» без «в работе у»)
   * или «Закрыть». Записи нет — обращение закрыли в таблице церкви или до журнала: говорим, что знаем.
   */
  const outcomeOf = (r: DashboardRequest): OtherItem['outcome'] => {
    if (otherState(r) === 'open') return null;
    const closing = (auditByRequest.get(r.id) ?? []).filter((a) => a.action === 'request.reconcile' || a.action === 'request.close').at(-1);
    const at = closing ? localIsoDate(closing.at, timeZone) : null;
    if (closing?.action === 'request.reconcile') {
      const after = closing.after ?? {};
      const raw = Array.isArray(after['group_ids']) ? after['group_ids'] : [after['group_id']];
      const groups = raw.map(Number).filter((n) => Number.isFinite(n)).map((id) => ({ id, code: groupCode(id) }));
      const text = after['kind'] === 'leader' ? 'Разобрано: связан с группой как ведущий' : 'Разобрано: внесён в состав группы';
      return { text, by: closing.actor, at, groups };
    }
    if (closing?.action === 'request.close') {
      const after = closing.after ?? {};
      const text = after['outcome'] === 'cancel' ? `Аннулировано: ${CANCEL_TEXT[String(after['reason'])] ?? 'причина не указана'}` : 'Закрыто: отмечено обработанным';
      return { text, by: closing.actor, at, groups: [] };
    }
    const groups = r.group_id !== null ? [{ id: r.group_id, code: groupCode(r.group_id) }] : [];
    const text = r.origin === 'таблица' ? 'Закрыто в таблице церкви' : 'Закрыто без записи в журнале';
    return { text, by: nonBlank(r.responsible), at: null, groups };
  };
  const otherItem = (r: DashboardRequest): OtherItem => ({
    id: r.id,
    strange: strangeOfRequest(r),
    contactsHidden: false,
    type: r.type as OtherItem['type'],
    typeLabel: TYPE_LABEL[r.type as OtherItem['type']] ?? 'Обращение',
    gist: gistOf(r),
    // Разбор по справочникам нужен только открытым: закрытое уже разобрано или отложено людьми.
    reconcile: otherState(r) === 'open' ? reconcileOf(r, input.groups) : null,
    state: otherState(r),
    fio: nonBlank(r.fio) ?? 'Без имени',
    phone: displayPhone(r.phones, r.phone),
    ageLabel: nonBlank(r.age),
    place: nonBlank(r.place),
    status: r.status,
    source: sourceLabel(r.origin, r.source),
    waitingDays: daysSince(validIsoDate(r.date), today),
    callback: r.callback,
    responsible: nonBlank(r.responsible),
    note: joinParts([r.note, r.extra], ' | '),
    address: streetOf(r).text,
    schedule: scheduleOf(r).text,
    hobby: nonBlank(r.hobby), profession: nonBlank(r.profession), family: nonBlank(r.family),
    cancelReason: nonBlank(r.cancel_reason),
    original: originalFields(r),
    table: tableFieldsOf(r),
    log: logOf(r, null),
    prospects: r.type === 'lead_group' && otherState(r) === 'open' ? prospectsOf(r) : null,
    ownGroup: ownGroupOf(r),
    // Аннулированная заявка «хочу в группу» без регистрации — тоже человек в «Людях» (ключ «r»).
    personKey: r.user_id !== null ? `u${r.user_id}` : r.type === 'join_group' ? `r${r.id}` : null,
    outcome: outcomeOf(r),
  });
  const otherOpen = otherAll.filter((r) => otherState(r) === 'open').map(otherItem)
    .sort((a, b) => Number(b.callback) - Number(a.callback) || (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.id - b.id);
  const otherClosed = otherAll.filter((r) => otherState(r) !== 'open').map(otherItem)
    .sort((a, b) => b.id - a.id).slice(0, OTHER_CLOSED_LIMIT);

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

  // Состав групп: направленные через сервис (заявка «Исполнена» с группой) и внесённые вручную (ссылки на справочник людей).
  const membersByGroup = new Map<number, GroupMember[]>();
  const addMember = (groupId: number, m: GroupMember) => membersByGroup.set(groupId, [...(membersByGroup.get(groupId) ?? []), m]);
  // Человек из справочника один и тот же независимо от того, как он в состав попал: ключ u/r/p.
  const manualKeys = new Map<number, Set<string>>();
  for (const m of input.members ?? []) {
    manualKeys.set(m.group_id, (manualKeys.get(m.group_id) ?? new Set<string>()).add(m.personKey));
    addMember(m.group_id, {
      kind: 'manual', id: m.id, personKey: m.personKey, fio: nonBlank(m.full_name) ?? 'Без имени',
      phone: nonBlank(formatPhone(nonBlank(m.phone))), date: validIsoDate(m.joined_on), note: nonBlank(m.note), alsoIn: [],
      strange: strangeOf(m.personKey, [m.phone]),
    });
  }
  for (const r of joinRequests) {
    if (r.status !== DONE || r.group_id === null) continue;
    const key = r.user_id !== null ? `u${r.user_id}` : `r${r.id}`;
    // Внесён и вручную, и утверждён: показываем одну строку, ручная точнее (в ней дата вступления).
    if (manualKeys.get(r.group_id)?.has(key)) continue;
    const approved = (auditByRequest.get(r.id) ?? []).filter((a) => a.action === 'request.approve').at(-1);
    addMember(r.group_id, {
      kind: 'placed', id: r.id, personKey: key, fio: nonBlank(r.fio) ?? 'Без имени', phone: displayPhone(r.phones, r.phone),
      date: approved?.at ? localIsoDate(approved.at, timeZone) : null, note: null, alsoIn: [],
      strange: strangeOf(key, [r.phone, ...r.phones]),
    });
  }
  // «Есть и в другой группе»: тот же человек по телефону, а без телефона — по ключу справочника.
  const identOf = (m: GroupMember): string => {
    const digits = (m.phone ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? `t:${digits.slice(-10)}` : `k:${m.personKey}`;
  };
  const groupsOfIdent = new Map<string, Set<number>>();
  const groupsOfPerson = new Map<string, Set<number>>();
  for (const [groupId, list] of membersByGroup) {
    for (const m of list) {
      groupsOfIdent.set(identOf(m), (groupsOfIdent.get(identOf(m)) ?? new Set<number>()).add(groupId));
      groupsOfPerson.set(m.personKey, (groupsOfPerson.get(m.personKey) ?? new Set<number>()).add(groupId));
    }
  }
  for (const [groupId, list] of membersByGroup) {
    for (const m of list) {
      m.alsoIn = [...(groupsOfIdent.get(identOf(m)) ?? [])].filter((id) => id !== groupId).sort((x, y) => x - y).map(groupCode);
    }
  }
  const memberOrder = (m: GroupMember): number => (m.kind === 'placed' ? 0 : 1);
  const groupCodesOf = (key: string): string[] => [...(groupsOfPerson.get(key) ?? [])].sort((x, y) => x - y).map(groupCode);
  // Где человек ведущий или соведущий: обратная сторона ссылок группы на людей. Ключ — как в «Людях» («u12», «p7»).
  const leadsByKey = new Map<string, PersonItem['leads']>();
  for (const g of input.groups) {
    const put = (key: string | null, role: 'leader' | 'coLeader') => {
      if (key) leadsByKey.set(key, [...(leadsByKey.get(key) ?? []), { groupId: g.id, code: groupCode(g.id), role }]);
    };
    put(g.leader_user_id ? `u${g.leader_user_id}` : g.leader_person_id ? `p${g.leader_person_id}` : null, 'leader');
    put(g.co_leader_user_id ? `u${g.co_leader_user_id}` : g.co_leader_person_id ? `p${g.co_leader_person_id}` : null, 'coLeader');
  }
  const leadsOf = (key: string): PersonItem['leads'] => leadsByKey.get(key) ?? [];
  // Заявки человека — для переходов из его карточки. Типы подписываем так же, как в списках.
  const requestRef = (r: DashboardRequest): PersonItem['requests'][number] => ({
    id: r.id,
    kind: r.type === 'join_group' ? 'join' : r.type === 'lead_group' ? 'lead' : 'other',
    label: r.type === 'join_group' ? 'Заявка в группу' : (TYPE_LABEL[r.type as OtherItem['type']] ?? 'Обращение'),
    state: otherState(r),
  });
  const requestsByUser = new Map<number, PersonItem['requests']>();
  for (const r of [...input.requests].sort((a, b) => b.id - a.id)) {
    if (r.user_id !== null) requestsByUser.set(r.user_id, [...(requestsByUser.get(r.user_id) ?? []), requestRef(r)]);
  }

  // ── ответ ведущего боту ───────────────────────────────────────────────────
  // Ведущему досылаем вопросы «когда собирается группа» и «где встречи». Ответ в карточку группы сам не переносится:
  // координатор сверяет его и правит группу. Ведущего находим по связи с регистрацией, а без неё — по телефону группы,
  // но только среди ответивших «веду группу»: у ищущего тот же вопрос про время значит его пожелание, а не время группы.
  const participantById = new Map(input.participants.map((u) => [u.id, u]));
  const leaderByPhone = new Map<string, RegisteredParticipant>();
  for (const u of input.participants) {
    const ident = u.mdg_status === 'leader' ? phoneIdent(u.phone) : null;
    if (ident !== null) leaderByPhone.set(ident, u);
  }
  const leaderAnswerOf = (g: DashboardGroup): GroupItem['leaderAnswer'] => {
    const byPhone = [g.phone, ...g.phones].map(phoneIdent).find((i) => i !== null && leaderByPhone.has(i));
    const u = (g.leader_user_id ? participantById.get(g.leader_user_id) : undefined) ?? (byPhone ? leaderByPhone.get(byPhone) : undefined);
    const schedule = nonBlank(u?.schedule);
    const address = nonBlank(u?.address);
    return schedule || address ? { schedule, address } : null;
  };

  // ── ведущие как люди из «Людей» ──────────────────────────────────────────
  // Телефон связанного ведущего или соведущего берётся из его карточки: номер правят там, а не в группе. Записанный в
  // группе номер остаётся запасным — пока человек не выбран, его карточку удалили или номера в ней нет.
  const personById = new Map((input.persons ?? []).map((p) => [p.id, p]));
  const keyOf = (userId: number | null, personId: number | null): string | null =>
    userId ? `u${userId}` : personId ? `p${personId}` : null;
  const linkedPhone = (userId: number | null, personId: number | null): string | null => {
    const found = userId ? participantById.get(userId) : personId ? personById.get(personId) : undefined;
    return nonBlank(formatPhone(nonBlank(found?.phone)));
  };

  const groupItems: GroupItem[] = input.groups.map((g) => {
    const p = planGroupById.get(g.id)!;
    const b = brief(g.id)!;
    return {
      ...b,
      coLeader: nonBlank(g.co_leader),
      phone: linkedPhone(g.leader_user_id, g.leader_person_id) ?? displayPhone(g.phones, g.phone),
      coLeaderPhone: linkedPhone(g.co_leader_user_id, g.co_leader_person_id) ?? nonBlank(formatPhone(nonBlank(g.co_leader_phone))),
      address: nonBlank(g.address),
      ageText: nonBlank(g.age),
      day: p.day,
      slot: p.slot,
      status: g.status,
      acceptsNew: p.acceptsNew,
      openToNew: nonBlank(g.open_to_new),
      capacityOwn: g.capacity,
      training: nonBlank(g.training),
      checked: g.checked === true,
      campaignRegistered: g.campaign_registered,
      campaignOnly: g.campaign_only,
      doNotRefer: p.doNotRefer,
      chamber: g.chamber,
      contactsHidden: false,
      composition: nonBlank(g.composition),
      coordinator: nonBlank(g.coordinator),
      verifiedDaysAgo: p.verifiedDaysAgo,
      openedOn: validIsoDate(g.opened_on),
      comment: nonBlank(g.comment),
      health: groupHealth(g, p),
      addressGeo: geoStateOf(g.address),
      coords: coordsOf(g.address),
      placedNew: input.placedNew?.get(g.id) ?? 0,
      leaderKey: keyOf(g.leader_user_id, g.leader_person_id),
      coLeaderKey: keyOf(g.co_leader_user_id, g.co_leader_person_id),
      leaderAnswer: leaderAnswerOf(g),
      plannedRequests: plannedByGroup.get(g.id) ?? [],
      members: [...(membersByGroup.get(g.id) ?? [])].sort((a, b) => memberOrder(a) - memberOrder(b)),
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
      strange: strangeOf(`u${u.id}`, [u.phone]),
      gender: genderOf(`u${u.id}`, u.full_name),
      contactsHidden: false,
      personId: null,
      groups: groupCodesOf(`u${u.id}`),
      leads: leadsOf(`u${u.id}`),
      requests: requestsByUser.get(u.id) ?? [],
      fio: nonBlank(u.full_name) ?? 'Без имени',
      phone: nonBlank(formatPhone(nonBlank(u.phone))),
      ageLabel: nonBlank(u.age),
      district: engine.resolveDistrict(nonBlank(u.location), metroIndex),
      place: nonBlank(u.location),
      address: nonBlank(u.address),
      schedule: nonBlank(u.schedule),
      hobby: nonBlank(u.hobby), profession: nonBlank(u.profession), family: nonBlank(u.family), note: nonBlank(u.note),
      church: nonBlank(u.church), leaderName: nonBlank(u.leader_name),
      preferredContact: u.preferred_contact ? (CONTACT_LABEL[u.preferred_contact] ?? u.preferred_contact) : null,
      addressGeo: geoStateOf(u.address),
      // Заведённый служителем вручную: платформа в записи условная, чата с ботом нет.
      from: !u.has_chat ? 'Форма регистрации' : u.platform === 'max' ? 'Бот · MAX' : 'Бот · Telegram',
      userId: u.id,
      registrationNo: u.registration_no ?? null,
      mdgLabel: (u.mdg_status && MDG_LABELS[u.mdg_status]) || MDG_NO_ANSWER,
      date: localIsoDate(new Date(u.registered_at), options.timeZone ?? DEFAULT_TIME_ZONE),
      requestId: joinRequestByUser.get(u.id) ?? null,
      // Дата по поясу кампании, а не toISOString(): выдача в половине первого ночи по Москве иначе ушла бы во вчера.
      kitIssuedOn: u.kit_issued_at ? localIsoDate(new Date(u.kit_issued_at), options.timeZone ?? DEFAULT_TIME_ZONE) : null,
    });
  }
  for (const r of joinRequests) {
    if (r.user_id !== null) continue;
    const pr = planRequests.get(r.id)!;
    people.push({
      key: `r${r.id}`,
      strange: strangeOfRequest(r),
      gender: genderOf(`r${r.id}`, r.fio),
      contactsHidden: false,
      personId: null,
      groups: groupCodesOf(`r${r.id}`),
      leads: leadsOf(`r${r.id}`),
      requests: [requestRef(r)],
      fio: pr.fio,
      phone: displayPhone(r.phones, r.phone),
      ageLabel: nonBlank(r.age),
      district: pr.district,
      place: nonBlank(r.place),
      address: streetOf(r).text,
      schedule: scheduleOf(r).text,
      hobby: nonBlank(r.hobby), profession: nonBlank(r.profession), family: nonBlank(r.family), note: nonBlank(r.note),
      church: null, leaderName: null, preferredContact: null,
      addressGeo: geoStateOf(streetOf(r).text),
      from: sourceLabel(r.origin, r.source),
      userId: r.user_id,
      registrationNo: null,
      mdgLabel: `Заявка: ${BUCKET_NAMES[bucketById.get(r.id)!]}`,
      date: validIsoDate(r.date),
      requestId: r.id,
      kitIssuedOn: null,
    });
  }
  // Карточки, внесённые вручную (кого нет ни среди зарегистрированных, ни среди заявок).
  for (const p of input.persons ?? []) {
    people.push({
      key: `p${p.id}`,
      strange: strangeOf(`p${p.id}`, [p.phone]),
      gender: genderOf(`p${p.id}`, p.full_name),
      contactsHidden: false,
      personId: p.id,
      groups: groupCodesOf(`p${p.id}`),
      leads: leadsOf(`p${p.id}`),
      requests: [],
      fio: nonBlank(p.full_name) ?? 'Без имени',
      phone: nonBlank(formatPhone(nonBlank(p.phone))),
      ageLabel: nonBlank(p.age),
      district: engine.resolveDistrict(nonBlank(p.place), metroIndex),
      place: nonBlank(p.place),
      address: nonBlank(p.address),
      schedule: nonBlank(p.schedule),
      hobby: nonBlank(p.hobby), profession: nonBlank(p.profession), family: nonBlank(p.family), note: nonBlank(p.note),
      church: null, leaderName: null, preferredContact: null,
      addressGeo: geoStateOf(p.address),
      from: 'Внесён вручную',
      userId: null,
      registrationNo: null,
      mdgLabel: 'Не спрошено',
      date: localIsoDate(new Date(p.created_at), options.timeZone ?? DEFAULT_TIME_ZONE),
      requestId: null,
      kitIssuedOn: null,
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
      roleIds: c.role_ids,
      groups: own.length,
      people: own.reduce((sum, p) => sum + (p.people ?? 0), 0),
      verified30: own.filter((p) => p.verifiedDaysAgo !== null && p.verifiedDaysAgo <= FRESH_FEEDBACK_DAYS).length,
    };
  });

  // Ждут подбора: у открытой заявки есть что предложить, но предложение ещё не сохранено
  // (новая заявка или прежнее стало недоступно). Их и подбирает кнопка или автоматический запуск.
  let waiting = 0;
  let saved = 0;
  for (const r of openRequests) {
    const entry = plan.entries.get(r.id);
    if (entry?.kind !== 'proposal') continue;
    if (input.activeProposals?.get(r.id)?.groupId === entry.main.groupId && !dataChanged.has(r.id)) saved += 1;
    else waiting += 1;
  }
  // Утверждено сегодня: записи журнала с датой «сегодня» в поясе сервиса.
  const approvedToday = (input.audit ?? []).filter(
    (a) => a.action === 'request.approve' && localIsoDate(a.at, timeZone) === today,
  ).length;

  const views: Views = {
    team: buildTeam(requestItems, [...(input.activity ?? [])], generatedAt, [...otherOpen, ...otherClosed]),
    today: {
      generatedAt,
      counters,
      approvedToday,
      // «Распределено X из Y»: отказ из знаменателя убираем — человек ушёл, распределять его не надо.
      assigned: counters.ready + counters.callback + counters.done,
      total: joinRequests.length - counters.cancelled,
      // Общее число без вычитаний: исполненные остаются в нём. «Другие обращения» берём из полного списка, а не из
      // урезанного списка закрытых (OTHER_CLOSED_LIMIT): иначе число росло бы и падало с лимитом.
      // Аннулированные «хочу в группу» есть и в joinRequests, и в otherAll: считаем только обращения не из подбора.
      requestsAll: joinRequests.length + nonJoin.length,
      requestsDone: counters.done + nonJoin.filter((r) => otherState(r) === 'done').length,
      ageColumns: summary.ageColumns,
      matrix: summary.matrix,
      clusters: summary.clusters,
      singles: summary.singles,
    },
    requests: {
      generatedAt,
      matching: { auto: input.matching?.auto ?? false, lastRun: input.matching?.lastRun ?? null, waiting, saved },
      items: requestItems,
      counters,
      others: [...otherOpen, ...otherClosed],
      assistant: { available: input.assistant?.available ?? false, enabled: input.assistant?.enabled ?? false, pending: assistantCandidates.length, review: [...reviewed, ...unreviewed] },
    },
    groups: { generatedAt, items: groupItems },
    people: { generatedAt, items: people },
    coordinators: { generatedAt, items: coordinatorItems },
    groupDrafts: new Map(input.requests.map((r) => [r.id, groupDraftOf(r)])),
  };
  return { views, plan, openRequestIds: openRequests.map((r) => r.id), signatures, snapshots, assistantCandidates };
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
