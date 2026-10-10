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
  /** Улица для подбора рядом. В этапе A данных нет (закрытый адрес сюда не попадает), всегда null. */
  street: string | null;
  /** Участников сейчас; null — неизвестно (тогда считаем, что места есть, и ставим пометку). */
  people: number | null;
  /** Вместимость; если в базе не задана, сервер подставляет значение по умолчанию (10). */
  capacity: number;
  status: string;
  /** «Приём новых» не «Нет». */
  acceptsNew: boolean;
  /** Отметка «Не направлять»: группа скрыта из подбора. */
  doNotRefer: boolean;
  /** Дней с последней обратной связи; null — не было. */
  verifiedDaysAgo: number | null;
}

export interface PlanRequest {
  id: number;
  fio: string;
  ageRange: AgeRange;
  /** Нормализованный район; null — не определился (заявка уходит человеку на уточнение). */
  district: string | null;
  place: string | null;
  /** Удобные дни и время суток; в этапе A из базы не берутся, всегда пусто. */
  days: Day[];
  slot: Slot | null;
  street: string | null;
  /** Для этапа B (отказ из обзвона): сейчас всегда пусто. */
  rejectedGroupIds: number[];
  avoidDays: Day[];
  avoidSlots: Slot[];
  /** Выбор человека «вместо» предложенной группы; сейчас null. */
  pinnedGroupId: number | null;
  /** Дней в ожидании; null — даты нет. */
  waitingDays: number | null;
}

export interface PlanSettings {
  /** Веса параметров подбора: район, возраст, день и время, улица. */
  weights: { district: number; age: number; time: number; street: number };
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
  code: 'place' | 'taken' | 'nogroup';
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
  /** «Вт, вечер» / «Вт» / «вечер» / null. */
  formatWhen(day: Day | null, slot: Slot | null): string | null;
  /** Колонка возраста для матрицы «район × возраст» (по середине диапазона); null — возраст неизвестен. */
  ageColumnOf(range: AgeRange): string | null;
}
