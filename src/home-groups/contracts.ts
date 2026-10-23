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
 *   POST /api/v1/people/create         CreateRecordBody  → CreateRegistrationOk | ActionError (регистрация участника)
 *   GET  /api/v1/people/:id/card       → HTML-страница печатной карточки с QR (открывается в новой вкладке)
 *   GET  /api/v1/people/:id/qr         → PNG с QR регистрации
 *   POST /api/v1/requests/:id/edit     RequestEditBody → ActionOk | ActionError (ФИО, телефон, возраст, район, адрес, время, комментарий)
 *   POST /api/v1/requests/:id/assign    AssignBody      → ActionOk | ActionError («в работе у»)
 *   POST /api/v1/requests/:id/call      CallBody        → ActionOk | ActionError (итог звонка)
 *   GET  /api/v1/team                   → TeamView (нагрузка, сроки ожидания, действия за неделю)
 *   POST /api/v1/requests/bulk          BulkBody → BulkOk | ActionError (передать или отметить «нужен звонок» сразу нескольким)
 *   POST /api/v1/requests/:id/strange   StrangeBody → ActionOk | ActionError (метка «Странный человек» на человеке заявки; любой вход)
 *   POST /api/v1/people/strange         PersonStrangeBody → ActionOk | ActionError (то же по ключу человека: u12, r345, p7)
 *   POST /api/v1/requests/:id/reconcile ReconcileBody → ReconcileOk | ActionError (разобрать «другое обращение»: в состав групп или ведущим групп)
 *   POST /api/v1/requests/reconcile-ready ReconcileReadyBody → ReconcileReadyOk | ActionError (разобрать сразу все с одной точно найденной группой)
 *   POST /api/v1/people/(u|r)<id>/update {fields} → ActionOk | ActionError (контакты регистрации или человека из заявки; доходят и до заявок)
 *   POST /api/v1/groups/:id/update      UpdateBody → ActionOk | ActionError (правка части полей группы; адрес и телефоны только записываются, обратно не отдаются)
 *   POST /api/v1/groups/:id/delete      (тело {})  → ActionOk | ActionError (только super; скрывает, а не стирает)
 *   POST /api/v1/coordinators/create    CreateRecordBody → CreateRecordOk | ActionError
 *   POST /api/v1/coordinators/:id/update UpdateBody → ActionOk | ActionError
 *   POST /api/v1/coordinators/:id/delete (тело {}) → ActionOk | ActionError (только super)
 *   POST /api/v1/requests/:id/delete    (тело {})  → ActionOk | ActionError (только super)
 *   GET  /api/v1/export/requests.csv    → CSV (только super; в нём телефоны)
 *   GET  /api/v1/export/people.csv      → CSV (только super)
 *   POST /api/v1/groups/:id/members/create MemberAddBody → MemberAddOk | ActionError (добавить человека из справочника или внести нового «по плюсу»)
 *   POST /api/v1/members/:id/update     UpdateBody → ActionOk | ActionError (только joinedOn и note; имя и телефон правятся в карточке человека)
 *   POST /api/v1/members/:id/delete     (тело {})  → ActionOk | ActionError (убрать из состава: запись скрывается)
 *   POST /api/v1/persons/:id/update     UpdateBody → ActionOk | ActionError (правка карточки, внесённой вручную: ключ p<id>)
 *   POST /api/v1/persons/:id/delete     (тело {})  → ActionOk | ActionError (только super; карточка скрывается)
 *   POST /api/v1/assistant/chat         ChatBody → ChatOk | ActionError (кнопка «✦ Помощник»: вопросы по базе, только чтение; имена модель не видит)
 *   GET  /api/v1/assistant/chat/history  → ChatHistoryView (последние сообщения этого входа)
 *   POST /api/v1/assistant/chat/clear   {} → { ok: true } (стереть историю этого входа)
 *   POST /api/v1/assistant/run          (тело {})       → AssistantRunOk | ActionError (помощник разбирает непонятные заявки)
 *   GET  /api/v1/settings/assistant     → SettingsAssistantView (только super)
 *   POST /api/v1/settings/assistant/enabled AssistantEnabledBody → ActionOk | ActionError (только super)
 *   POST /api/v1/settings/assistant/llm LlmConfigBody → ActionOk | ActionError (только super; ключ шифруется, обратно не отдаётся)
 *   POST /api/v1/settings/assistant/llm-test LlmTestBody → LlmTestResult (только super; ничего не сохраняет)
 *   GET  /api/v1/settings/geocoder      → GeocoderConfigView (только super; ключа в ответе нет)
 *   POST /api/v1/settings/geocoder      GeocoderConfigBody → ActionOk | ActionError (только super; ключ шифруется)
 *   POST /api/v1/settings/geocoder-test GeocoderConfigBody → GeocoderTestResult (только super; ничего не сохраняет)
 *   GET  /api/v1/settings/geocoder/addresses → AddressTableView (только super: все адреса, их состояние и откуда они взяты)
 *   POST /api/v1/settings/geocoder-retry AddressRetryBody → ActionOk | ActionError (только super: один запрос к Яндексу по одному адресу)
 *   POST /api/v1/settings/geocoder-reject AddressRejectBody → ActionOk | ActionError (только super: «это не адрес» — снимает найденные координаты)
 *   GET  /api/v1/settings/map            → MapConfigView (только super; ключа в ответе нет)
 *   POST /api/v1/settings/map            GeocoderConfigBody → ActionOk | ActionError (только super; ключ карты шифруется)
 *   GET  /api/v1/map/config              → MapBootstrap (любой вход: нужен, чтобы открыть карту)
 *   POST /api/v1/map/loaded              (тело {}) → MapBootstrap (любой вход: считает открытие карты в месяце)
 *   GET  /api/v1/settings/bot           → SettingsBotView (только super)
 *   POST /api/v1/settings/bot/extra-questions ExtraQuestionsBody → ActionOk | ActionError (только super)
 *   POST /api/v1/settings/bot/send-extra-questions SendExtraInvitesBody → SendExtraInvitesOk | ActionError (только super; пишет живым людям)
 *   POST /api/v1/requests/:id/close     CloseBody       → ActionOk | ActionError (обработано или аннулировать с причиной)
 *   POST /api/v1/requests/:id/reopen    (тело {})       → ActionOk | ActionError (вернуть закрытую заявку в работу)
 *   POST /api/v1/people/:id/delete      (тело {})       → ActionOk | ActionError (только super; стирает регистрацию с заявками)
 *   GET  /api/v1/campaign               → CampaignView  (кампания «40 дней», только чтение)
 *   POST /api/v1/requests/:id/rematch  (тело {})         → ActionOk | ActionError (подобрать заново одну заявку)
 *   POST /api/v1/matching/rerun-all    (тело {})         → MatchingRunOk | ActionError (пересчитать все закреплённые предложения)
 *   GET /api/v1/form-meta         → FormMeta            (справочники для форм «Создать»)
 *   POST /api/v1/requests/:id/params   RequestParamsBody → ActionOk | ActionError (улица и удобное время вручную)
 *   POST /api/v1/requests/create       CreateRecordBody  → CreateRecordOk | ActionError
 *   POST /api/v1/groups/create         CreateRecordBody  → CreateRecordOk | ActionError
 *
 *   GET /api/v1/settings/health   → SettingsHealthView   (раздел «Настройки»: только super, иначе 403)
 *   GET /api/v1/settings/errors   → SettingsErrorsView
 *   GET /api/v1/settings/audit    → SettingsAuditView
 *   GET /api/v1/settings/prompts  → SettingsPromptsView
 *   GET /api/v1/settings/staff    → SettingsStaffView   (личные входы: только super)
 *   POST /api/v1/settings/staff/suggest      SuggestLoginBody   → SuggestLoginOk | ActionError
 *   POST /api/v1/settings/staff/create       CreateStaffBody    → DeliveryOk | ActionError
 *   POST /api/v1/settings/staff/update       UpdateStaffBody    → ActionOk | ActionError
 *   POST /api/v1/settings/staff/invite       StaffIdBody        → DeliveryOk | ActionError (повторное приглашение)
 *   POST /api/v1/settings/staff/reset        StaffIdBody        → DeliveryOk | ActionError (сброс пароля)
 *   POST /api/v1/settings/staff/personal-mode PersonalModeBody  → ActionOk | ActionError
 *   POST /api/v1/settings/staff/generate-password GeneratePasswordBody → GeneratePasswordOk | ActionError
 *   POST /api/v1/settings/prompts/save      SavePromptBody     → ActionOk | ActionError
 *   POST /api/v1/settings/prompts/activate  ActivatePromptBody → ActionOk | ActionError
 *
 *   POST /api/v1/matching/run           (тело {})     → MatchingRunOk | ActionError
 *   POST /api/v1/matching/auto          MatchingAutoBody → ActionOk | ActionError (только super, иначе 403 forbidden)
 */

export type Role = 'admin' | 'super';

export interface Me {
  role: Role;
  /**
   * Кто вошёл — только при личном входе. `name` — как человек записан в справочнике команды (так же он стоит в
   * «В работе у» у заявок и в «Координаторе» у групп), а если учётная запись не связана со справочником — ФИО из
   * «Пользователей». По нему интерфейс сразу показывает свои заявки и предлагает отбор «Мои группы».
   */
  person?: {
    login: string;
    name: string;
    /**
     * Роль в справочнике команды, как записана («Распределитель», «Координатор», «Старший координатор»); null —
     * учётная запись не связана со справочником. От неё зависит, что человек видит по умолчанию: распределитель —
     * свои и ничьи заявки, координатор — свои группы и свои обращения «хочу открыть группу», старший — всё.
     */
    teamRole: string | null;
    /**
     * Что роли значат для сервиса — из справочника ролей, а не угадыванием по названию. Ролей у человека бывает
     * несколько (координатор и распределитель сразу), поэтому список; пустой — особых настроек нет.
     */
    teamKinds: TeamRoleKind[];
  };
  /** Состояние помощника для кнопки «✦ Помощник»: показывается, когда ключ задан, помощник включён и база готова. */
  assistant?: { available: boolean; enabled: boolean; chat: boolean };
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
  /** Направление группы (справочник «Настройки → Направления»). */
  direction: string;
  /** Новая группа (зелёный росток): «Функционирует», открыта меньше четырёх месяцев назад, сколько бы в ней ни было людей. Остальным статусам не ставится. */
  isNew: boolean;
  /**
   * Оранжевый росток: «Функционирует» без людей совсем (и у старых групп тоже) или с датой открытия, если четыре месяца прошли, а
   * трёх человек не набралось. У новой (до четырёх месяцев) группы и у других статусов — всегда false.
   */
  empty: boolean;
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

/** Что изменилось в данных заявки с тех пор, как предложили группу. */
export interface DataChange {
  /** «Район», «Возраст», «Дни», «Время суток», «Улица». */
  field: string;
  before: string | null;
  after: string | null;
}

export interface Proposal {
  /**
   * Что именно изменилось (по снимку данных на момент предложения). null — снимка нет (предложение сохранено до того,
   * как их стали хранить): известно лишь, что данные изменились. Пустой список бывает, если после изменения всё вернулось.
   */
  changes: DataChange[] | null;
  /** Данные заявки изменились после закрепления (район, возраст, время, улица): закреплённая группа ещё не пересчитана, нужно «подобрать заново». */
  dataChanged: boolean;
  /** Предложение закреплено: сохранено в «предварительно» и не изменится само, пока группа доступна. Иначе это свежий расчёт, он может поменяться при следующем показе. */
  saved: boolean;
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
/**
 * Метка «Странный человек»: ставит координатор или распределитель после обзвона, когда у человека оказываются особенности и
 * для него нужна отдельная группа. Видна везде, где виден человек; такие заявки не попадают в автоматический подбор.
 */
export interface StrangeMark {
  /** Кто поставил (логин). */
  by: string;
  /** Когда (ISO). */
  at: string;
  /** Что заметили, для коллег; может быть пусто. */
  note: string | null;
}

/** Поставить или снять метку. `note` только при установке. */
export interface StrangeBody {
  value: boolean;
  note?: string | null;
}

export interface PersonStrangeBody extends StrangeBody {
  /** Ключ человека в справочнике: «u12», «r345», «p7». */
  key: string;
}

export interface NoPlan {
  code: 'place' | 'taken' | 'nogroup' | 'strange';
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
  /** Какие открытые заявки дают спрос в этой ячейке (для списка по клику). */
  requestIds: number[];
  /** Какие группы дают места в этой ячейке: принимающие и со свободными местами. */
  groupIds: number[];
}

/**
 * Строка матрицы. Особая строка с `district` = «Район не определён» собирает заявки, у которых район не
 * определился (их не должно быть видно меньше остальных); особая колонка `age` = «Возраст не указан» —
 * заявки без возраста. В таких ячейках есть только спрос.
 */
export interface MatrixRow {
  district: string;
  /** Свободных мест в районе без двойного счёта: группа с двумя возрастами считается один раз (сумма по ячейкам её посчитала бы дважды). */
  supplyTotal: number;
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
  /** Сколько заявок утвердили сегодня (по журналу, часовой пояс сервиса). */
  approvedToday: number;
  /** «Распределено X из Y»: готово + перезвонить + утверждено из всех, кроме отказов. */
  assigned: number;
  total: number;
  /** Все обращения: заявки в подбор и «другие обращения» (в любом состоянии), как «Всего заявок» в старом дашборде. */
  requestsAll: number;
  /** Из них исполненные: утверждённые в группу и обработанные «другие обращения». */
  requestsDone: number;
  ageColumns: string[];
  matrix: MatrixRow[];
  clusters: Cluster[];
  singles: Single[];
}

// ── Заявки ──────────────────────────────────────────────────────────────────

/**
 * Поля заявки из таблицы церкви — как записаны, для формы правки. Показ заявки склеивает «Примечание» и «Дополнительно»
 * в одну заметку (`note`); править их надо по отдельности, иначе сохранение заметки дописало бы в неё «Дополнительно».
 */
export interface RequestTableFields {
  note: string | null;
  source: string | null;
  ministry: string | null;
  extra: string | null;
  /** Рекомендованная группа — имя ведущего, как в таблице. */
  recommended: string | null;
  /** «2026-08-27» или null. */
  recommendedAt: string | null;
  finalGroup: string | null;
  attendance: string | null;
}

export interface RequestItem {
  /** Метка «Странный человек» (на человеке заявки); null — нет. */
  strange: StrangeMark | null;
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
  /** Разбор помощника; null — помощник заявку не трогал. */
  assistant: AssistantNote | null;
  /** Что человек написал про удобное время: откуда текст (анкета бота или правка координатора) и как система его поняла (поля `days`, `slot`). */
  scheduleInfo: ParamInfo;
  /** То же про улицу и дом (поле `street`). */
  streetInfo: ParamInfo;
  /** Координаты адреса: найдены, адрес не нашёлся на карте или ещё не геокодирован / геокодер выключен (null). */
  streetGeo: GeoState;
  /** Хобби, профессия, семейное положение — свободным текстом, как их написал человек или внёс координатор. */
  hobby: string | null;
  profession: string | null;
  family: string | null;
  /** Заявка как она пришла: что человек заполнил сам, в порядке показа. */
  original: OriginalField[];
  /** Куда человека утвердили (для bucket = done). */
  finalGroup: GroupBrief | null;
  /** Группа, заведённая по этой заявке («Создать группу по заявке»); null — нет. */
  ownGroup: { id: number; code: string } | null;
  /** Название группы текстом, если группа в реестре не нашлась. */
  finalGroupText: string | null;
  /**
   * Контакты скрыты от вошедшего (личный вход, а запись не его): телефон замаскирован — видны последние цифры, улицы,
   * хобби и профессии нет. Откроются, когда заявку возьмут себе («В работе у»). Скрывает сервер, интерфейс поясняет.
   */
  contactsHidden: boolean;
  responsible: string | null;
  note: string | null;
  table: RequestTableFields;
  log: LogEntry[];
}

/**
 * Подбор для новых заявок. Сервис хранит предложения («накопленные сопоставления»): раз
 * предложенная группа не меняется, пока остаётся доступной, а новые заявки подбираются вокруг
 * уже предложенных. Первый раз подбор запускает кнопка, потом его можно включить автоматически.
 */
/**
 * Помощник (языковая модель) разбирает то, что скрипт не понял: «район» и «возраст» в свободной записи и удобное время.
 * Группу он НЕ выбирает: после его разбора группу подбирает тот же расчёт, что и для остальных. Наружу уходят только
 * возрастная категория, место и удобное время в записи человека (без имён, телефонов и адресов, номера и почты вырезаются).
 */
export interface AssistantStatus {
  /** Ключ помощника задан на сервере. */
  available: boolean;
  /** Помощник включён в «Настройках» (по умолчанию выключен). */
  enabled: boolean;
  /** Сколько открытых заявок помощник может разобрать сейчас. */
  pending: number;
  /**
   * Заявки для окна «ИИ-разбор»: и те, что помощник ещё не смотрел, и те, где он не всё понял и ждёт служителя.
   * Сначала разобранные (по ним нужен ответ служителя), потом новые.
   */
  review: AssistantReviewItem[];
}

/** Параметр подбора, который может определить помощник. */
export type AssistantField = 'район' | 'возраст' | 'время';

/** Что помощник сделал с заявкой: какие поля он определил и что советует уточнить у человека. */
export interface AssistantNote {
  /** Какие параметры подбора определил помощник, а не скрипт: «район», «возраст», «время». Их стоит проверить. */
  filled: AssistantField[];
  /** Готовые вопросы для разговора с человеком (до трёх). */
  questions: string[];
  /** Пояснение помощника: почему что-то осталось неопределённым (или на что он опирался). */
  note: string | null;
}

/** Заявка в окне «ИИ-разбор». */
export interface AssistantReviewItem {
  requestId: number;
  fio: string;
  /** new — помощник её ещё не смотрел; reviewed — смотрел, но чего-то не понял, и нужен ответ служителя. */
  state: 'new' | 'reviewed';
  /** Что не понял ни скрипт, ни помощник: это стоит уточнить у человека и вписать в заявку. */
  missing: AssistantField[];
  filled: AssistantField[];
  questions: string[];
  note: string | null;
  /** Как человек написал место, возраст и удобное время (или как их поправил координатор). */
  place: string | null;
  age: string | null;
  schedule: string | null;
}

/** Один ход разговора с помощником. Разговор хранит сервер (по логину); модели уходят последние 6 сообщений. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  /** До 2000 знаков. */
  content: string;
}

/** Обычно присылается только новый вопрос: историю сервер знает сам. `messages` — прежний вид, ничего не сохраняет. */
export type ChatBody =
  | { message: string }
  | {
      /** От 1 до 12 ходов; последний — вопрос человека. */
      messages: ChatTurn[];
    };

/** Что показать при открытии чата: последние сообщения этого входа, старые первыми (с настоящими именами). */
export interface ChatHistoryView {
  messages: ChatTurn[];
}

/** Запрос, который помощник выполнил в базе (его можно показать — «как посмотрел»). */
export interface ChatQuery {
  sql: string;
  ok: boolean;
  /** Сколько строк вернулось. */
  rows: number;
  /** Что не получилось (если ok = false). */
  error?: string;
}

/** Точная выдержка из базы под ответом: чтобы цифры можно было перепроверить, а не верить пересказу модели. Здесь настоящие имена. */
export interface ChatTable {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  /** Строк в базе больше, чем показано (до 100). */
  truncated: boolean;
}

export interface ChatOk {
  ok: true;
  /** Ответ помощника простым русским текстом (с настоящими именами). */
  answer: string;
  queries: ChatQuery[];
  /** Таблицы из успешных запросов (не больше двух, последние). */
  tables: ChatTable[];
}

export interface AssistantRunOk {
  ok: true;
  /** Сколько заявок отправлено на разбор. */
  asked: number;
  /** По скольким определено хотя бы одно поле. */
  filled: number;
  /** По скольким есть вопросы для человека. */
  withQuestions: number;
  /** Сколько новых предложений групп появилось после разбора. */
  proposals: number;
  /** По скольким заявкам модель не ответила (или ответ не прочитался): они остаются в очереди на разбор. */
  unanswered: number;
}

export interface AssistantEnabledBody { enabled: boolean }

/** Провайдер языковой модели, которого можно выбрать. */
export interface LlmProviderOption {
  id: 'deepseek' | 'openai' | 'openrouter' | 'custom';
  label: string;
  /** Адрес готового провайдера; null у «другого» — его вводит человек. */
  baseUrl: string | null;
  /** Подсказки названий моделей; название можно вписать своё. */
  models: string[];
  defaultModel: string | null;
  /** Что важно знать, выбирая этого провайдера. */
  note: string;
}

/** Подключение помощника: провайдер, модель и ключ. Самого ключа в ответе нет никогда. */
export interface LlmConfigView {
  provider: LlmProviderOption['id'];
  /** Адрес «другого» провайдера; у остальных null. */
  baseUrl: string | null;
  model: string;
  /** Ключ есть (сохранён в настройках или задан в `.env` сервера). */
  keySet: boolean;
  keySource: 'settings' | 'env' | null;
  /** Последние четыре символа ключа, чтобы видеть, какой именно задан. */
  keyHint: string | null;
  /** Сохранённый в настройках ключ не читается (сменился секрет сервера): введите его заново. */
  keyUnreadable: boolean;
  providers: LlmProviderOption[];
}

/** Сохранить подключение. `apiKey`: не указан — прежний остаётся, строка — новый ключ, null — убрать сохранённый (вернётся `.env`). */
export interface LlmConfigBody {
  provider: LlmProviderOption['id'];
  model: string;
  /** Для «другого» провайдера: адрес https. */
  baseUrl?: string | null;
  apiKey?: string | null;
}

/** Проверка подключения тем же телом: ничего не сохраняет. */
export type LlmTestBody = LlmConfigBody;

export type LlmTestResult =
  | { ok: true; provider: string; model: string; ms: number }
  | {
      ok: false;
      code: 'bad_request' | 'nokey' | 'auth' | 'rate' | 'server' | 'network' | 'format';
      /** Что произошло и что делать, словами. */
      message: string;
      /** Код ответа провайдера, если он был. */
      status?: number;
      /** Короткое пояснение провайдера (ключи в нём закрыты). */
      detail?: string;
    };

/** Ключ Яндекс.Геокодера (раздел «Геокодер»). Самого ключа в ответе нет никогда. */
export interface GeocoderConfigView {
  keySet: boolean;
  keySource: 'settings' | 'env' | null;
  keyHint: string | null;
  keyUnreadable: boolean;
  /** Запросов к геокодеру за последние сутки и суточный предел сервиса (ключ у Яндекса — тысяча в сутки). */
  usedToday: number;
  dailyLimit: number;
  /** Адреса, которые нужны подбору (групп и открытых заявок): сколько всего, с координатами, не нашлись и ещё ждут запроса. */
  addresses: { total: number; found: number; missing: number; waiting: number };
}

/** `apiKey`: строка — новый ключ, null — убрать сохранённый (вернётся `.env`). В проверке не указан — берётся действующий. */
export interface GeocoderConfigBody { apiKey?: string | null }

export type GeocoderTestResult = { ok: true; ms: number } | { ok: false; message: string };

/** Откуда взят адрес в таблице адресов: по нему открывается карточка. */
export interface AddressSourceView { kind: 'group' | 'request' | 'person'; id: string; label: string }

/** Строка таблицы адресов: что с адресом в геокодере и где он встречается. */
export interface AddressRowView {
  /** Адрес как записан (по нему же идёт повтор). */
  address: string;
  state: 'found' | 'missing' | 'waiting';
  /** Насколько точна точка: дом, середина улицы (дома нет) или центр посёлка/района (улицы нет); null — не найден. */
  accuracy: 'house' | 'street' | 'area' | null;
  lat: number | null;
  lon: number | null;
  /** Полный адрес, который вернул Яндекс; null — не найден или найден до того, как мы стали это хранить. */
  matched: string | null;
  /** Карточки, где этот адрес записан (один и тот же адрес может быть у нескольких). */
  sources: AddressSourceView[];
}

export interface AddressTableView { generatedAt: string; items: AddressRowView[] }

/** Повторить определение координат одного адреса. */
export interface AddressRetryBody { address: string }

/** Отметить, что это не адрес («среда с 18:00»): координаты снимаются, повторно не спрашиваем. Тело то же, что у повтора. */
export type AddressRejectBody = AddressRetryBody

/** Ключ Яндекс.Карт (JS API) для карты групп. Самого ключа в ответе настроек нет никогда. */
export interface MapConfigView {
  keySet: boolean;
  keyHint: string | null;
  keyUnreadable: boolean;
  /** Сколько раз карта открывалась в этом месяце и сколько бесплатно даёт ключ. */
  loadsThisMonth: number;
  monthlyLimit: number;
}

/** Что нужно странице, чтобы показать карту: ключ (он и так уходит в браузер, ограничьте его по адресу сайта в кабинете Яндекса) и расход. */
export interface MapBootstrap { apiKey: string | null; loadsThisMonth: number; monthlyLimit: number }

export interface SettingsAssistantView {
  generatedAt: string;
  available: boolean;
  enabled: boolean;
  /** Название модели, например `deepseek-chat`. */
  model: string | null;
  /** Подключение: провайдер, модель и ключ (только для полного входа). */
  llm: LlmConfigView;
  lastRun: { at: string; actor: string; asked: number; filled: number; withQuestions: number; proposals: number } | null;
}

export interface MatchingStatus {
  /** Включён ли автоматический подбор новых заявок (каждые пару минут). */
  auto: boolean;
  /** Последний запуск (по кнопке или автоматически); null — ещё не запускали. */
  lastRun: { at: string; created: number; replaced: number; actor: string } | null;
  /** Сколько открытых заявок сейчас без закреплённого предложения, хотя группа для них находится. */
  waiting: number;
  /** Сколько открытых заявок уже имеют закреплённое предложение. */
  saved: number;
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

/** Откуда взято значение параметра подбора. anketa — ответ человека (бот), manual — правка координатора. */
/** Что известно про координаты адреса (кэш геокодера). */
export type GeoState = 'found' | 'missing' | null;

export interface ParamInfo {
  text: string | null;
  source: 'anketa' | 'manual' | null;
}

export interface OriginalField {
  label: string;
  value: string;
}

export interface RequestParamsBody {
  /** Улица и дом; пустая строка или null — убрать правку координатора (вернётся ответ из анкеты, если был). undefined — не менять. */
  street?: string | null;
  /** Удобные дни и время свободным текстом («пн, ср вечером»); правила те же. */
  schedule?: string | null;
}

/** Правка полей заявки. Присланное меняется, `null` или пустая строка очищают поле (кроме ФИО), `undefined` — не менять. */
export interface RequestEditBody {
  fio?: string;
  /** Номер телефона; сервер приводит к виду +7XXXXXXXXXX и отклоняет то, что не похоже на номер. */
  phone?: string | null;
  /** Возраст как в анкете: «26-35», «36-45 лет». */
  age?: string | null;
  /** Район и метро свободным текстом, как их пишет человек; район для подбора определяется по нему. */
  place?: string | null;
  note?: string | null;
  /** Улица и дом (правка координатора, главнее анкеты); по ним идёт подбор. */
  address?: string | null;
  /** Удобное время свободным текстом: «среда вечером». */
  schedule?: string | null;
}

export interface AssignBody {
  /** Имя координатора («в работе у»); null или пустая строка — снять. */
  responsible: string | null;
}

export type CallResult = 'reached' | 'no_answer' | 'later' | 'refused';

export interface CallBody {
  /** Дозвонился · не дозвонился · просил перезвонить позже · отказался. «Не дозвонился» и «позже» оставляют заявку в «Перезвонить», «дозвонился» и «отказался» снимают отметку. */
  result: CallResult;
  comment?: string | null;
}

/** Правка записи справочника: присланные поля меняются, остальные (в том числе закрытые) остаются как были. */
export interface UpdateBody {
  fields: Record<string, string>;
}

export interface BulkBody {
  /** Номера заявок, не больше 100. */
  ids: number[];
  action: 'assign' | 'need-call';
  /** Для assign: имя координатора, null или пусто — снять. */
  responsible?: string | null;
  /** Для need-call: поставить (true) или снять (false) отметку. */
  value?: boolean;
}

export interface BulkOk {
  ok: true;
  /** Сколько заявок обработано (в том числе уже стоявших в нужном состоянии). */
  done: number;
  /** Сколько пропущено: закрыты или не найдены. */
  skipped: number;
}

export interface TeamWorkload {
  /** Имя координатора из «в работе у»; null — заявки, которые никто не взял. */
  name: string | null;
  open: number;
  /** Из них ждут звонка. */
  callback: number;
  /** Из них ждут больше недели. */
  over7: number;
  /** Сколько дней ждёт самая старая; null — дат нет. */
  oldestDays: number | null;
}

export interface TeamActivity {
  /** Логин, под которым выполнено действие. Пока вход общий, все действия под одним именем. */
  actor: string;
  calls: number;
  approved: number;
  rejected: number;
  edits: number;
  assigned: number;
}

export interface TeamView {
  generatedAt: string;
  totals: {
    open: number;
    unassigned: number;
    callback: number;
    over7: number;
    /** Утверждено за последние 7 дней. */
    approvedWeek: number;
    /** Открытые обращения, которые не идут в подбор (готов открыть, вопросы). */
    otherOpen: number;
  };
  /** Сколько открытых заявок ждут: 0–2 дня, 3–7, 8–14, 15 и больше, дата неизвестна. */
  aging: { label: string; count: number }[];
  workload: TeamWorkload[];
  /** Самые старые открытые заявки (ждут больше недели), не больше 20. */
  stuck: { id: number; fio: string; waitingDays: number; responsible: string | null; bucket: Bucket }[];
  /** Действия за последние 7 дней по логинам. */
  activity: TeamActivity[];
}

/** Статистика кампании «40 дней» (только чтение). Форма совпадает с `CampaignStats` из `src/dashboard/campaignStats.ts`. */
export interface CampaignView {
  participants: { registered: number; complete: number; incomplete: number; kitsIssued: number; blocked: number; unfinished: number };
  mdg: { open: number; home: number; join: number; member: number; leader: number };
  byPlatform: { platform: 'telegram' | 'max'; registered: number; complete: number; incomplete: number; kitsIssued: number; blocked: number; unfinished: number }[];
  newRequests: number;
  days: { loaded: number; total: number; ranges: string; list: { day: number; loaded: boolean; length: number }[] };
  day: { state: 'до старта' | 'идёт' | 'завершена'; number: number; total: number; startDate: string };
  broadcasts: { key: string; createdAt: string; finished: boolean; sent: number; pending: number; failed: number; blocked: number }[];
}

/** Настройка бота «новые вопросы анкеты» (удобное время и адрес): кому их задавать. */
export interface SettingsBotView {
  generatedAt: string;
  extraQuestions: {
    /** off — никому; all — всем; list — только людям из списка `ids`. */
    mode: 'off' | 'all' | 'list';
    /** Список через запятую: «111111111» или «max:111111111». Для остальных режимов пустая строка. */
    ids: string;
    /** Откуда действует значение: из этой настройки или из файла `.env` сервера (пока настройку не меняли). */
    source: 'settings' | 'env';
    /** Значение из `.env`: показывается как «было по умолчанию». */
    envValue: string;
  };
  /** Досылка двух новых вопросов тем, кто уже зарегистрирован (кнопка в «Настройках»). */
  invites: ExtraInvitesView;
}

export interface ExtraInvitesView {
  /** В сервисе подключён хотя бы один бот: без этого слать нечем. */
  available: boolean;
  /** Хотят в группу. */
  join: number;
  /** Готовы открыть группу или дать дом. */
  lead: number;
  /** Уже ведут группу (ответили боту «веду»): им отдельная досылка про время и место группы. */
  leaders: number;
  /** Сколько получат приглашение ищущие группу и будущие ведущие (join + lead) при текущей настройке «кому задавать». */
  total: number;
  /** Новые вопросы выключены: слать некому. */
  off: boolean;
  /** Тексты приглашений, как их увидят люди. */
  textJoin: string;
  textLead: string;
  textLeader: string;
}

export interface SendExtraInvitesBody {
  /** Число получателей, которое человек видел и подтвердил: если оно успело измениться, рассылка не уходит. */
  expectedTotal: number;
  /** Кому: seekers — ищущим группу и будущим ведущим (по умолчанию), leaders — тем, кто уже ведёт группу. */
  audience?: 'seekers' | 'leaders';
}

export interface SendExtraInvitesOk {
  ok: true;
  sent: number;
  failed: number;
  /** Заблокировали бота. */
  blocked: number;
}

export interface ExtraQuestionsBody {
  mode: 'off' | 'all' | 'list';
  /** Для `list`: id через запятую, обязательно хотя бы один. */
  ids?: string;
}

export type CancelReason = 'declined' | 'no_answer' | 'duplicate' | 'self_found' | 'other';

export interface CloseBody {
  /** done — обработано (разобрались без группы); cancel — аннулировать с причиной. */
  outcome: 'done' | 'cancel';
  /** Нужна при cancel; для `other` обязателен комментарий. */
  reason?: CancelReason;
  comment?: string | null;
}

/**
 * Обращение, которое не идёт в подбор группы: «готов открыть группу», «дам дом», вопрос служителю, «уже состою
 * в группе» — и закрытые заявки «хочу в группу» (аннулированные), чтобы их можно было вернуть в работу.
 * Работают с ним теми же действиями, что и с заявкой, кроме подбора и утверждения.
 */
/** Группа, найденная по ведущему, для разбора «другого обращения». */
export interface ReconcileCandidate {
  groupId: number;
  /** «ДГ-0012». */
  code: string;
  leader: string;
  district: string;
  /** exact — имя (или телефон) совпало полностью; likely — похоже (фамилия и инициал), выбирает человек. */
  tier: 'exact' | 'likely';
  by: 'name' | 'phone';
}

/**
 * Что делать с обращением по справочникам. member — «уже состою в группе» (внести в состав), leader — «уже веду
 * группу» (связать группу с ведущим). status: ready — найдена одна группа, достаточно подтвердить; choose — выбрать
 * из найденных или указать другую; none — ведущего нет в справочнике групп; noleader — ведущий не указан; nouser —
 * у обращения нет регистрации человека (заведено вручную), справочник пополняется только руками.
 */
export interface OtherReconcile {
  kind: 'member' | 'leader';
  status: 'ready' | 'choose' | 'none' | 'noleader' | 'nouser';
  /** Что нашли и что делать, словами. */
  text: string;
  candidates: ReconcileCandidate[];
  /** Ведущий, которого назвал человек (у «уже в группе»); null — не называл или это обращение ведущего. */
  leaderName?: string | null;
}

export interface OtherItem {
  /** Метка «Странный человек»; null — нет. */
  strange: StrangeMark | null;
  id: number;
  type: 'join_group' | 'lead_group' | 'question' | 'already_member' | 'already_leader';
  /** «Хочет открыть группу», «Вопрос служителю» и т. д. */
  typeLabel: string;
  /** Суть обращения одной фразой: что человек сообщил (в боте или в форме), чтобы не искать это в «Как пришла». */
  gist: string;
  /** Разбор по справочникам; null — вид обращения не разбирается или оно уже закрыто. */
  reconcile: OtherReconcile | null;
  state: 'open' | 'done' | 'cancelled';
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  place: string | null;
  status: string;
  source: string;
  waitingDays: number | null;
  callback: boolean;
  /**
   * Контакты скрыты от вошедшего (личный вход, а запись не его): телефон замаскирован — видны последние цифры, улицы,
   * хобби и профессии нет. Откроются, когда заявку возьмут себе («В работе у»). Скрывает сервер, интерфейс поясняет.
   */
  contactsHidden: boolean;
  responsible: string | null;
  note: string | null;
  /** Улица и дом, удобное время: те же поля, что у заявки в подбор (форма правки одна). */
  address: string | null;
  schedule: string | null;
  /** Хобби, профессия, семейное положение — свободным текстом, как их написал человек или внёс координатор. */
  hobby: string | null;
  profession: string | null;
  family: string | null;
  cancelReason: string | null;
  original: OriginalField[];
  table: RequestTableFields;
  log: LogEntry[];
  /**
   * Только у открытого «хочу открыть группу»: кого из ищущих группу можно было бы направить в будущую группу.
   * Будущая группа — потенциальная, заведённая по этому обращению (`futureGroup`), а если её нет — сами ответы
   * обращения (район, возраст, время, улица). null — у других обращений.
   */
  prospects?: Prospects | null;
  /** Группа, заведённая по этому обращению: потенциальная из «хочу открыть» или «Создать группу по заявке»; null — нет. */
  ownGroup: { id: number; code: string } | null;
}

export interface Prospects {
  /** Потенциальная группа, заведённая по обращению; null — считаем по самому обращению. */
  futureGroup: { id: number; code: string } | null;
  /** Где будет группа, неизвестно (нет ни района, ни адреса): кого направить, не посчитать. */
  unknownPlace: boolean;
  /** Сколько всего подходящих (в `items` — первые, самые подходящие). */
  total: number;
  items: ProspectItem[];
}

export interface ProspectItem {
  requestId: number;
  fio: string;
  ageLabel: string | null;
  place: string | null;
  /** 0–100: насколько подходит, как в обычном подборе. */
  score: number;
  reasons: Reason[];
  /** Код группы, которую человеку уже предложил подбор; null — пока ничего не предложено. */
  proposed: string | null;
}

/**
 * Разобрать обращение: человек вносится в состав групп или группы получают ведущего (вид выводит сервер по типу
 * обращения). Групп одна или несколько (до 20): человек ходит в две группы или ведёт две. Записывается всё или ничего.
 * Прежнее тело `{groupId}` сервер принимает, пока открыты старые вкладки.
 */
export interface ReconcileBody {
  groupIds: number[];
}

export interface ReconcileOk {
  ok: true;
  /** Уже было так во всех отмеченных группах: состав или ведущий не менялись, обращение закрыто. */
  already: boolean;
}

/** Разобрать сразу все обращения, у которых сервер находит ровно одну группу точно. Список — то, что человек видел. */
export interface ReconcileReadyBody {
  ids: number[];
}

export interface ReconcileReadyOk {
  ok: true;
  applied: number;
  /** Не разобраны: изменились с момента показа, закрыты или группа уже не одна. */
  skipped: number;
}

export interface RequestsView {
  generatedAt: string;
  matching: MatchingStatus;
  assistant: AssistantStatus;
  /** Без отказов; порядок — как показывать: перезвонить, готово, нужна помощь, утверждено. */
  items: RequestItem[];
  counters: Counters;
  /** Остальные обращения: открытые сверху (звонок, потом давно ждущие), закрытых не больше 200. */
  others: OtherItem[];
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
 * 403 `forbidden` (нужен вход super_mbv_admin); 409 `conflict` (такой логин или почта уже есть), 409 `already_closed` (заявку уже закрыли), `group_unavailable` (группа в архиве, закрыта или
 * «Не направлять»), `group_full` (мест нет; повторить с `force: true`).
 */
export interface ActionError {
  error: 'bad_request' | 'not_found' | 'already_closed' | 'group_unavailable' | 'group_full' | 'forbidden' | 'conflict' | 'unavailable';
  message: string;
}

// ── Создание записей («+ Создать») ──────────────────────────────────────────

/**
 * Поля формы — те же имена, что у форм старого дашборда (`src/dashboard/forms.ts`: parseGroupForm и
 * parseRequestForm), значения — строки. Проверяет сервер и возвращает первую ошибку по-русски (400).
 */
export interface CreateRecordBody {
  fields: Record<string, string>;
}

export interface CreateRecordOk {
  ok: true;
  id: number;
}

/**
 * Регистрация участника (поля — как у формы регистрации старого дашборда: fio, phone, church, mdgStatus,
 * leaderName, location, age, preferredContact, comment). Номер регистрации нужен для карточки и QR.
 */
export interface CreateRegistrationOk {
  ok: true;
  /** id участника: по нему открываются `/api/v1/people/:id/card` и `/qr`. */
  id: number;
  registrationNo: number;
}

/** Справочники для форм: серверные списки, чтобы интерфейс не держал свою копию. */
export interface FormMeta {
  districts: string[];
  /** Направления групп из справочника («Настройки → Направления»): основное, подростковое, молодёжное служение, филиалы. */
  groupDirections: string[];
  groupStatuses: string[];
  compositions: string[];
  requestStatuses: string[];
  requestTypes: { value: string; label: string }[];
  /** Возрастные категории анкеты бота («25-40»). */
  ageGroups: string[];
  /** Имена координаторов для поля «Координатор» / «Ответственный». */
  coordinators: string[];
  /** Справочник ролей команды: форма координатора выбирает роль из него. */
  teamRoles: { id: number; name: string }[];
  /** «Удобные дни» и «Удобное время» в заявке и регистрации: сервер собирает из них фразу «пн, ср вечером». */
  scheduleDays: { value: string; label: string }[];
  scheduleTimes: { value: string; label: string }[];
  /** Церкви для формы регистрации. */
  churches: string[];
  /** Ответ про малую группу в регистрации (value → подпись). */
  mdgStatuses: { value: string; label: string }[];
  /** Мест в группе по умолчанию (HG_DEFAULT_CAPACITY): действует, пока у группы не задано своё. */
  defaultCapacity: number;
  /** «Приём новых» у группы (value — как в таблице церкви: «ДА», «НЕТ», «По требованию»). */
  openToNew: { value: string; label: string }[];
  /** Действующие группы для «Домашняя группа» и «Рекомендованная группа» в форме заявки. */
  groups: { id: number; code: string; leader: string }[];
  /**
   * Зарегистрированные в боте, кто готов открыть группу или дать дом: выбор в форме группы подставляет ФИО и
   * телефон ведущего (как «Подобрать из зарегистрированных» в старом дашборде). Подпись — профиль из анкеты.
   */
  leaderCandidates: { id: number; fullName: string; phone: string | null; label: string }[];
}

// ── Справочник ──────────────────────────────────────────────────────────────

export interface HealthItem {
  ok: boolean;
  label: string;
  points: number;
}

/**
 * Человек в составе группы. Два источника: «направлен» — его утвердили в эту группу через сервис (появляется сам,
 * правится заявкой), «вручную» — внесён служителем как уже ходящий в группу (правится и убирается здесь).
 */
export interface GroupMember {
  /** Метка «Странный человек»; null — нет. */
  strange: StrangeMark | null;
  kind: 'placed' | 'manual';
  /** Ключ человека в справочнике («Люди»): u12, r345 или p7. Имя и телефон в составе читаются оттуда, а не копируются. */
  personKey: string;
  /** Для `placed` номер заявки, для `manual` номер строки состава. */
  id: number;
  fio: string;
  phone: string | null;
  /** Когда направлен (`placed`, если известно) или вступил (`manual`); ISO-дата. */
  date: string | null;
  note: string | null;
  /** Коды других групп, где этот человек тоже есть (совпал телефон, а без телефона — ФИО): повод проверить. */
  alsoIn: string[];
}

/** Добавить человека в состав: выбрать из справочника (`personKey`) ИЛИ внести нового (`newPerson`) — карточка появится в «Людях». */
export interface MemberAddBody {
  personKey?: string;
  /** Новая карточка: те же поля, что у формы правки человека (см. `PersonItem`). */
  newPerson?: {
    fio: string; phone?: string | null; age?: string | null; place?: string | null; note?: string | null;
    address?: string | null; schedule?: string | null; hobby?: string | null; profession?: string | null; family?: string | null;
  };
  /** Дата вступления, 2026-09-01, не из будущего. */
  joinedOn?: string | null;
  note?: string | null;
}

export interface MemberAddOk {
  ok: true;
  /** Номер строки состава. */
  id: number;
  /** Ключ человека в справочнике (у нового — p<id>). */
  personKey: string;
}

export interface GroupItem extends GroupBrief {
  /** Состав: сначала направленные через сервис, потом внесённые вручную. */
  members: GroupMember[];
  coLeader: string | null;
  phone: string | null;
  /** Телефон соведущего, как записан. */
  coLeaderPhone: string | null;
  /** Адрес группы (улица, дом) — как записал координатор. По нему подбор сопоставляет группу с адресом человека; если пусто, по `metro`. */
  address: string | null;
  ageText: string | null;
  /** День недели («Пн»…«Вс») или null. */
  day: string | null;
  slot: 'утро' | 'день' | 'вечер' | null;
  status: string;
  /** «Приём новых» не «Нет». */
  acceptsNew: boolean;
  /** «Мест в группе», заданное у самой группы; null — общее значение по умолчанию (оно в `capacity`). */
  capacityOwn: number | null;
  /** «Приём новых» как записан («ДА», «НЕТ», «По требованию»); null — не указан. Нужен форме правки. */
  openToNew: string | null;
  /** «Обучение» как записано в таблице церкви. */
  training: string | null;
  /** «Данные проверены». */
  checked: boolean;
  /** «40 дней» — ведущий зарегистрирован в кампании. */
  campaignRegistered: boolean;
  /** «Работает только в кампанию» (бывший статус «Кампания», миграция 047). */
  campaignOnly: boolean;
  doNotRefer: boolean;
  /**
   * «Камерная группа» — служителей или отдельного служения (миграция 052): людей в неё не направляют, а адрес и
   * телефоны видят только лидеры (катализатор, старший координатор), ответственный координатор и полный вход.
   */
  chamber: boolean;
  /**
   * Адрес и телефоны этой группы от вошедшего скрыты (камерная группа, а он не лидер и не её координатор): поля
   * `phone`, `coLeaderPhone`, `address`, `coords` пусты не потому, что их нет. Скрывает сервер, интерфейс только поясняет.
   */
  contactsHidden: boolean;
  composition: string | null;
  coordinator: string | null;
  /** Дней с последней обратной связи; null — не было. */
  verifiedDaysAgo: number | null;
  /** Дата открытия («2026-09-01»): от неё первые четыре месяца группа новая. null — неизвестна (старые группы). */
  openedOn: string | null;
  comment: string | null;
  health: { score: number; items: HealthItem[] };
  /** Координаты адреса группы (см. `GeoState`). */
  addressGeo: GeoState;
  /** Точка адреса группы для карты; null — адреса нет или он не нашёлся. */
  coords: { lat: number; lon: number; accuracy?: 'house' | 'street' | 'area' } | null;
  /**
   * Сколько человек утвердил сервис после последней обратной связи ведущего. Они уже добавлены к
   * `people`: ведущий обновит число сам, и счётчик обнулится (считаем только утверждённых позже).
   */
  placedNew: number;
  /**
   * Ведущий как ссылка на человека («u12»): появляется, когда обращение «уже веду группу» сверено со справочником.
   * null — ведущий записан только именем. По ключу в «Людях» находится его регистрация.
   */
  leaderKey: string | null;
  /**
   * Что ведущий ответил боту на досылку: когда собирается группа и где встречи. Сам в группу не переносится —
   * координатор сверяет и правит. null — ведущий не найден или ничего не ответил.
   */
  leaderAnswer: { schedule: string | null; address: string | null } | null;
  /** Кого план направляет в эту группу сейчас. */
  plannedRequests: { id: number; fio: string; ageLabel: string | null; place: string | null; confidence: number }[];
}

export interface GroupsView {
  generatedAt: string;
  items: GroupItem[];
}

export interface PersonItem {
  /** Метка «Странный человек»; null — нет. */
  strange: StrangeMark | null;
  /** Устойчивый ключ строки: «u12» (участник), «r345» (заявка без участника) или «p7» (карточка, внесённая вручную). */
  key: string;
  /** Номер карточки для ключа p<id> (правка и удаление через `/persons/:id/…`); у остальных null. */
  personId: number | null;
  /** Коды групп, в составе которых человек есть: направленный через сервис или внесённый вручную. */
  groups: string[];
  /**
   * Контакты скрыты от вошедшего: человек не из его заявок и не из состава его групп. Телефон замаскирован, адреса,
   * хобби и профессии нет. Скрывает сервер, интерфейс только поясняет.
   */
  contactsHidden: boolean;
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  district: string | null;
  /** Район, метро или ориентир — как написал человек; по нему подбор идёт, если адрес не заполнен. */
  place: string | null;
  /** Улица и дом — как написал человек; подбор сопоставляет по нему в первую очередь. */
  address: string | null;
  /** Удобное время — как написал человек. */
  schedule: string | null;
  /** Хобби, профессия, семейное положение — свободным текстом, как их написал человек или внёс координатор. */
  hobby: string | null;
  profession: string | null;
  family: string | null;
  /** Комментарий к человеку: у регистрации — служителя, у человека из заявки — комментарий заявки, у карточки — заметка. */
  note: string | null;
  /** Из регистрации: церковь, кто ведущий («уже состою в группе»), как удобнее связаться. У заявок без регистрации — null. */
  church: string | null;
  leaderName: string | null;
  preferredContact: string | null;
  /** Координаты этого адреса (см. `GeoState`). */
  addressGeo: GeoState;
  /** Откуда: «Бот · Telegram», «Таблица», «Форма регистрации». */
  from: string;
  /** id участника в боте/регистрации; null — запись только из таблицы (заявка без участника). */
  userId: number | null;
  /** Номер регистрации (для печатной карточки и QR); null — нет. */
  registrationNo: number | null;
  /** Что ответил про малую группу: «Хочет в группу», «Откроет свою группу», «Уже в группе»… */
  mdgLabel: string;
  /** ISO-дата регистрации или заявки. */
  date: string | null;
  requestId: number | null;
  /** ISO-дата выдачи набора участника кампании; null — не выдан или регистрации нет (набор выдают по регистрации). */
  kitIssuedOn: string | null;
}

export interface PeopleView {
  generatedAt: string;
  items: PersonItem[];
}

/** Участник на экране «Наборы»: кого нашёл QR или номер регистрации. */
export interface KitPerson {
  userId: number;
  registrationNo: number;
  fio: string;
  phone: string | null;
  /** Когда выдан набор (ISO-время); null — ещё не выдан. */
  issuedAt: string | null;
  /** Кто выдал: логин входа в интерфейс или «бот», если служитель отметил через Telegram. */
  issuedBy: string | null;
}

/** `GET /api/v1/kits`: сколько наборов выдано и последние выдачи (с них же отменяют ошибку). */
export interface KitsView {
  generatedAt: string;
  /** Зарегистрированных с номером: столько наборов нужно всего. */
  registered: number;
  issued: number;
  /** Выдано с полуночи по часовому поясу кампании. */
  issuedToday: number;
  /** Последние выдачи, свежие сверху. */
  recent: KitPerson[];
}

/** `POST /api/v1/kits/find`: тело `{ code }` — номер регистрации (или текст из QR). */
export interface KitFindOk {
  ok: true;
  person: KitPerson;
}

/** Строка списка при поиске по ФИО: телефон только хвостом — по нему отличают тёзок, спросив у человека. */
export interface KitMatch {
  userId: number;
  registrationNo: number;
  fio: string;
  /** Последние четыре цифры телефона; null — телефона нет. */
  phoneTail: string | null;
  issuedAt: string | null;
}

/** `POST /api/v1/kits/search`: тело `{ query }` — часть ФИО, от трёх букв. */
export interface KitSearchOk {
  ok: true;
  items: KitMatch[];
  /** Совпадений больше, чем показано: нужно уточнить запрос. */
  more: boolean;
}

/** `POST /api/v1/kits/issue` и `/undo`: тело `{ userId }`. */
export interface KitIssueOk {
  ok: true;
  person: KitPerson;
  /** false — отметка уже стояла (набор выдали раньше или отмены нечего отменять), ничего не изменилось. */
  changed: boolean;
}

export interface CoordinatorItem {
  id: number;
  name: string;
  /** Название роли из справочника ролей — для показа и отборов. */
  role: string;
  /** Ссылки на роли (их бывает несколько): их отмечает форма правки. */
  roleIds: number[];
  groups: number;
  people: number;
  /** Групп с обратной связью за последние 30 дней. */
  verified30: number;
}

export interface CoordinatorsView {
  generatedAt: string;
  items: CoordinatorItem[];
}

// ── Настройки (только super_mbv_admin) ──────────────────────────────────────

export type HealthStatus = 'ok' | 'warn' | 'crit';

export interface HealthMetric {
  key: 'cpu' | 'memory' | 'disk' | 'database' | 'sessions' | 'service';
  label: string;
  status: HealthStatus;
  /** Главное значение крупно: «2,1 ГБ свободно из 7,8 ГБ». */
  value: string;
  /** Пояснение мелко: что считается нормой и что делать. */
  hint: string;
  /** Доля занятого 0–100 для полосы; null — полосы нет (например, у базы). */
  percent: number | null;
}

/** Состояние сервера: считается при каждом запросе, не кэшируется. */
export interface SettingsHealthView {
  generatedAt: string;
  /** Худшее из состояний метрик: одно слово для шапки раздела. */
  overall: HealthStatus;
  metrics: HealthMetric[];
}

export interface ErrorEntry {
  id: number;
  /** ISO-время. */
  at: string;
  /** Где случилось: «домашние группы», «подбор», «бот». */
  service: string;
  /** Что случилось, без личных данных (телефоны и почты вырезаны). */
  message: string;
  /** Короткий контекст: «POST /api/v1/requests/12/approve». */
  context: string | null;
}

export interface SettingsErrorsView {
  generatedAt: string;
  /** Последние записи, новые сверху; не больше 200. */
  items: ErrorEntry[];
}

export interface AuditEntry {
  id: number;
  at: string;
  /** Кто: логин входа или «авто». */
  actor: string;
  service: string;
  /** Машинное имя действия: `request.approve`. */
  action: string;
  /** Действие по-русски: «Утвердил заявку». Нет перевода — `action` как есть. */
  actionLabel: string;
  entityType: string;
  entityId: number | null;
  /** Было → стало, как записано в журнале (без личных данных). */
  before: unknown;
  after: unknown;
  note: string | null;
}

export interface SettingsAuditView {
  generatedAt: string;
  /** Последние записи, новые сверху; не больше 200. */
  items: AuditEntry[];
}

export interface PromptVersion {
  version: number;
  at: string;
  by: string;
  note: string | null;
  /** Действующая версия блока. */
  active: boolean;
}

/** Блок инструкции агента. `editable: false` — служебный, задаётся кодом и в настройках только показывается. */
export interface PromptBlock {
  key: 'role' | 'principles' | 'steps' | 'examples' | 'service';
  title: string;
  /** Для чего блок, одной фразой. */
  purpose: string;
  editable: boolean;
  /** Действующий текст. */
  text: string;
  /** Это текст по умолчанию из кода: в базе версий блока ещё нет. */
  isDefault: boolean;
  /** Версии от новой к старой; пусто, пока блок не правили. */
  versions: PromptVersion[];
}

export interface PromptAgent {
  key: 'coordinator';
  title: string;
  /** Какая модель выполняет работу (пока справочно). */
  model: string;
  blocks: PromptBlock[];
}

export interface SettingsPromptsView {
  generatedAt: string;
  agents: PromptAgent[];
}

export interface SavePromptBody {
  agent: PromptAgent['key'];
  block: PromptBlock['key'];
  /** Новый текст, 1–20000 знаков. Сохраняется новой версией и сразу становится действующим. */
  text: string;
  note?: string;
}

export interface ActivatePromptBody {
  agent: PromptAgent['key'];
  block: PromptBlock['key'];
  /** Версия, которую сделать действующей (откат). */
  version: number;
}

// ── Личные входы (только super_mbv_admin) ───────────────────────────────────

/** invited — ждёт, пока человек задаст пароль; active — может входить; disabled — отключён. */
export type StaffStatus = 'invited' | 'active' | 'disabled';

export interface StaffItem {
  id: number;
  /** Логин вида `p_ivanova`. */
  login: string;
  fullName: string;
  /** null — заведён из справочника команды: почты нет, вход по выданному паролю. */
  email: string | null;
  role: Role;
  status: StaffStatus;
  /** ISO-время последнего входа; null — не входил. */
  lastLoginAt: string | null;
  /** Есть действующая (не использованная и не истёкшая) ссылка на пароль. */
  hasPendingLink: boolean;
}

export interface PersonalLoginsState {
  /** Личные входы включены: общий вход обычного уровня (`mbv_admin`) перестаёт работать. */
  enabled: boolean;
  /** Можно включать: есть хотя бы один действующий пользователь с заданным паролем. */
  canEnable: boolean;
  /** Сколько действующих пользователей уже задали пароль. */
  activeWithPassword: number;
  /** Настроена ли отправка почты на сервере; если нет, ссылки показываются на экране. */
  mailConfigured: boolean;
}

/**
 * Человек из справочника команды («Координаторы»: координаторы и распределители) и его вход. Учётная запись
 * заводится при первой генерации пароля; до этого `staffId` и `login` пусты.
 */
export interface TeamAccountItem {
  coordinatorId: number;
  name: string;
  /** Роль в команде, как в справочнике («Координатор», «Распределитель»…). */
  teamRole: string;
  staffId: number | null;
  login: string | null;
  /** Пароль уже выдан (или задан по ссылке). Сам пароль сервер не хранит и не показывает. */
  hasPassword: boolean;
  /** false — учётная запись отключена в «Пользователях»; пароль ей не выдать. */
  active: boolean;
  lastLoginAt: string | null;
}

export interface SettingsStaffView {
  generatedAt: string;
  items: StaffItem[];
  personal: PersonalLoginsState;
  /** Команда из справочника с кнопкой «Сгенерировать пароль». */
  team: TeamAccountItem[];
}

/** Сгенерировать пароль: человеку из справочника команды (`coordinatorId`) или уже заведённому пользователю (`staffId`). */
export type GeneratePasswordBody = { coordinatorId: number } | { staffId: number };

export interface GeneratePasswordOk {
  ok: true;
  login: string;
  /** Новый пароль. Показывается один раз: в базе только его хеш. */
  password: string;
}

export interface SuggestLoginBody {
  fullName: string;
}

export interface SuggestLoginOk {
  ok: true;
  /** Свободный логин: первая буква имени, `_`, фамилия латиницей. */
  login: string;
}

export interface CreateStaffBody {
  fullName: string;
  email: string;
  role: Role;
  /** Не указан — сервер подберёт сам (см. SuggestLoginBody). */
  login?: string;
}

export interface UpdateStaffBody {
  id: number;
  fullName?: string;
  email?: string;
  role?: Role;
  /** false — отключить (входить нельзя, текущие входы закрываются), true — включить обратно. */
  active?: boolean;
}

export interface StaffIdBody {
  id: number;
}

export interface PersonalModeBody {
  enabled: boolean;
}

/**
 * Итог отправки ссылки на пароль. sent — письмо ушло на `email`; link — почта не настроена или
 * письмо не ушло, тогда `path` (например, `/set-password?token=…`) показывается администратору,
 * и он передаёт ссылку сам: интерфейс собирает полный адрес из адреса, где открыт.
 */
export interface DeliveryOk {
  ok: true;
  delivery: 'sent' | 'link';
  /** null — у пользователя нет почты (заведён из справочника команды): ссылка только на экране. */
  email: string | null;
  /** Есть, когда delivery = 'link'. */
  path?: string;
  /** Логин созданного пользователя (при create). */
  login?: string;
  id?: number;
}

/**
 * Что роль команды значит для сервиса (ролей пять, миграция 051): distributor — распределитель (на него автоматически
 * назначаются новые заявки, после входа видит свои и ничьи), senior_distributor — старший распределитель (все заявки,
 * без отборов; заявки ему сами не раздаются), coordinator — координатор групп (свои группы и обращения «хочу открыть
 * группу»), senior — старший координатор и catalyst — катализатор (лидеры: всё без отборов и контакты камерных групп).
 */
export type TeamRoleKind = 'catalyst' | 'senior_distributor' | 'distributor' | 'senior' | 'coordinator';

/** Роль в «Настройки → Роли команды». */
export interface TeamRoleItem {
  id: number;
  name: string;
  kind: TeamRoleKind | null;
  /** Сколько действующих людей с этой ролью в справочнике команды: роль с людьми удалить нельзя. */
  members: number;
}

export interface TeamRolesView {
  items: TeamRoleItem[];
}

/** Направление группы в «Настройки → Направления» (основное, подростковое, молодёжное служение, филиалы). */
export interface GroupDirectionItem {
  id: number;
  name: string;
  /** Сколько действующих групп с этим направлением: направление с группами удалить нельзя. */
  groups: number;
}

export interface GroupDirectionsView {
  items: GroupDirectionItem[];
}

/**
 * `GET /api/v1/requests/:id/group-draft`: поля формы «Новая группа», заполненные по заявке («Создать группу по заявке»).
 * Группа создаётся обычным `POST /groups/create` с полем `sourceRequestId` — так она связывается с заявкой.
 */
export interface GroupDraftView {
  requestId: number;
  fio: string;
  /** Имена — как у полей формы группы (`leader`, `phone`, `district`…). Чего по заявке не понять, того здесь нет. */
  fields: Record<string, string>;
  /** Группа, уже заведённая по этой заявке; null — ещё нет. Второй по той же заявке не завести. */
  ownGroup: { id: number; code: string } | null;
}
