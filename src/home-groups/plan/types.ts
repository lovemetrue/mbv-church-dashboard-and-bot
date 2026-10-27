import type { Cluster, MatrixRow, Reason, Single } from '../contracts.js';

/**
 * Типы движка плана распределения (чистая логика, без базы и сети).
 *
 * Сервер превращает строки базы в эти типы (`PlanRequest`, `PlanGroup`), движок возвращает план
 * (`PlanOutput`), а сервер оборачивает его в контракт API (`contracts.ts`). Так движок тестируется
 * без базы, как анкета в боте (`src/core/fsm.ts`).
 */

export type Slot = 'утро' | 'день' | 'вечер';
export type Day = 'Пн' | 'Вт' | 'Ср' | 'Чт' | 'Пт' | 'Сб' | 'Вс';

/** Возраст как диапазон лет включительно; null — неизвестен. */
export type AgeRange = [number, number] | null;

export interface PlanGroup {
  id: number;
  no: number | null;
  leader: string;
  /** Район из справочника (`DISTRICTS`) или «Не указан». */
  district: string;
  metro: string | null;
  ageRange: AgeRange;
  /** Разобранные день и время суток; null, если не указаны или не разобрались. */
  day: Day | null;
  slot: Slot | null;
  /**
   * Улица группы (только название, без дома) для подбора рядом, из адреса группы. null — адрес не заполнен: тогда
   * подбор сопоставляет по метро или ориентиру (`metro`).
   */
  street: string | null;
  /** Координаты адреса группы (из кэша геокодера); null — адреса нет или его не нашли. */
  coords?: { lat: number; lon: number; accuracy?: 'house' | 'street' | 'area' } | null;
  /** Участников сейчас; null — неизвестно (тогда считаем, что места есть, и ставим пометку). */
  people: number | null;
  /** Вместимость; если в базе не задана, сервер подставляет значение по умолчанию (10). */
  capacity: number;
  status: string;
  /** «Приём новых» не «Нет». */
  acceptsNew: boolean;
  /** Отметка «Не направлять»: группа скрыта из подбора. */
  doNotRefer: boolean;
  /** «Камерная группа» (служителей или отдельного служения): тоже скрыта из подбора, но причина своя. */
  chamber?: boolean;
  /** Мужская («м») или женская («ж») группа — из состава; null или нет — смешанная, принимает всех. */
  gender?: 'м' | 'ж' | null;
  /** Дней с последней обратной связи; null — не было. */
  verifiedDaysAgo: number | null;
  /** Новая группа (первые четыре месяца после открытия, кампания): подбор предлагает лучшую из таких главным вариантом. */
  isNew?: boolean;
}

export interface PlanRequest {
  id: number;
  fio: string;
  /**
   * Пол человека: поставленный служителем или выведенный из ФИО. null — не понять; тогда мужские и женские группы ему
   * не предлагаются, пока пол не укажут (ошибка отправила бы человека в чужую группу). Нет поля — как null.
   */
  gender?: 'м' | 'ж' | null;
  ageRange: AgeRange;
  /** Нормализованный район; null — не определился (заявка уходит человеку на уточнение). */
  district: string | null;
  place: string | null;
  /** Удобные дни и время суток: разбор текста человека (`parseHumanSchedule`) или правка координатора. */
  days: Day[];
  slot: Slot | null;
  street: string | null;
  /** Координаты адреса человека (из кэша геокодера); null — адреса нет или его не нашли. */
  coords?: { lat: number; lon: number; accuracy?: 'house' | 'street' | 'area' } | null;
  /** Для этапа B (отказ из обзвона): сейчас пусто. */
  rejectedGroupIds: number[];
  /**
   * Дни и время суток, которые не подходят: из текста человека («кроме воскресенья», «не утром») и из отказов.
   * Группы с таким днём или временем суток в подбор не попадают.
   */
  avoidDays: Day[];
  avoidSlots: Slot[];
  /** Выбор человека «вместо» предложенной группы; сейчас null. */
  pinnedGroupId: number | null;
  /**
   * Группы, предложенные человеку раньше и снятые только потому, что группа перестала принимать людей (данные заявки с тех
   * пор те же), — свежая первой. Снова доступная из них сильнее закреплённого автоматом: человек возвращается туда, куда
   * его уже определили. Предложение, поставленное вручную, сюда не попадает (его не отменяет).
   */
  restoreGroupIds?: number[];
  /** Дней в ожидании; null — даты нет. */
  waitingDays: number | null;
}

export interface PlanSettings {
  /**
   * Веса параметров подбора: район, день недели, возраст, время суток, улица. День недели весит ровно столько же,
   * сколько район (в `DEFAULT_SETTINGS` оба берутся из одной константы): человек не поедет через полгорода, но и
   * в «не свой» день не придёт.
   */
  weights: { district: number; day: number; age: number; slot: number; street: number };
  defaultCapacity: number;
  /** Уверенность ниже этого порога — «нужна помощь» (60). */
  humanThreshold: number;
  /** Сколько дней без подтверждения ведущим, после которых группа теряет баллы (30). */
  staleDays: number;
  stalePenalty: number;
  /** Штраф, если в группе свободно одно место (3). */
  lastSeatPenalty: number;
  /** Уверенность = совпадение × (floor + span × доля известных параметров). */
  confidenceFloor: number;
  confidenceSpan: number;
  /** Район → соседние районы. Лежит в данных, а не в коде (`geo.ts`). */
  neighbors: Record<string, string[]>;
}

/** Группа с оценкой для одной заявки. */
export interface ScoredGroup {
  groupId: number;
  /** Совпадение 0–100 по известным параметрам, с поправками. */
  score: number;
  /**
   * Уверенность 0–100 в той же шкале, что у главной группы предложения (`PlanEntryProposal.confidence`). Есть у запасных
   * вариантов: по ней их сравнивают с главной и с порогом «Нужна помощь». У остальных оценок не ставится.
   */
  confidence?: number;
  reasons: Reason[];
}

export interface PlanEntryProposal {
  kind: 'proposal';
  main: ScoredGroup;
  /** Уверенность 0–100: score × (floor + span × knownParams / 4). */
  confidence: number;
  /** Сколько из четырёх параметров (район, возраст, день и время, улица) известно у заявки. */
  knownParams: number;
  /** До двух запасных групп из оставшихся свободными. */
  alternatives: ScoredGroup[];
  /** Лучшая группа по оценке, место в которой отдано другим; names — ФИО этих людей. */
  displaced: { groupId: number; takenBy: string[] } | null;
}

export interface PlanEntryNone {
  kind: 'none';
  /** strange — человек отмечен как «странный»: в обычные группы не подбирается, нужна отдельная группа (решает человек). */
  code: 'place' | 'taken' | 'nogroup' | 'strange';
  reason: string;
}

export type PlanEntry = PlanEntryProposal | PlanEntryNone;

export interface PlanInput {
  /** Только открытые заявки на посещение группы (без «Исполнена» и «Аннулирована»). */
  requests: PlanRequest[];
  groups: PlanGroup[];
  settings: PlanSettings;
}

export interface PlanOutput {
  /** План по каждой заявке из входа. */
  entries: Map<number, PlanEntry>;
  /** Группа → заявки, которым план отдал место. */
  takenBy: Map<number, number[]>;
}

/** Агрегаты для экрана «Сегодня»; считаются по плану и данным. */
export interface TodaySummary {
  ageColumns: string[];
  matrix: MatrixRow[];
  clusters: Cluster[];
  singles: Single[];
}

/** Что нужно агрегатам «Сегодня»: открытые заявки, их план и группы. */
export interface SummaryInput {
  requests: PlanRequest[];
  entries: PlanOutput['entries'];
  groups: PlanGroup[];
  settings: PlanSettings;
}

/**
 * Всё, что движок отдаёт серверу. `plan/index.ts` обязан экспортировать ровно это
 * (`export const engine = {...} satisfies PlanEngineApi` и отдельные именованные экспорты).
 * Сервер получает движок через внедрение зависимости, поэтому в тестах сервера подставляется
 * поддельный, а в бою — настоящий.
 */
export interface PlanEngineApi {
  DEFAULT_SETTINGS: PlanSettings;
  /** План на всю очередь сразу: вместимость, нехватка вариантов, наполненность групп. Чистая и детерминированная. */
  buildPlan(input: PlanInput): PlanOutput;
  /**
   * Куда относится заявка. `entry` нет (заявка закрыта) — решает только статус.
   * callback — флаг «перезвонить» (в этапе A всегда false).
   */
  bucketOf(args: {
    status: string;
    entry: PlanEntry | undefined;
    callback: boolean;
    settings: PlanSettings;
  }): 'ready' | 'callback' | 'human' | 'done' | 'cancelled';
  buildTodaySummary(input: SummaryInput): TodaySummary;
  /** Район из свободного текста («Приморский, м. Пионерская», «Озерки»); null — не определился. */
  resolveDistrict(place: string | null, metroIndex?: ReadonlyMap<string, string>): string | null;
  /** Станция метро (нормализованная основа) → район, выведенный из самих групп реестра. */
  buildMetroIndex(groups: readonly { metro: string | null; district: string }[]): Map<string, string>;
  /** «35-45 лет», «65+», «подростки (до 18 лет)», «любой», «» → диапазон или null. */
  parseAgeRange(text: string | null | undefined): AgeRange;
  /** День и время из колонок группы: «Четверг» + «19:00», «Среда, Четверг» + null, «Плавающий», «День»… */
  parseGroupWhen(day: string | null, time: string | null): { day: Day | null; slot: Slot | null };
  /**
   * «пн, ср — с 17 до 22 часов» → дни и время суток; неясное остаётся пустым / null. Названное неподходящим
   * («кроме воскресенья», «не утром») возвращается в `avoidDays` / `avoidSlots`.
   */
  parseHumanSchedule(text: string | null | undefined): { days: Day[]; slot: Slot | null; avoidDays: Day[]; avoidSlots: Slot[] };
  /** «Вт, вечер» / «Вт» / «вечер» / null. */
  formatWhen(day: Day | null, slot: Slot | null): string | null;
  /** Колонка возраста для матрицы «район × возраст» (по середине диапазона); null — возраст неизвестен. */
  ageColumnOf(range: AgeRange): string | null;
  /** Насколько человек подходит будущей группе (без проверки статуса и мест); null — не подходит. */
  scoreProspect(r: PlanRequest, g: PlanGroup, settings: PlanSettings): ScoredGroup | null;
}
