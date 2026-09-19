import { OTHER_CHURCH, attendsMbv, churchByIndex, otherChurchByIndex } from './churches.js';
import { formatPhone, normalizePhone } from './phone.js';
import type { Button, IncomingUpdate } from './platform.js';
import {
  AGE_GROUPS,
  CB,
  KIT_DATE,
  MDG_DEADLINE,
  MDG_LABEL,
  T,
  ageKeyboard,
  backKeyboard,
  cancelQuestionKeyboard,
  churchKeyboard,
  consentKeyboard,
  mdgKeyboard,
  menuKeyboard,
  otherChurchKeyboard,
  summaryKeyboard,
} from './texts.js';

/**
 * Диалог регистрации по ТЗ как чистая функция:
 * (состояние, черновик, апдейт) -> (ответы, новое состояние, эффекты).
 *
 * Никаких обращений к БД и платформам, поэтому весь сценарий покрывается юнит-тестами.
 * Побочные действия возвращаются наружу списком эффектов, их исполняет router.
 */

export type FsmState =
  | 'idle'
  | 'await_consent'
  | 'await_fio'
  | 'await_phone'
  | 'await_church'
  /** Второй экран церквей: человек выбрал «Другая церковь». */
  | 'await_other_church'
  | 'await_mdg'
  | 'await_location'
  | 'await_age'
  | 'await_leader_name'
  | 'summary'
  | 'menu'
  /** Человек нажал «Задать вопрос» и пишет его текстом. */
  | 'await_question';

/**
 * Что у человека с малой домашней группой.
 *
 * `home` — готов пустить группу к себе домой, но вести не берётся. Дальше по
 * сценарию идёт тем же путём, что и `open`, но координатору разница важна:
 * одному нужен ведущий, другому — место.
 */
export type MdgStatus = 'open' | 'home' | 'join' | 'member' | 'leader';

export interface Draft {
  consent?: boolean;
  fio?: string;
  phone?: string;
  /** Сколько раз человек ввёл телефон, который не удалось разобрать. */
  phoneAttempts?: number;
  church?: string;
  mdgStatus?: MdgStatus;
  location?: string;
  /** Возрастная категория, а не число: спрашиваем кнопкой (см. AGE_GROUPS). */
  age?: string;
  leaderName?: string;
}

export type ProfilePatch = Omit<Draft, 'consent' | 'phoneAttempts'>;

export type RequestType = 'join_group' | 'lead_group' | 'question' | 'already_member' | 'already_leader';

/**
 * Почему нельзя подать заявку на открытие группы; null — можно.
 *
 * pending — заявка этого же аккаунта ещё не закрыта. Остальные два — сверка по
 * телефону: тот же человек мог написать из другой платформы, или его номер уже
 * записан ведущим действующей группы.
 */
export type LeadBlock = 'pending' | 'phone_group' | null;

export type Effect =
  | { kind: 'consent' }
  /** Пишем собранное по шагам: если человек бросит анкету, у церкви останется хотя бы контакт. */
  | { kind: 'save'; patch: ProfilePatch }
  /** Присвоение номера регистрации. complete=false, если человек завершил досрочно. */
  | { kind: 'finish'; complete: boolean }
  | { kind: 'create_request'; type: RequestType; text?: string };

export interface OutAction {
  kind: 'message' | 'request_contact' | 'clear_contact_ui';
  text: string;
  buttons?: Button[][];
}

/** Данные уже зарегистрированного участника: нужны меню и экрану статуса. */
export interface Participant {
  complete: boolean;
  registrationNo: number | null;
  mdgStatus: MdgStatus | null;
  kitIssued: boolean;
}

export interface FsmInput {
  state: FsmState;
  draft: Draft;
  update: IncomingUpdate;
  /** Анкета доведена до присвоения номера регистрации. */
  registered: boolean;
  participant?: Participant;
  /** Виды заявок этого человека, которые служители ещё не закрыли. */
  openRequests?: RequestType[];
  /** Сколько вопросов человека ещё без ответа. Ограничиваем, чтобы не завалить служителей. */
  openQuestions?: number;
  /** Что нашла сверка телефона: у номера уже есть действующая группа в реестре. */
  leadPhoneTaken?: 'group';
}

export interface FsmResult {
  actions: OutAction[];
  state: FsmState;
  draft: Draft;
  effects: Effect[];
}

const MDG_DONE: Record<MdgStatus, string> = {
  open: T.mdgOpenDone(),
  home: T.mdgOpenDone(),
  join: T.mdgJoinDone(MDG_DEADLINE),
  member: T.mdgMemberDone,
  leader: T.mdgLeaderDone,
};

const msg = (text: string, buttons?: Button[][]): OutAction =>
  buttons ? { kind: 'message', text, buttons } : { kind: 'message', text };

const ignore = (state: FsmState, draft: Draft): FsmResult => ({ actions: [], state, draft, effects: [] });

const stay = (state: FsmState, draft: Draft, actions: OutAction[], effects: Effect[] = []): FsmResult => ({
  actions,
  state,
  draft,
  effects,
});

// ── шаги анкеты ─────────────────────────────────────────────────────────────

const askConsent = (): FsmResult =>
  stay('await_consent', {}, [msg(T.greeting, consentKeyboard())]);

const askFio = (draft: Draft): FsmResult => stay('await_fio', draft, [msg(T.askFio)]);

const askPhone = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_phone', draft, [{ kind: 'request_contact', text: T.askPhone }], effects);

/**
 * Вопрос про церковь идёт двумя сообщениями: первым убираем клавиатуру с кнопкой телефона.
 * В Telegram одно сообщение не может нести и удаление reply-клавиатуры, и инлайн-кнопки.
 */
const askChurch = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay(
    'await_church',
    draft,
    [
      { kind: 'clear_contact_ui', text: 'Спасибо!' },
      msg(T.askChurch, churchKeyboard()),
    ],
    effects,
  );

const askOtherChurch = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_other_church', draft, [msg(T.askOtherChurch, otherChurchKeyboard())], effects);

const askMdg = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_mdg', draft, [msg(T.askMdg, mdgKeyboard(attendsMbv(draft.church)))], effects);

/** Тем, кто открывает группу, подбираем место встреч; тем, кто ищет, — группу рядом. */
const askLocation = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay(
    'await_location',
    draft,
    [msg(draft.mdgStatus === 'join' ? T.askLocationJoin : T.askLocationOpen, backKeyboard())],
    effects,
  );

const askAge = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_age', draft, [msg(T.askAge, ageKeyboard())], effects);

const askLeaderName = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_leader_name', draft, [msg(T.askLeaderName, backKeyboard())], effects);

/** Итоговая сводка: ТЗ требует показать всё собранное и получить подтверждение. */
/**
 * Строки анкеты в виде «Подпись: значение» — общие и для экрана проверки перед
 * регистрацией, и для карточки регистрации с QR (там нужны те же данные целиком,
 * чтобы карточку можно было переслать или распечатать одним сообщением).
 */
export function profileRows(draft: Draft): string[] {
  const rows = [
    `ФИО: ${draft.fio ?? 'не указано'}`,
    `Телефон: ${formatPhone(draft.phone) || 'не указан'}`,
    `Церковь: ${draft.church ?? 'не указана'}`,
  ];
  if (draft.mdgStatus) rows.push(`Заявка: ${MDG_LABEL[draft.mdgStatus]}`);
  if (draft.leaderName) rows.push(`Ведущий группы: ${draft.leaderName}`);
  if (draft.location) rows.push(`Район: ${draft.location}`);
  if (draft.age) rows.push(`Возраст: ${draft.age}`);
  return rows;
}

function showSummary(draft: Draft, effects: Effect[] = []): FsmResult {
  return stay(
    'summary',
    draft,
    [msg([T.summaryTitle, '', ...profileRows(draft), '', T.summaryFooter].join('\n'), summaryKeyboard())],
    effects,
  );
}

const showMenu = (draft: Draft, text: string): FsmResult =>
  stay('menu', draft, [msg(text, menuKeyboard())]);

function profilePatch(draft: Draft): ProfilePatch {
  const { consent: _consent, phoneAttempts: _attempts, ...patch } = draft;
  return patch;
}

// ── основной обработчик ─────────────────────────────────────────────────────

export function handleUpdate({
  state,
  draft: incoming,
  update,
  registered,
  participant,
  openRequests,
  openQuestions,
  leadPhoneTaken,
}: FsmInput): FsmResult {
  const draft: Draft = { ...incoming };
  const alreadyOpen = (type: RequestType): boolean => (openRequests ?? []).includes(type);
  // Своя незакрытая заявка важнее сверки по телефону: человеку надо ответить про неё.
  const leadBlock: LeadBlock = alreadyOpen('lead_group')
    ? 'pending'
    : leadPhoneTaken === 'group'
      ? 'phone_group'
      : null;

  if (update.kind === 'start') {
    return registered ? showMenu(draft, T.welcomeBack) : askConsent();
  }

  // Кнопки меню работают у зарегистрированного человека в любом состоянии.
  if (update.kind === 'callback' && registered && update.data.startsWith('menu:')) {
    return handleMenu(update.data, draft, leadBlock, participant, openQuestions ?? 0);
  }

  /*
   * «Вернуться» к вопросу про малую группу. Человек мог нажать не ту кнопку, и без
   * этого ему пришлось бы проходить анкету заново. Прежний выбор стираем: иначе
   * сводка покажет ответы от отменённой ветки.
   */
  if (update.kind === 'callback' && update.data === CB.back && draft.church) {
    const { mdgStatus: _s, location: _l, age: _a, leaderName: _n, ...kept } = draft;
    return askMdg(kept);
  }

  switch (state) {
    case 'idle':
      return registered ? showMenu(draft, T.menuHint) : askConsent();

    case 'await_consent':
      if (update.kind === 'callback' && update.data === CB.consentYes) {
        const next = askFio({ ...draft, consent: true });
        return { ...next, effects: [{ kind: 'consent' }] };
      }
      if (update.kind === 'callback' && update.data === CB.consentNo) {
        return stay('idle', {}, [msg(T.consentDeclined)]);
      }
      return askConsent();

    case 'await_fio':
      if (update.kind !== 'text') return stay('await_fio', draft, [msg(T.askFio)]);
      return awaitFio(update.text, draft);

    case 'await_phone':
      return awaitPhone(update, draft);

    case 'await_church':
      return awaitChurch(update, draft);

    case 'await_other_church':
      return awaitOtherChurch(update, draft);

    case 'await_mdg':
      return awaitMdg(update, draft);

    case 'await_location':
      if (update.kind !== 'text') return ignore('await_location', draft);
      return awaitLocation(update.text, draft);

    case 'await_age':
      return awaitAge(update, draft);

    case 'await_leader_name':
      if (update.kind !== 'text') return ignore('await_leader_name', draft);
      return awaitLeaderName(update.text, draft);

    case 'summary':
      return awaitConfirm(update, draft, alreadyOpen, leadBlock);

    case 'await_question':
      return awaitQuestion(update, draft);

    case 'menu':
      // Переписки с участниками нет, поэтому на свободный текст объясняем это прямо.
      if (update.kind === 'text') return showMenu(draft, T.menuNoChat);
      return ignore('menu', draft);
  }
}

// ── обработчики шагов ───────────────────────────────────────────────────────

/**
 * Слово похоже на часть имени: русские буквы, внутри допустимы дефис и апостроф
 * (Кузнецова-Иванова, Анна-Мария).
 *
 * Проверяем именно кириллицу, а не «нет цифр»: в журнале лежит настоящее
 * «hjlbjyjd lfdbl» — это «Родионов Давид», набранное при английской раскладке,
 * и прежняя проверка такое пропускала. Блок кириллицы берём целиком, чтобы
 * проходили і, ї, є, ў у людей из Украины и Беларуси. Первый символ обязан быть
 * буквой, иначе прошло бы «--».
 */
const NAME_WORD = /^\p{Script=Cyrillic}[\p{Script=Cyrillic}'\u2019-]*$/u;

const isName = (words: string[]): boolean => words.every((w) => NAME_WORD.test(w));

function awaitFio(raw: string, draft: Draft): FsmResult {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const looksLikeName = words.length >= 2 && words.every((w) => w.length >= 2) && isName(words);
  if (!looksLikeName) return stay('await_fio', draft, [msg(T.fioInvalid)]);

  const fio = words.join(' ');
  return askPhone({ ...draft, fio }, [{ kind: 'save', patch: { fio } }]);
}

function awaitPhone(update: IncomingUpdate, draft: Draft): FsmResult {
  const accept = (phone: string): FsmResult =>
    askChurch({ ...draft, phone, phoneAttempts: 0 }, [{ kind: 'save', patch: { phone } }]);

  if (update.kind === 'contact') {
    if (!update.isOwn) {
      return stay('await_phone', draft, [{ kind: 'request_contact', text: T.notOwnContact }]);
    }
    const phone = normalizePhone(update.phone);
    return phone ? accept(phone) : retryPhone(draft);
  }

  // Номер только кнопкой «поделиться»: иначе можно вписать чужой и заблокировать
  // им чужую регистрацию (заявка ищется по номеру телефона).
  if (update.kind === 'text') {
    return stay('await_phone', draft, [{ kind: 'request_contact', text: T.phoneTypedNotAllowed }]);
  }

  return ignore('await_phone', draft);
}

/** Контакт есть, но номер в нём не разобрать (редкость — платформа отдала мусор). */
function retryPhone(draft: Draft): FsmResult {
  const attempts = (draft.phoneAttempts ?? 0) + 1;
  return stay('await_phone', { ...draft, phoneAttempts: attempts }, [{ kind: 'request_contact', text: T.phoneInvalid }]);
}

function awaitChurch(update: IncomingUpdate, draft: Draft): FsmResult {
  if (update.kind !== 'callback' || !update.data.startsWith(CB.churchPrefix)) {
    return stay('await_church', draft, [msg(T.churchHint, churchKeyboard())]);
  }

  const church = churchByIndex(Number.parseInt(update.data.slice(CB.churchPrefix.length), 10));
  if (!church) return stay('await_church', draft, [msg(T.churchHint, churchKeyboard())]);

  // «Другая церковь» — это не ответ, а переход ко второму экрану со списком церквей.
  if (church === OTHER_CHURCH) return askOtherChurch(draft);

  const next: Draft = { ...draft, church };
  const effects: Effect[] = [{ kind: 'save', patch: { church } }];
  return askMdg(next, effects);
}

function awaitOtherChurch(update: IncomingUpdate, draft: Draft): FsmResult {
  if (update.kind !== 'callback' || !update.data.startsWith(CB.otherChurchPrefix)) {
    return stay('await_other_church', draft, [msg(T.churchHint, otherChurchKeyboard())]);
  }

  const church = otherChurchByIndex(
    Number.parseInt(update.data.slice(CB.otherChurchPrefix.length), 10),
  );
  if (!church) return stay('await_other_church', draft, [msg(T.churchHint, otherChurchKeyboard())]);

  // Название церкви, которой нет в списке, отдельно не спрашиваем: со всеми из других
  // церквей служитель связывается лично, и там же это выясняется.
  const next: Draft = { ...draft, church };
  return askMdg(next, [{ kind: 'save', patch: { church } }]);
}

function awaitMdg(update: IncomingUpdate, draft: Draft): FsmResult {
  // Справка вопрос не закрывает: рассказали и снова показали варианты.
  if (update.kind === 'callback' && update.data === CB.mdgAbout) {
    return stay('await_mdg', draft, [msg(T.mdgAbout, mdgKeyboard(attendsMbv(draft.church)))]);
  }

  const chosen = readMdgChoice(update);
  if (!chosen) return stay('await_mdg', draft, [msg(T.mdgHint, mdgKeyboard(attendsMbv(draft.church)))]);

  // Сверку телефона сюда больше не выносим: заявка теперь заводится в любом
  // случае (см. awaitConfirm), так что впустую заполнять анкету уже нечего —
  // человек просто идёт обычным путём, а служитель сам сверяет по заявке.
  const next: Draft = { ...draft, mdgStatus: chosen };
  const effects: Effect[] = [{ kind: 'save', patch: { mdgStatus: chosen } }];

  switch (chosen) {
    case 'open':
    case 'home':
    case 'join':
      return askLocation(next, effects);
    case 'member':
      return askLeaderName(next, effects);
    case 'leader':
      // Ведущему уточняющие вопросы не нужны.
      return showSummary(next, effects);
  }
}

function readMdgChoice(update: IncomingUpdate): MdgStatus | null {
  if (update.kind !== 'callback') return null;
  switch (update.data) {
    case CB.mdgOpen:
      return 'open';
    case CB.mdgHome:
      return 'home';
    case CB.mdgJoin:
      return 'join';
    case CB.mdgMember:
      return 'member';
    case CB.mdgLeader:
      return 'leader';
    default:
      return null;
  }
}

function awaitLocation(raw: string, draft: Draft): FsmResult {
  const location = raw.trim();
  if (location.length < 2) return askLocation(draft);
  return askAge({ ...draft, location }, [{ kind: 'save', patch: { location } }]);
}

function awaitAge(update: IncomingUpdate, draft: Draft): FsmResult {
  if (update.kind !== 'callback' || !update.data.startsWith(CB.agePrefix)) {
    return stay('await_age', draft, [msg(T.askAge, ageKeyboard())]);
  }

  const age = AGE_GROUPS[Number.parseInt(update.data.slice(CB.agePrefix.length), 10)];
  if (!age) return stay('await_age', draft, [msg(T.askAge, ageKeyboard())]);

  return showSummary({ ...draft, age }, [{ kind: 'save', patch: { age } }]);
}

function awaitLeaderName(raw: string, draft: Draft): FsmResult {
  const leaderName = raw.trim();
  // Кнопку «Вернуться» оставляем и в отказе: иначе человек застрянет на этом шаге.
  if (leaderName.length < 3 || !isName(leaderName.split(/\s+/).filter(Boolean))) {
    return stay('await_leader_name', draft, [msg(T.leaderNameInvalid, backKeyboard())]);
  }
  // Возраст у состоящих в группе не спрашиваем: группа у человека уже есть.
  return showSummary({ ...draft, leaderName }, [{ kind: 'save', patch: { leaderName } }]);
}

function awaitConfirm(
  update: IncomingUpdate,
  draft: Draft,
  alreadyOpen: (t: RequestType) => boolean,
  leadBlock: LeadBlock,
): FsmResult {
  if (update.kind === 'callback' && update.data === CB.redo) {
    // Согласие переспрашивать не нужно, его человек уже дал.
    return askFio({ consent: draft.consent });
  }

  if (update.kind !== 'callback' || update.data !== CB.confirm) {
    return showSummary(draft);
  }

  const effects: Effect[] = [
    { kind: 'save', patch: profilePatch(draft) },
    { kind: 'finish', complete: true },
  ];

  // Любой ответ про малую группу заводит заявку служителю — даже «уже состою»/
  // «уже веду» и даже когда телефон совпал с действующей группой реестра.
  // Раньше в этих случаях заявки не было вообще: служитель не видел ни самого
  // обращения, ни повода его перепроверить.
  const offersGroup = draft.mdgStatus === 'open' || draft.mdgStatus === 'home';
  if (draft.mdgStatus === 'join' && !alreadyOpen('join_group')) {
    effects.push({ kind: 'create_request', type: 'join_group' });
  }
  if (offersGroup) {
    effects.push({ kind: 'create_request', type: 'lead_group' });
  }
  if (draft.mdgStatus === 'member') {
    effects.push({ kind: 'create_request', type: 'already_member' });
  }
  if (draft.mdgStatus === 'leader') {
    effects.push({ kind: 'create_request', type: 'already_leader' });
  }

  // Совпадение с действующей группой заявку больше не отменяет — только меняет,
  // что человек прочтёт напоследок: честно про уже существующую группу.
  const done = offersGroup && leadBlock
    ? LEAD_BLOCK_TEXT[leadBlock]
    : draft.mdgStatus
      ? MDG_DONE[draft.mdgStatus]
      : T.otherChurchDone;
  return { actions: [msg(done, menuKeyboard())], state: 'menu', draft, effects };
}

/** Что отвечаем, когда заявку на открытие группы подавать не нужно. */
const LEAD_BLOCK_TEXT: Record<NonNullable<LeadBlock>, string> = {
  pending: T.leadRequestPending,
  phone_group: T.leadPhoneIsLeader,
};

/** Больше трёх открытых вопросов от одного человека служители разобрать не успевают. */
const MAX_OPEN_QUESTIONS = 3;

/**
 * Вопрос человека служителю.
 *
 * В отличие от заявки на группу, вопросов может быть несколько: одна тема не мешает
 * другой. Поэтому здесь не запрет на повтор, а предел на число неотвеченных.
 */
function awaitQuestion(update: IncomingUpdate, draft: Draft): FsmResult {
  if (update.kind === 'callback' && update.data === CB.cancelQuestion) {
    return stay('menu', draft, [msg(T.questionCancelled, menuKeyboard())]);
  }
  if (update.kind !== 'text') return ignore('await_question', draft);

  const question = update.text.trim();
  if (question.length < 5) {
    return stay('await_question', draft, [msg(T.questionTooShort, cancelQuestionKeyboard())]);
  }

  return {
    actions: [msg(T.questionAccepted, menuKeyboard())],
    state: 'menu',
    draft,
    effects: [{ kind: 'create_request', type: 'question', text: question }],
  };
}

function handleMenu(
  data: string,
  draft: Draft,
  leadBlock: LeadBlock,
  participant?: Participant,
  openQuestions = 0,
): FsmResult {
  switch (data) {
    case CB.menuAsk:
      if (openQuestions >= MAX_OPEN_QUESTIONS) {
        return stay('menu', draft, [msg(T.questionTooMany, menuKeyboard())]);
      }
      return stay('await_question', draft, [
        msg(T.askQuestion, cancelQuestionKeyboard()),
      ]);

    case CB.menuStatus:
      return stay('menu', draft, [msg(statusText(participant), menuKeyboard())]);

    case CB.menuLead:
      // «pending» — это уже поданная и ещё не закрытая заявка этого же человека:
      // повторный клик не должен плодить копии. «phone_group» — просто совпадение
      // с действующей группой реестра, оно заявку больше не отменяет, только текст.
      if (leadBlock === 'pending') {
        return stay('menu', draft, [msg(LEAD_BLOCK_TEXT[leadBlock], menuKeyboard())]);
      }
      return {
        actions: [msg(leadBlock ? LEAD_BLOCK_TEXT[leadBlock] : T.leadRequestAccepted, menuKeyboard())],
        state: 'menu',
        draft,
        effects: [{ kind: 'create_request', type: 'lead_group' }],
      };

    default:
      return showMenu(draft, T.menuHint);
  }
}

/** Экран «Проверить статус» из ТЗ. */
function statusText(participant?: Participant): string {
  if (!participant) return T.statusIncomplete;

  const lines: string[] = [];
  if (!participant.complete) lines.push(T.statusIncomplete, '');

  if (participant.kitIssued) {
    lines.push(T.statusKitIssued);
  } else if (participant.mdgStatus === 'open' || participant.mdgStatus === 'home') {
    lines.push(T.statusWaitingOpen(MDG_DEADLINE));
  } else if (participant.mdgStatus === 'join') {
    lines.push(T.statusWaitingMdg(MDG_DEADLINE));
  } else {
    lines.push(T.statusKitReady(KIT_DATE));
  }

  if (participant.registrationNo !== null) {
    lines.push('', T.registrationNo(participant.registrationNo));
  }

  return lines.join('\n');
}
