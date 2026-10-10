/**
 * Контракт JSON API сервиса «Домашние группы» (версия 1).
 *
 * Один файл, общий для сервера (`src/home-groups/`) и интерфейса (`web/home-groups/`):
 * интерфейс импортирует из него ТОЛЬКО типы (`import type`), поэтому ни кода, ни зависимостей
 * сервера в сборку не попадает. Только чистые типы: никаких импортов, никакой логики.
 *
 * Все адреса отдают JSON. Базовый адрес API — `/api/v1/`, строится от одной настройки на
 * стороне интерфейса. Чтение — GET; действия координатора — POST с телом JSON
 * (`Content-Type: application/json`, см. «Действия» ниже).
 * Ответ 401 — нет сессии (интерфейс уводит на страницу входа), 403 — нет прав.
 *
 *   GET /api/v1/me            → Me
 *   GET /api/v1/today         → TodayView
 *   GET /api/v1/requests      → RequestsView
 *   GET /api/v1/groups        → GroupsView
 *   GET /api/v1/people        → PeopleView
 *   GET /api/v1/coordinators  → CoordinatorsView
 *
 *   POST /api/v1/requests/:id/approve   ApproveBody   → ActionOk | ActionError
 *   POST /api/v1/requests/:id/reject    RejectBody    → ActionOk | ActionError
 *   POST /api/v1/requests/:id/need-call NeedCallBody  → ActionOk | ActionError
 *
 *   POST /api/v1/matching/run           (тело {})     → MatchingRunOk | ActionError
 *   POST /api/v1/matching/auto          MatchingAutoBody → ActionOk | ActionError (только super, иначе 403 forbidden)
 */

export type Role = 'admin' | 'super';

export interface Me {
  role: Role;
}

// ── общее ───────────────────────────────────────────────────────────────────

/** Окраска причины: good — зелёная, neutral — жёлтая, bad — красная, plain — серая. */
export type ReasonTone = 'good' | 'neutral' | 'bad' | 'plain';

export interface Reason {
  tone: ReasonTone;
  /** Короткая фраза по-русски: «тот же район», «время совпало: Пн, день». */
  text: string;
}

/**
 * Куда относится заявка на экране. Вычисляется из статуса заявки, плана и флага «перезвонить»:
 *  - done — статус «Исполнена»;
 *  - cancelled — «Аннулирована»;
 *  - callback — открыта, и координатор отметил «нужен звонок» (поле заявки `callback`);
 *  - ready — открыта, план есть и уверенность не ниже порога;
 *  - human — открыта, а плана нет или он слабый: нужна помощь человека.
 */
export type Bucket = 'ready' | 'callback' | 'human' | 'done' | 'cancelled';

/** Краткая карточка группы внутри предложений и списков. */
export interface GroupBrief {
  id: number;
  /** № в реестре церкви; у части групп его нет. */
  no: number | null;
  /** Код для людей: «ДГ-0012». */
  code: string;
  leader: string;
  district: string;
  metro: string | null;
  /** «Вт, вечер» — собранное из дня и времени; null, если не указано. */
  whenText: string | null;
  /** Участников сейчас; null, если число неизвестно. */
  people: number | null;
  /** Вместимость: если не задана, берётся значение по умолчанию (настройка, 10). */
  capacity: number;
  /** Свободных мест (не меньше нуля). */
  free: number;
  format: string | null;
}

/** Оценённая группа: кандидат на заявку. */
export interface Candidate {
  group: GroupBrief;
  /** Совпадение по известным параметрам, 0–100. */
  score: number;
  /** Уверенность плана, 0–100: совпадение, умноженное на долю известных параметров. Только у выбранной группы. */
  confidence: number | null;
  reasons: Reason[];
}

export interface Proposal {
  /** Кто предложил: расчёт сервиса или (позже) языковая модель. Пока человек не утвердил, это только предложение. */
  source: 'script' | 'agent';
  /** Группа, которую предлагает план. */
  main: Candidate;
  /** Сколько из четырёх параметров (район, возраст, день и время, улица) известно у человека. */
  knownParams: number;
  /** До двух запасных вариантов. */
  alternatives: Candidate[];
  /** Лучшая группа, место в которой отдано другой заявке: объясняется в карточке. */
  displaced: { group: GroupBrief; takenBy: string[] } | null;
}

/** Почему плана нет. place — район не определён; taken — места разобраны; nogroup — в районе нет групп. */
export interface NoPlan {
  code: 'place' | 'taken' | 'nogroup';
  reason: string;
}

export interface LogEntry {
  /** ISO-дата («2026-10-09») или null, если даты нет. */
  at: string | null;
  text: string;
}

// ── Сегодня ─────────────────────────────────────────────────────────────────

export interface Counters {
  ready: number;
  callback: number;
  human: number;
  done: number;
  cancelled: number;
}

export type CellLevel = 'crit' | 'warn' | 'ok' | 'zero';

export interface MatrixCell {
  /** Возрастная колонка из `ageColumns`. */
  age: string;
  /** Открытых заявок в этом районе и возрасте. */
  demand: number;
  /** Свободных мест в принимающих группах. Группа с двумя возрастами считается в обоих столбцах. */
  supply: number;
  /** Места минус спрос. */
  net: number;
  level: CellLevel;
}

export interface MatrixRow {
  district: string;
  cells: MatrixCell[];
}

/** «Не хватает группы»: два и больше человека в районе без подходящих групп. */
export interface Cluster {
  district: string;
  requestIds: number[];
  /** Имена (только имя, без фамилии) для подписи. */
  firstNames: string[];
  ages: string[];
  /** Самые частые удобные дни (до двух). */
  days: string[];
}

/** Заявка, с которой сервис не справился сам (вне кластеров). */
export interface Single {
  requestId: number;
  fio: string;
  place: string | null;
  reason: string;
}

export interface TodayView {
  /** ISO-время формирования. */
  generatedAt: string;
  counters: Counters;
  /** «Распределено X из Y»: готово + перезвонить + утверждено из всех, кроме отказов. */
  assigned: number;
  total: number;
  ageColumns: string[];
  matrix: MatrixRow[];
  clusters: Cluster[];
  singles: Single[];
}

// ── Заявки ──────────────────────────────────────────────────────────────────

export interface RequestItem {
  id: number;
  fio: string;
  phone: string | null;
  /** Возраст так, как записан в заявке: «26-35», «35-45 лет», «подростки (до 18 лет)». */
  ageLabel: string | null;
  /** Район и метро, как написал человек. */
  place: string | null;
  /** Нормализованный район из справочника; null — не распознан. */
  district: string | null;
  days: string[];
  slot: 'утро' | 'день' | 'вечер' | null;
  street: string | null;
  /** «Бот», «Таблица», «Дашборд» и, если есть, откуда именно. */
  source: string;
  /** Статус заявки в базе, без изменений. */
  status: string;
  bucket: Bucket;
  /** Координатор отметил «нужен звонок»: человеку надо позвонить, прежде чем утверждать. */
  callback: boolean;
  /** Дней с даты заявки; null, если даты нет. */
  waitingDays: number | null;
  /** Известны ли район, возраст, день и время, улица (в таком порядке). */
  dataFill: [boolean, boolean, boolean, boolean];
  proposal: Proposal | null;
  noPlan: NoPlan | null;
  /** Куда человека утвердили (для bucket = done). */
  finalGroup: GroupBrief | null;
  /** Название группы текстом, если группа в реестре не нашлась. */
  finalGroupText: string | null;
  responsible: string | null;
  note: string | null;
  log: LogEntry[];
}

/**
 * Подбор для новых заявок. Сервис хранит предложения («накопленные сопоставления»): раз
 * предложенная группа не меняется, пока остаётся доступной, а новые заявки подбираются вокруг
 * уже предложенных. Первый раз подбор запускает кнопка, потом его можно включить автоматически.
 */
export interface MatchingStatus {
  /** Включён ли автоматический подбор новых заявок (каждые пару минут). */
  auto: boolean;
  /** Последний запуск (по кнопке или автоматически); null — ещё не запускали. */
  lastRun: { at: string; created: number; replaced: number; actor: string } | null;
  /** Сколько открытых заявок сейчас без сохранённого предложения, хотя группа для них находится. */
  waiting: number;
}

export interface MatchingRunOk {
  ok: true;
  /** Новых предложений. */
  created: number;
  /** Предложений, которые пришлось заменить (группа стала недоступна). */
  replaced: number;
  /** Заявок, у которых предложение уже есть и не изменилось. */
  unchanged: number;
}

export interface MatchingAutoBody {
  enabled: boolean;
}

export interface RequestsView {
  generatedAt: string;
  matching: MatchingStatus;
  /** Без отказов; порядок — как показывать: перезвонить, готово, нужна помощь, утверждено. */
  items: RequestItem[];
  counters: Counters;
}

// ── Действия координатора ───────────────────────────────────────────────────

/** Почему координатор отклонил предложенную группу. `other` требует комментария. */
export type RejectReason = 'time' | 'far' | 'age' | 'declined' | 'other';

/** Утвердить: человек считается распределённым только после этого. */
export interface ApproveBody {
  /** Группа, в которую утверждаем: предложенная или выбранная вручную («Другая группа»). */
  groupId: number;
  /** Утвердить, даже если в группе нет свободных мест (интерфейс спрашивает подтверждение). */
  force?: boolean;
}

export interface RejectBody {
  groupId: number;
  reason: RejectReason;
  comment?: string;
}

export interface NeedCallBody {
  /** true — поставить отметку «нужен звонок», false — снять. */
  value: boolean;
}

export interface ActionOk {
  ok: true;
}

/**
 * Ошибка действия. Коды: 400 `bad_request`; 404 `not_found`;
 * 403 `forbidden` (нужен вход super_mbv_admin); 409 `already_closed` (заявку уже закрыли), `group_unavailable` (группа в архиве, закрыта или
 * «Не направлять»), `group_full` (мест нет; повторить с `force: true`).
 */
export interface ActionError {
  error: 'bad_request' | 'not_found' | 'already_closed' | 'group_unavailable' | 'group_full' | 'forbidden';
  message: string;
}

// ── Справочник ──────────────────────────────────────────────────────────────

export interface HealthItem {
  ok: boolean;
  label: string;
  points: number;
}

export interface GroupItem extends GroupBrief {
  coLeader: string | null;
  phone: string | null;
  ageText: string | null;
  /** День недели («Пн»…«Вс») или null. */
  day: string | null;
  slot: 'утро' | 'день' | 'вечер' | null;
  status: string;
  /** «Приём новых» не «Нет». */
  acceptsNew: boolean;
  doNotRefer: boolean;
  composition: string | null;
  coordinator: string | null;
  /** Дней с последней обратной связи; null — не было. */
  verifiedDaysAgo: number | null;
  comment: string | null;
  health: { score: number; items: HealthItem[] };
  /**
   * Сколько человек утвердил сервис после последней обратной связи ведущего. Они уже добавлены к
   * `people`: ведущий обновит число сам, и счётчик обнулится (считаем только утверждённых позже).
   */
  placedNew: number;
  /** Кого план направляет в эту группу сейчас. */
  plannedRequests: { id: number; fio: string; ageLabel: string | null; place: string | null; confidence: number }[];
}

export interface GroupsView {
  generatedAt: string;
  items: GroupItem[];
}

export interface PersonItem {
  /** Устойчивый ключ строки: «u12» (участник) или «r345» (заявка без участника). */
  key: string;
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  district: string | null;
  /** Откуда: «Бот · Telegram», «Таблица», «Форма регистрации». */
  from: string;
  /** Что ответил про малую группу: «Хочет в группу», «Откроет свою группу», «Уже в группе»… */
  mdgLabel: string;
  /** ISO-дата регистрации или заявки. */
  date: string | null;
  requestId: number | null;
}

export interface PeopleView {
  generatedAt: string;
  items: PersonItem[];
}

export interface CoordinatorItem {
  id: number;
  name: string;
  role: string;
  groups: number;
  people: number;
  /** Групп с обратной связью за последние 30 дней. */
  verified30: number;
}

export interface CoordinatorsView {
  generatedAt: string;
  items: CoordinatorItem[];
}
