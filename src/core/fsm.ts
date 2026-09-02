import { attendsMbv, churchByIndex } from './churches.js';
import { formatPhone, normalizePhone } from './phone.js';
import { years } from './plural.js';
import type { Button, IncomingUpdate } from './platform.js';
import {
  CB,
  KIT_DATE,
  MDG_DEADLINE,
  MDG_LABEL,
  T,
  cancelQuestionKeyboard,
  churchKeyboard,
  consentKeyboard,
  finishKeyboard,
  mdgKeyboard,
  menuKeyboard,
  skipKeyboard,
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
  | 'await_mdg'
  | 'await_location'
  | 'await_age'
  | 'await_companions'
  | 'await_leader_name'
  | 'summary'
  | 'menu'
  /** Человек нажал «Задать вопрос» и пишет его текстом. */
  | 'await_question';

/** Что у человека с домашней группой. */
export type MdgStatus = 'open' | 'join' | 'member' | 'leader';

export interface Draft {
  consent?: boolean;
  fio?: string;
  phone?: string;
  /** Сколько раз человек ввёл телефон, который не удалось разобрать. */
  phoneAttempts?: number;
  church?: string;
  mdgStatus?: MdgStatus;
  location?: string;
  age?: number;
  companions?: string;
  leaderName?: string;
}

export type ProfilePatch = Omit<Draft, 'consent' | 'phoneAttempts'>;

export type RequestType = 'join_group' | 'lead_group' | 'question';

/**
 * Почему нельзя подать заявку на открытие группы; null — можно.
 *
 * pending — заявка этого же аккаунта ещё не закрыта. Остальные два — сверка по
 * телефону: тот же человек мог написать из другой платформы, или его номер уже
 * записан ведущим действующей группы.
 */
export type LeadBlock = 'pending' | 'phone_request' | 'phone_group' | null;

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
  /** Что нашла сверка телефона: открытая заявка на открытие группы или действующая группа. */
  leadPhoneTaken?: 'request' | 'group';
}

export interface FsmResult {
  actions: OutAction[];
  state: FsmState;
  draft: Draft;
  effects: Effect[];
}

const MDG_DONE: Record<MdgStatus, string> = {
  open: T.mdgOpenDone(),
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

const askFio = (draft: Draft, intro = false): FsmResult =>
  stay('await_fio', draft, intro ? [msg(T.dataNotice), msg(T.askFio)] : [msg(T.askFio)]);

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

const askMdg = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_mdg', draft, [msg(T.askMdg, mdgKeyboard())], effects);

const askLocation = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_location', draft, [msg(T.askLocation, finishKeyboard())], effects);

const askAge = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_age', draft, [msg(T.askAge, finishKeyboard())], effects);

const askCompanions = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_companions', draft, [msg(T.askCompanions, skipKeyboard())], effects);

const askLeaderName = (draft: Draft, effects: Effect[] = []): FsmResult =>
  stay('await_leader_name', draft, [msg(T.askLeaderName, finishKeyboard())], effects);

/** Итоговая сводка: ТЗ требует показать всё собранное и получить подтверждение. */
function showSummary(draft: Draft, effects: Effect[] = []): FsmResult {
  const rows = [
    `ФИО: ${draft.fio ?? 'не указано'}`,
    `Телефон: ${formatPhone(draft.phone) || 'не указан'}`,
    `Церковь: ${draft.church ?? 'не указана'}`,
  ];
  if (draft.mdgStatus) rows.push(`Домашняя группа: ${MDG_LABEL[draft.mdgStatus]}`);
  if (draft.leaderName) rows.push(`Ведущий группы: ${draft.leaderName}`);
  if (draft.location) rows.push(`Район: ${draft.location}`);
  if (draft.age) rows.push(`Возраст: ${years(draft.age)}`);
  if (draft.companions) rows.push(`С кем планируете посещать: ${draft.companions}`);

  return stay(
    'summary',
    draft,
    [msg([T.summaryTitle, '', ...rows, '', T.summaryFooter].join('\n'), summaryKeyboard())],
    effects,
  );
}

const showMenu = (draft: Draft, text: string, participant?: Participant): FsmResult =>
  stay('menu', draft, [msg(text, menuKeyboard(participant ? !participant.complete : false))]);

/** Досрочное завершение: ТЗ разрешает выйти на любом уточняющем вопросе. */
const finishEarly = (draft: Draft): FsmResult => ({
  actions: [msg(T.incompleteWarning, menuKeyboard(true))],
  state: 'menu',
  draft,
  effects: [{ kind: 'save', patch: profilePatch(draft) }, { kind: 'finish', complete: false }],
});

function profilePatch(draft: Draft): ProfilePatch {
  const { consent: _consent, phoneAttempts: _attempts, ...patch } = draft;
  return patch;
}

/** Первый вопрос, на который человек ещё не ответил. Нужен кнопке «Дозаполнить анкету». */
export function nextMissingStep(draft: Draft): FsmState {
  if (!draft.fio) return 'await_fio';
  if (!draft.phone) return 'await_phone';
  if (!draft.church) return 'await_church';
  if (!attendsMbv(draft.church)) return 'summary';
  if (!draft.mdgStatus) return 'await_mdg';
  if (draft.mdgStatus === 'member' && !draft.leaderName) return 'await_leader_name';
  if ((draft.mdgStatus === 'open' || draft.mdgStatus === 'join') && !draft.location) return 'await_location';
  if (draft.mdgStatus !== 'leader' && !draft.age) return 'await_age';
  if (draft.mdgStatus === 'join' && !draft.companions) return 'await_companions';
  return 'summary';
}

/** Переход на нужный шаг по состоянию черновика. */
function goToStep(step: FsmState, draft: Draft, effects: Effect[] = []): FsmResult {
  switch (step) {
    case 'await_fio':
      return askFio(draft);
    case 'await_phone':
      return askPhone(draft, effects);
    case 'await_church':
      return askChurch(draft, effects);
    case 'await_mdg':
      return askMdg(draft, effects);
    case 'await_location':
      return askLocation(draft, effects);
    case 'await_age':
      return askAge(draft, effects);
    case 'await_companions':
      return askCompanions(draft, effects);
    case 'await_leader_name':
      return askLeaderName(draft, effects);
    default:
      return showSummary(draft, effects);
  }
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
    : leadPhoneTaken === 'request'
      ? 'phone_request'
      : leadPhoneTaken === 'group'
        ? 'phone_group'
        : null;

  if (update.kind === 'start') {
    return registered ? showMenu(draft, T.welcomeBack, participant) : askConsent();
  }

  // Кнопки меню работают у зарегистрированного человека в любом состоянии.
  if (update.kind === 'callback' && registered && update.data.startsWith('menu:')) {
    return handleMenu(update.data, draft, leadBlock, participant, openQuestions ?? 0);
  }

  // Досрочное завершение доступно на всех уточняющих вопросах.
  if (update.kind === 'callback' && update.data === CB.finishEarly && draft.phone && draft.fio) {
    return finishEarly(draft);
  }

  switch (state) {
    case 'idle':
      return registered ? showMenu(draft, T.menuHint, participant) : askConsent();

    case 'await_consent':
      if (update.kind === 'callback' && update.data === CB.consentYes) {
        const next = askFio({ ...draft, consent: true }, true);
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

    case 'await_mdg':
      return awaitMdg(update, draft);

    case 'await_location':
      if (update.kind !== 'text') return ignore('await_location', draft);
      return awaitLocation(update.text, draft);

    case 'await_age':
      if (update.kind !== 'text') return ignore('await_age', draft);
      return awaitAge(update.text, draft);

    case 'await_companions':
      if (update.kind === 'callback' && update.data === CB.skip) return showSummary(draft);
      if (update.kind !== 'text') return ignore('await_companions', draft);
      return awaitCompanions(update.text, draft);

    case 'await_leader_name':
      if (update.kind !== 'text') return ignore('await_leader_name', draft);
      return awaitLeaderName(update.text, draft);

    case 'summary':
      return awaitConfirm(update, draft, alreadyOpen, leadBlock);

    case 'await_question':
      return awaitQuestion(update, draft, participant);

    case 'menu':
      // Переписки с участниками нет, поэтому на свободный текст объясняем это прямо.
      if (update.kind === 'text') return showMenu(draft, T.menuNoChat, participant);
      return ignore('menu', draft);
  }
}

// ── обработчики шагов ───────────────────────────────────────────────────────

function awaitFio(raw: string, draft: Draft): FsmResult {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const looksLikeName = words.length >= 2 && words.every((w) => w.length >= 2 && !/\d/.test(w));
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

  if (update.kind === 'text') {
    const phone = normalizePhone(update.text);
    return phone ? accept(phone) : retryPhone(draft);
  }

  return ignore('await_phone', draft);
}

function retryPhone(draft: Draft): FsmResult {
  const attempts = (draft.phoneAttempts ?? 0) + 1;
  // С первой ошибки просим повторить, со второй показываем пример формата.
  const text = attempts >= 2 ? T.phoneFormatHint : T.phoneInvalid;
  return stay('await_phone', { ...draft, phoneAttempts: attempts }, [{ kind: 'request_contact', text }]);
}

function awaitChurch(update: IncomingUpdate, draft: Draft): FsmResult {
  if (update.kind !== 'callback' || !update.data.startsWith(CB.churchPrefix)) {
    return stay('await_church', draft, [msg(T.churchHint, churchKeyboard())]);
  }

  const church = churchByIndex(Number.parseInt(update.data.slice(CB.churchPrefix.length), 10));
  if (!church) return stay('await_church', draft, [msg(T.churchHint, churchKeyboard())]);

  const next: Draft = { ...draft, church };
  const effects: Effect[] = [{ kind: 'save', patch: { church } }];

  // Вопрос про домашнюю группу задаём только людям из МБВ: так требует ТЗ.
  return attendsMbv(church) ? askMdg(next, effects) : showSummary(next, effects);
}

function awaitMdg(update: IncomingUpdate, draft: Draft): FsmResult {
  const chosen = readMdgChoice(update);
  if (!chosen) return stay('await_mdg', draft, [msg(T.mdgHint, mdgKeyboard())]);

  const next: Draft = { ...draft, mdgStatus: chosen };
  const effects: Effect[] = [{ kind: 'save', patch: { mdgStatus: chosen } }];

  switch (chosen) {
    case 'open':
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
  if (location.length < 2) return stay('await_location', draft, [msg(T.askLocation, finishKeyboard())]);
  return askAge({ ...draft, location }, [{ kind: 'save', patch: { location } }]);
}

function awaitAge(raw: string, draft: Draft): FsmResult {
  const age = Number.parseInt(raw.replace(/\D/g, ''), 10);
  if (!Number.isFinite(age) || age < 5 || age > 110) {
    return stay('await_age', draft, [msg(T.ageInvalid, finishKeyboard())]);
  }

  const next: Draft = { ...draft, age };
  const effects: Effect[] = [{ kind: 'save', patch: { age } }];
  // Про компанию спрашиваем только тех, кто ищет группу.
  return next.mdgStatus === 'join' ? askCompanions(next, effects) : showSummary(next, effects);
}

function awaitCompanions(raw: string, draft: Draft): FsmResult {
  const companions = raw.trim();
  if (!companions) return showSummary(draft);
  return showSummary({ ...draft, companions }, [{ kind: 'save', patch: { companions } }]);
}

function awaitLeaderName(raw: string, draft: Draft): FsmResult {
  const leaderName = raw.trim();
  if (leaderName.length < 3) return stay('await_leader_name', draft, [msg(T.askLeaderName, finishKeyboard())]);
  return askAge({ ...draft, leaderName }, [{ kind: 'save', patch: { leaderName } }]);
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

  // Служителям нужна заявка по тем, кто ищет группу или готов её открыть.
  if (draft.mdgStatus === 'join' && !alreadyOpen('join_group')) {
    effects.push({ kind: 'create_request', type: 'join_group' });
  }
  if (draft.mdgStatus === 'open' && leadBlock === null) {
    effects.push({ kind: 'create_request', type: 'lead_group' });
  }

  // Если заявку не заводим, нельзя отвечать «мы передали»: объясняем настоящую причину.
  const done = draft.mdgStatus === 'open' && leadBlock
    ? LEAD_BLOCK_TEXT[leadBlock]
    : draft.mdgStatus
      ? MDG_DONE[draft.mdgStatus]
      : T.otherChurchDone;
  return { actions: [msg(done, menuKeyboard())], state: 'menu', draft, effects };
}

/** Что отвечаем, когда заявку на открытие группы подавать не нужно. */
const LEAD_BLOCK_TEXT: Record<NonNullable<LeadBlock>, string> = {
  pending: T.leadRequestPending,
  phone_request: T.leadPhoneHasRequest,
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
function awaitQuestion(update: IncomingUpdate, draft: Draft, participant?: Participant): FsmResult {
  const incomplete = participant ? !participant.complete : false;

  if (update.kind === 'callback' && update.data === CB.cancelQuestion) {
    return stay('menu', draft, [msg(T.questionCancelled, menuKeyboard(incomplete))]);
  }
  if (update.kind !== 'text') return ignore('await_question', draft);

  const question = update.text.trim();
  if (question.length < 5) {
    return stay('await_question', draft, [msg(T.questionTooShort, cancelQuestionKeyboard())]);
  }

  return {
    actions: [msg(T.questionAccepted, menuKeyboard(incomplete))],
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
  const incomplete = participant ? !participant.complete : false;

  switch (data) {
    case CB.menuAsk:
      if (openQuestions >= MAX_OPEN_QUESTIONS) {
        return stay('menu', draft, [msg(T.questionTooMany, menuKeyboard(incomplete))]);
      }
      return stay('await_question', draft, [
        msg(T.askQuestion, cancelQuestionKeyboard()),
      ]);

    case CB.menuStatus:
      return stay('menu', draft, [msg(statusText(participant), menuKeyboard(incomplete))]);

    case CB.menuResume:
      // Возвращаем человека на первый вопрос, на который он не ответил.
      return goToStep(nextMissingStep(draft), draft);

    case CB.menuLead:
      if (leadBlock) {
        return stay('menu', draft, [msg(LEAD_BLOCK_TEXT[leadBlock], menuKeyboard(incomplete))]);
      }
      return {
        actions: [msg(T.leadRequestAccepted, menuKeyboard(incomplete))],
        state: 'menu',
        draft,
        effects: [{ kind: 'create_request', type: 'lead_group' }],
      };

    default:
      return showMenu(draft, T.menuHint, participant);
  }
}

/** Экран «Проверить статус» из ТЗ. */
function statusText(participant?: Participant): string {
  if (!participant) return T.statusIncomplete;

  const lines: string[] = [];
  if (!participant.complete) lines.push(T.statusIncomplete, '');

  if (participant.kitIssued) {
    lines.push(T.statusKitIssued);
  } else if (participant.mdgStatus === 'open') {
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
