import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { SessionService } from '../dashboard/sessions.js';
import type { AuthPort } from '../platform/auth/personalAuth.js';
import type { StaffService } from '../platform/auth/staffService.js';
import { logger } from '../logger.js';
import { ACTION_STATUS, type RequestActions } from './actions.js';
import type { CampaignView, FormMeta } from './contracts.js';
import type { RecordCreator } from './create.js';
import type { Registrar } from './registration.js';
import type { Manager } from './manage.js';
import type { BotSettings } from './botSettings.js';
import type { Assistant } from './assistant/service.js';
import type { Chat } from './assistant/chat.js';
import type { LlmConfig } from './assistant/llmConfig.js';
import type { GeocoderConfig } from './geocoderConfig.js';
import type { MapConfig } from './mapConfig.js';
import type { AddressTableView } from './contracts.js';
import type { Members } from './members.js';
import type { Contacts } from './contacts.js';
import type { Strange } from './strange.js';
import type { Genders } from './genders.js';
import type { Kits } from './kits.js';
import type { TeamRoles } from './teamRoles.js';
import type { GroupDirections } from './groupDirections.js';
import { draftFor, groupsFor, kitPersonFor, peopleFor, requestsFor, type Viewer } from './contactsAccess.js';
import type { Reconciler } from './reconcile/service.js';
import { registrationCardPage } from '../dashboard/registrationCard.js';
import type { Settings } from '../platform/settings/service.js';
import type { ActionError, ActionOk, MatchingRunOk, Me, ResendFioOk, Role, TeamRoleKind } from './contracts.js';
import type { Views } from './api/views.js';
import type { Help } from './help.js';
import type { ChatAccess } from './assistant/chat.js';
import { forgotPage, homeGroupsLoginPage, setPasswordPage } from './loginPage.js';

/**
 * Имя куки отличается от `hg_sid` старого дашборда нарочно: у того кука с Path=/groups, у этого
 * с Path=/. Под одним именем браузер держал бы две разные сессии и путал, какую слать.
 */
const COOKIE = 'mbv_sid';

/** Тело формы входа крошечное, но лимит единый с остальными формами сервиса: кириллица в URL-кодировке — 6 байт на символ. */
const BODY_LIMIT = 64 * 1024;

/**
 * Политика безопасности интерфейса: только свои скрипты, стили и шрифты, никаких внешних источников.
 * 'unsafe-inline' разрешён лишь для стилей: интерфейс на React задаёт часть размеров атрибутом
 * style, а скрипты остаются строго своими.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Политика для самого интерфейса, когда в «Настройки → Карта» задан ключ: к своим источникам добавляются хосты Яндекс.Карт
 * (скрипт карты, плитки, шрифты). JS API 2.1 собирает часть кода на лету, поэтому ему нужен `'unsafe-eval'`; это ослабление
 * действует только на странице интерфейса и только пока ключ карты задан. Страница входа остаётся строгой.
 * Список хостов — по документации Яндекса; если карта не рисуется, смотрите нарушения политики в консоли браузера.
 */
const YANDEX_MAPS = ['https://api-maps.yandex.ru', 'https://yastatic.net', 'https://*.maps.yandex.net', 'https://yandex.ru', 'https://*.yandex.ru'];
const MAP_CSP = CSP.split('; ').map((rule) => {
  if (rule.startsWith('script-src')) return `${rule} 'unsafe-eval' ${YANDEX_MAPS.join(' ')}`;
  if (rule.startsWith('style-src')) return `${rule} https://yastatic.net`;
  if (rule.startsWith('img-src')) return `${rule} ${YANDEX_MAPS.join(' ')} blob:`;
  if (rule.startsWith('font-src')) return `${rule} https://yastatic.net`;
  if (rule.startsWith('connect-src')) return `${rule} ${YANDEX_MAPS.join(' ')}`;
  return rule;
}).join('; ');

export interface HomeGroupsDeps {
  /** Вход: общие логины или личные поверх них (`PersonalAuth`); сервер не знает, какой режим включён. */
  auth: AuthPort;
  /** Личные входы: пользователи, ссылки на пароль, сброс. */
  staff: StaffService;
  /** Готовые представления (снимок с общим кэшем, см. `api/snapshot.ts`). */
  views: () => Promise<Views>;
  /** Действия координатора (утвердить, отклонить, «нужен звонок»). */
  actions: RequestActions;
  /** Создание заявки и группы из «+ Создать». */
  creator: RecordCreator;
  /** Правка и удаление групп, координаторов, заявок. */
  manager: Manager;
  /** Состав групп вручную. */
  members: Members;
  /** Правка контактов человека из справочника (регистрация и человек из заявки). */
  contacts: Contacts;
  /** Метка «Странный человек». */
  strange: Strange;
  /** Пол человека: ручная установка и прогон моделью. Нет (в части тестов) — маршруты отвечают 404. */
  genders?: Genders;
  /** Справочник ролей команды («Настройки → Роли команды», только полный вход). */
  teamRoles: TeamRoles;
  /** Справочник направлений групп («Настройки → Направления», только полный вход). */
  groupDirections: GroupDirections;
  /** Выдача наборов участникам кампании по QR. */
  kits: Kits;
  /** Разбор «других обращений» по справочникам групп и людей. */
  reconciler: Reconciler;
  /** Помощник по разбору заявок (языковая модель). */
  assistant: Assistant;
  /** Подключение помощника: провайдер, модель, ключ (только полный вход). */
  llmConfig: LlmConfig;
  geocoderConfig: GeocoderConfig;
  /** Таблица адресов геокодера и повтор по одному адресу. */
  geocodeAddresses: { table(): Promise<AddressTableView>; retry(body: unknown): Promise<{ ok: true } | { ok: false; error: ActionError['error']; message: string }>; reject(body: unknown): Promise<{ ok: true } | { ok: false; error: ActionError['error']; message: string }> };
  /** Ключ Яндекс.Карт и счётчик открытий карты. */
  mapConfig: MapConfig;
  /** Чат помощника: вопросы по базе, только чтение. */
  chat: Chat;
  /** База знаний для «?» в шапке и для помощника. Нет — маршруты справки отвечают 404. */
  help?: Help;
  /** Настройки бота из интерфейса (только полный вход). */
  botSettings: BotSettings;
  /** Статистика кампании «40 дней»; null — расписание не задано. */
  campaign: () => Promise<CampaignView | null>;
  /** Выгрузки в CSV (с телефонами): только полный вход. */
  exporter: { requests(): Promise<string>; people(): Promise<string> };
  /** Запись в журнал вне заявки (выгрузка): без содержимого. */
  audit: (actor: string, action: string, after: unknown) => Promise<void>;
  /** Регистрация участника служителем, QR и данные печатной карточки. */
  registrar: Registrar;
  /** Эмблема церкви для печатной карточки; нет файла — null (карточка без эмблемы). */
  logo?: () => Promise<Buffer | null>;
  /** Справочники для форм создания. */
  formMeta: () => Promise<FormMeta>;
  /** Подбор для новых заявок: запуск и переключатель автоматического режима. */
  matching: {
    run(actor: string): Promise<MatchingRunOk>;
    rerunAll(actor: string): Promise<MatchingRunOk>;
    setAuto(enabled: boolean, actor: string): Promise<void>;
    setNotify(enabled: boolean, actor: string): Promise<void>;
    resendFio(actor: string): Promise<number>;
  };
  /** Раздел «Настройки»: только для полного входа. */
  settings: Settings;
  /** Записать ошибку в журнал раздела «Настройки». Не должен бросать. */
  reportError: (source: string, err: unknown, context: string) => void;
  /** Сбросить общий снимок после действия, чтобы список сразу показал результат. */
  invalidateViews: () => void;
  /** Кто записан автором в журнале: пока нет личных входов, это логин общего входа. */
  actorName: (role: Role) => string;
  sessionTtlSeconds: number;
  secureCookie: boolean;
  /** Каталог собранного интерфейса (`web-dist`). */
  webDir: string;
}

/** Типы файлов, которые отдаёт статика. Всё остальное — 404: сервер не должен угадывать тип по содержимому. */
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

class BodyTooLarge extends Error {}

const SETTINGS_POST_PATH = /^\/api\/v1\/settings\/(prompts\/save|prompts\/activate|staff\/suggest|staff\/create|staff\/update|staff\/invite|staff\/reset|staff\/personal-mode|staff\/generate-password|staff\/password|team-roles\/create|team-roles\/update|team-roles\/delete|directions\/create|directions\/update|directions\/delete|bot\/extra-questions|bot\/send-extra-questions|bot\/send-coordinator-contacts|bot\/send-leader-message|assistant\/enabled|assistant\/llm|assistant\/llm-test|geocoder|geocoder-test|geocoder-retry|geocoder-reject|map)$/;
const MAP_LOADED_PATH = '/api/v1/map/loaded';
const CREATE_PATH = /^\/api\/v1\/(requests|groups|people|coordinators)\/create$/;
/** `POST /api/v1/groups/5/update`: правка и удаление записей справочника. */
const MANAGE_PATH = /^\/api\/v1\/(groups|coordinators|people)\/(\d{1,15})\/(update|delete)$/;
/** Страница для регистрации на месте (волонтёры у стойки): открывается тем же интерфейсом, но показывает только форму. */
const REGISTRATION_PATH = '/registration';
/** Состав группы: добавить человека (`POST /groups/5/members/create`) и править или убрать строку (`POST /members/9/update`). */
const MEMBER_ADD_PATH = /^\/api\/v1\/groups\/(\d{1,15})\/members\/create$/;
const MEMBER_PATH = /^\/api\/v1\/members\/(\d{1,15})\/(update|delete)$/;
/** Новая карточка человека без группы («+ Новый человек» при выборе ведущего). Любой вход, кроме стойки регистрации. */
const PERSON_CREATE_PATH = '/api/v1/persons/create';
/** Карточка человека, внесённая вручную: правка любым входом, удаление только полным. */
const PERSON_EDIT_PATH = /^\/api\/v1\/persons\/(\d{1,15})\/(update|delete)$/;
/** Контакты человека из справочника: регистрация (u12) или человек из заявки (r345). Любой вход. */
const CONTACT_PATH = /^\/api\/v1\/people\/([ur]\d{1,15})\/update$/;
const BULK_PATH = '/api/v1/requests/bulk';
/** Выдача наборов: найти участника по номеру или ФИО, отметить выдачу, отменить ошибочную. Любой вход. */
const KITS_PATH = '/api/v1/kits';
const KIT_POST_PATH = /^\/api\/v1\/kits\/(find|search|issue|undo)$/;
const PERSON_STRANGE_PATH = '/api/v1/people/strange';
const PERSON_GENDER_PATH = '/api/v1/people/gender';
const PERSON_GENDER_AI_PATH = '/api/v1/people/gender-ai';
const RECONCILE_READY_PATH = '/api/v1/requests/reconcile-ready';
const ASSISTANT_RUN_PATH = '/api/v1/assistant/run';
const ASSISTANT_CHAT_PATH = '/api/v1/assistant/chat';
const ASSISTANT_CHAT_HISTORY_PATH = '/api/v1/assistant/chat/history';
const ASSISTANT_CHAT_CLEAR_PATH = '/api/v1/assistant/chat/clear';
const EXPORT_PATH = /^\/api\/v1\/export\/(requests|people)\.csv$/;
/** `GET /api/v1/people/12/card`: печатная карточка регистрации и её QR. */
const PERSON_PATH = /^\/api\/v1\/people\/(\d{1,15})\/(qr|card)$/;
/** `GET /api/v1/requests/12/group-draft`: поля формы «Новая группа» по заявке. Любой вход, как и создание группы. */
const GROUP_DRAFT_PATH = /^\/api\/v1\/requests\/(\d{1,15})\/group-draft$/;
/** `GET /api/v1/requests/12/fit`: уверенность по каждой группе для окна «Другая группа». Личных данных в ответе нет. */
const GROUP_FIT_PATH = /^\/api\/v1\/requests\/(\d{1,15})\/fit$/;
const LOGO_PATH = '/api/v1/assets/church-logo.png';
const MATCHING_PATH = /^\/api\/v1\/matching\/(run|auto|notify|resend-fio|rerun-all)$/;
/** База знаний: список статей, статья и картинка к ней. Открыта любому входу, в том числе стойке. */
const HELP_PATH = /^\/api\/v1\/help(?:\/([a-z]{1,20}))?$/;
const HELP_FILE_PATH = /^\/api\/v1\/help\/files\/([\w.-]{1,80}\.png)$/;

/**
 * Что открыто входу «Стойка регистрации»: ровно то, что нужно странице `/registration` — кто вошёл, справочники формы,
 * регистрация участника с её карточкой и QR, выдача наборов. Остальное (заявки, группы, справочник, создание группы,
 * «Настройки», помощник) отвечает 403: интерфейс эти разделы такому входу не показывает, а закрывает их сервер.
 */
function deskAllows(method: string, path: string): boolean {
  if (method === 'POST') return path === '/api/v1/people/create' || KIT_POST_PATH.test(path);
  if (method !== 'GET') return false;
  return path === '/api/v1/me' || path === '/api/v1/form-meta' || path === KITS_PATH || path === LOGO_PATH || PERSON_PATH.test(path)
    || HELP_PATH.test(path) || HELP_FILE_PATH.test(path);
}

/**
 * Что открыто входу «Только чтение»: любые чтения, кроме сводки «Команды», «Настроек» и истории помощника. Из POST —
 * только то, что ничего не меняет: учёт открытий карты и поиск в «Наборах» (`kits/find`, `kits/search`); выдача и
 * отмена набора, подбор, помощник, правки и создание отвечают 403. Как и у стойки, закрыто всё, что сюда не вписано.
 */
function readonlyAllows(method: string, path: string): boolean {
  if (method === 'POST') return path === MAP_LOADED_PATH || path === '/api/v1/kits/find' || path === '/api/v1/kits/search';
  if (method !== 'GET') return false;
  return !(path === '/api/v1/team' || path.startsWith('/api/v1/settings/') || path === ASSISTANT_CHAT_HISTORY_PATH);
}

/**
 * Карточку группы правит не всякий: у кого в команде только роль распределителя, тот направляет людей по заявкам, а
 * поля группы (адрес, время, ведущие, статус) меняют координаторы. Решает `team_roles.kind`, а не название роли.
 */
export function mayEditGroups(viewer: { person: { teamKinds: readonly TeamRoleKind[] } | null }): boolean {
  const kinds = viewer.person?.teamKinds ?? [];
  return !(kinds.length > 0 && kinds.every((k) => k === 'distributor'));
}

/** Адрес страницы регистрации? Слэш на конце не мешает — так же решает интерфейс (`isRegistrationPath`). */
const isRegistrationPage = (path: string): boolean => path.replace(/\/+$/, '') === REGISTRATION_PATH;

/** `POST /api/v1/requests/12/approve`: номер заявки — цифры, длиннее пятнадцати не бывает (Number безопасен). */
const ACTION_PATH = /^\/api\/v1\/requests\/(\d{1,15})\/(approve|choose|reject|need-call|params|rematch|edit|assign|call|delete|close|reopen|reconcile|strange)$/;

/** Адрес клиента: за nginx настоящий адрес приходит заголовком (как в старом дашборде). */
function clientIp(req: IncomingMessage): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { reject(new BodyTooLarge()); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Не читаем дальше: отвечаем и закрываем соединение, а не выкачиваем гигабайт впустую.
        req.removeAllListeners('data');
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Заголовки для всего, что отдаёт сервис: страницы с персональными данными не для поиска, фреймов и чужих Referer. */
const BASE_HEADERS: Record<string, string> = {
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function sendHtml(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': CSP,
    ...headers,
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    // Ответы с именами и телефонами: ни браузеру, ни промежуточному кэшу их хранить нельзя.
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, { ...BASE_HEADERS, location, 'cache-control': 'no-store', ...headers });
  res.end();
}

/**
 * Путь внутри каталога интерфейса или null, если он пытается выйти за его пределы.
 * Проверяем после декодирования: `%2e%2e` и `%2f` — тоже способ дойти до чужих файлов.
 */
function insideRoot(root: string, decodedPath: string): string | null {
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) return null;
  if (decodedPath.split('/').some((segment) => segment === '..')) return null;
  const base = resolve(root);
  const full = resolve(base, `.${decodedPath}`);
  return full.startsWith(base + sep) ? full : null;
}

async function readIfFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTDIR: путь вида «/assets/app.js/x». Для клиента это такое же «файла нет».
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return null;
    throw err;
  }
}

export function createHomeGroupsServer(deps: HomeGroupsDeps) {
  const cookie = (sid: string, maxAge: number) =>
    `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}` + (deps.secureCookie ? '; Secure' : '');

  /** Каталога интерфейса нет совсем — сервис поднят без сборки; говорим об этом прямо, а не просто «404». */
  const notBuilt = async (): Promise<boolean> => {
    try {
      return !(await stat(deps.webDir)).isDirectory();
    } catch {
      return true;
    }
  };

  async function serveStatic(
    req: IncomingMessage, res: ServerResponse, decodedPath: string, cacheControl: string,
  ): Promise<void> {
    const type = CONTENT_TYPES[extname(decodedPath).toLowerCase()];
    const full = type ? insideRoot(deps.webDir, decodedPath) : null;
    const body = full ? await readIfFile(full) : null;
    if (!type || !body) {
      if (await notBuilt()) sendText(res, 503, 'Интерфейс не собран.');
      else sendText(res, 404, 'Файл не найден.');
      return;
    }
    res.writeHead(200, { ...BASE_HEADERS, 'content-type': type, 'cache-control': cacheControl });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /** Тело формы (application/x-www-form-urlencoded) или null, если уже ответили ошибкой. */
  async function readForm(req: IncomingMessage, res: ServerResponse, onError: (message: string) => string): Promise<URLSearchParams | null> {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      sendHtml(res, 415, onError('Не удалось прочитать форму.'));
      return null;
    }
    try {
      return new URLSearchParams(await readBody(req, BODY_LIMIT));
    } catch (err) {
      if (!(err instanceof BodyTooLarge)) throw err;
      sendHtml(res, 413, onError('Слишком большой запрос.'), { connection: 'close' });
      return null;
    }
  }

  /** «Забыли пароль»: ответ всегда один и тот же, существует ли такой пользователь, не раскрывается. */
  async function handleForgot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readForm(req, res, () => forgotPage());
    if (!form) return;
    const ip = clientIp(req);
    // Не ждём отправки письма: время ответа не должно выдавать, нашёлся ли пользователь.
    void deps.staff.requestReset(form.get('identifier') ?? '', ip).catch((err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'домашние группы: сброс пароля не удался');
      deps.reportError('сброс пароля', err, 'POST /forgot');
    });
    sendHtml(res, 200, forgotPage(true));
  }

  /** Страница по ссылке из письма: задать пароль. Сессия не нужна, право даёт сама ссылка. */
  async function handleSetPassword(req: IncomingMessage, res: ServerResponse, method: string, query: URLSearchParams): Promise<void> {
    if (method === 'GET') {
      const token = query.get('token') ?? '';
      sendHtml(res, 200, setPasswordPage(token, await deps.staff.tokenInfo(token)));
      return;
    }
    const form = await readForm(req, res, (m) => setPasswordPage('', null, m));
    if (!form) return;
    const token = form.get('token') ?? '';
    const result = await deps.staff.completePassword(token, form.get('password') ?? '', form.get('password2') ?? '', clientIp(req));
    if (result.ok) { redirect(res, '/login?notice=password_set'); return; }
    // Ссылка ещё годна — показываем форму с ошибкой, иначе общую страницу «ссылка не работает».
    const info = await deps.staff.tokenInfo(token);
    sendHtml(res, result.error === 'bad_request' && info ? 400 : 410, setPasswordPage(token, info, info ? result.message : undefined));
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      sendHtml(res, 415, homeGroupsLoginPage('Не удалось прочитать форму входа.'));
      return;
    }
    let body: string;
    try {
      body = await readBody(req, BODY_LIMIT);
    } catch (err) {
      if (!(err instanceof BodyTooLarge)) throw err;
      sendHtml(res, 413, homeGroupsLoginPage('Слишком большой запрос.'), { connection: 'close' });
      return;
    }
    const form = new URLSearchParams(body);
    const ip = clientIp(req);
    const result = await deps.auth.login(form.get('password') ?? '', ip, form.get('login') ?? undefined);

    const next = form.get('next') === REGISTRATION_PATH ? REGISTRATION_PATH : undefined;
    if (!result.ok) {
      logger.warn({ ip, lockedOut: result.lockedOut === true }, 'домашние группы: неудачный вход');
      if (result.lockedOut) sendHtml(res, 429, homeGroupsLoginPage('Слишком много попыток. Подождите 15 минут.', undefined, next));
      else sendHtml(res, 401, homeGroupsLoginPage('Неверный логин или пароль.', undefined, next));
      return;
    }
    logger.info({ ip, role: result.role }, 'домашние группы: вход выполнен');
    // Вернуть можно только на страницу регистрации: произвольный адрес в `next` был бы открытым перенаправлением.
    // Стойку регистрации — всегда туда: другие разделы ей закрыты.
    redirect(res, result.role === 'registration' ? REGISTRATION_PATH : next ?? '/', { 'set-cookie': cookie(result.sid!, deps.sessionTtlSeconds) });
  }

  /**
   * Действия над заявкой. Защита от чужих страниц та же, что у старого дашборда: кука `SameSite=Lax`
   * на межсайтовый POST не уходит, а тело обязано быть JSON — форма с чужого сайта так отправить
   * не может (для этого нужен предварительный запрос, который наш сервис не разрешает).
   */
  /**
   * Общая часть изменяющих запросов: вход, JSON-тело нужного размера, автор для журнала. Отвечает
   * сам и возвращает null, если дальше идти нельзя.
   */
  async function readAuthedJson(
    req: IncomingMessage, res: ServerResponse, sid: string | undefined,
  ): Promise<{ role: Role; actor: string; body: unknown } | null> {
    const role = await deps.auth.roleOf(sid);
    if (!role || !(await deps.auth.verify(sid))) { sendJson(res, 401, { error: 'unauthorized' }); return null; }

    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'bad_request', message: 'Ожидается JSON.' } satisfies ActionError);
      return null;
    }
    let raw: string;
    try {
      raw = await readBody(req, BODY_LIMIT);
    } catch (err) {
      if (!(err instanceof BodyTooLarge)) throw err;
      res.setHeader('connection', 'close');
      sendJson(res, 413, { error: 'bad_request', message: 'Слишком большой запрос.' } satisfies ActionError);
      return null;
    }
    try {
      const identity = await deps.auth.identityOf?.(sid);
      return { role, actor: identity?.login ?? deps.actorName(role), body: JSON.parse(raw) as unknown };
    } catch {
      sendJson(res, 400, { error: 'bad_request', message: 'Не удалось прочитать запрос.' } satisfies ActionError);
      return null;
    }
  }

  /**
   * Действия над заявкой. Защита от чужих страниц та же, что у старого дашборда: кука `SameSite=Lax`
   * на межсайтовый POST не уходит, а тело обязано быть JSON — форма с чужого сайта так отправить
   * не может (для этого нужен предварительный запрос, который наш сервис не разрешает).
   */
  async function handleAction(
    req: IncomingMessage, res: ServerResponse, requestId: number, action: string, sid: string | undefined,
  ): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const { actor, body } = call;
    if (action === 'delete' && call.role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Удалять может только полный вход.' } satisfies ActionError);
      return;
    }
    if (action === 'strange') {
      const done = await deps.strange.forRequest(requestId, body, actor);
      if (!done.ok) {
        sendJson(res, ACTION_STATUS[done.error], { error: done.error, message: done.message } satisfies ActionError);
        return;
      }
      deps.invalidateViews();
      logger.info({ requestId, action, actor }, 'домашние группы: метка «странный человек» на заявке');
      sendJson(res, 200, { ok: true } satisfies ActionOk);
      return;
    }
    if (action === 'reconcile') {
      const done = await deps.reconciler.apply(requestId, body, actor);
      if (!done.ok) {
        sendJson(res, ACTION_STATUS[done.error], { error: done.error, message: done.message } satisfies ActionError);
        return;
      }
      deps.invalidateViews();
      // В журнал сервис пишет сам (вид, группа, «уже было»); здесь только след в логе процесса, без имён.
      logger.info({ requestId, action, actor, already: done.already }, 'домашние группы: обращение разобрано по справочникам');
      sendJson(res, 200, done);
      return;
    }
    const outcome = action === 'approve' ? await deps.actions.approve(requestId, body, actor)
      : action === 'choose' ? await deps.actions.choose(requestId, body, actor)
      : action === 'reject' ? await deps.actions.reject(requestId, body, actor)
      : action === 'params' ? await deps.actions.setParams(requestId, body, actor)
      : action === 'rematch' ? await deps.actions.rematch(requestId, actor)
      : action === 'edit' ? await deps.actions.edit(requestId, body, actor)
      : action === 'assign' ? await deps.actions.assign(requestId, body, actor)
      : action === 'call' ? await deps.actions.call(requestId, body, actor)
      : action === 'delete' ? await deps.manager.deleteRequest(requestId, actor)
      : action === 'close' ? await deps.actions.close(requestId, body, actor)
      : action === 'reopen' ? await deps.actions.reopen(requestId, actor)
      : await deps.actions.setNeedCall(requestId, body, actor);

    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    // Сбрасываем снимок и при успехе: действие уже в базе, а список строится из кэша.
    deps.invalidateViews();
    logger.info({ requestId, action, actor }, 'домашние группы: действие над заявкой');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /** Подбор для новых заявок: запуск может любой вход, автоматический режим переключает только полный. */
  async function handleMatching(
    req: IncomingMessage, res: ServerResponse, action: string, sid: string | undefined,
  ): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const { role, actor, body } = call;

    if (action === 'rerun-all') {
      const result = await deps.matching.rerunAll(actor);
      logger.info({ actor, ...result }, 'домашние группы: подбор пересчитан заново');
      sendJson(res, 200, result);
      return;
    }
    if (action === 'run') {
      const result = await deps.matching.run(actor);
      logger.info({ actor, ...result }, 'домашние группы: подбор по кнопке');
      sendJson(res, 200, result);
      return;
    }
    if (role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Автоматический подбор и сообщения в MAX включает только полный вход.' } satisfies ActionError);
      return;
    }
    if (action === 'resend-fio') {
      const queued = await deps.matching.resendFio(actor);
      logger.info({ actor, queued }, 'домашние группы: переотправка ведущим сообщений с ФИО');
      sendJson(res, 200, { ok: true, queued } satisfies ResendFioOk);
      return;
    }
    const enabled = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['enabled'] : undefined;
    if (typeof enabled !== 'boolean') {
      sendJson(res, 400, { error: 'bad_request', message: 'Нужно указать enabled: true или false.' } satisfies ActionError);
      return;
    }
    if (action === 'notify') {
      await deps.matching.setNotify(enabled, actor);
      logger.info({ actor, enabled }, 'домашние группы: сообщения в MAX при утверждении переключены');
      sendJson(res, 200, { ok: true } satisfies ActionOk);
      return;
    }
    await deps.matching.setAuto(enabled, actor);
    logger.info({ actor, enabled }, 'домашние группы: автоматический подбор переключён');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /** Создание записи: заявка или группа. Проверяет сервер (те же правила, что у форм старого дашборда). */
  async function handleCreate(req: IncomingMessage, res: ServerResponse, what: string, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = what === 'requests' ? await deps.creator.request(call.body, call.actor)
      : what === 'people' ? await deps.registrar.register(call.body, call.actor)
      : what === 'coordinators' ? await deps.manager.createCoordinator(call.body, call.actor)
      : await deps.creator.group(call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, what, id: outcome.id }, what === 'people' ? 'домашние группы: участник зарегистрирован' : 'домашние группы: запись создана');
    sendJson(res, 200, outcome);
  }

  /** Правка и удаление записи справочника. Удалять может только полный вход (как в старом дашборде). */
  async function handleManage(req: IncomingMessage, res: ServerResponse, what: string, id: number, action: string, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    if (action === 'delete' && call.role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Удалять может только полный вход.' } satisfies ActionError);
      return;
    }
    if (what === 'people' && action === 'update') { sendJson(res, 404, { error: 'not_found' }); return; }
    if (what === 'groups' && action === 'update') {
      const viewer = await viewerOf(sid);
      if (viewer && !mayEditGroups(viewer)) {
        sendJson(res, 403, { error: 'forbidden', message: 'Распределитель не правит карточки групп: попросите координатора группы.' } satisfies ActionError);
        return;
      }
    }
    const outcome = what === 'people'
      ? await deps.manager.deletePerson(id, call.actor)
      : what === 'groups'
      ? (action === 'update' ? await deps.manager.updateGroup(id, call.body, call.actor) : await deps.manager.deleteGroup(id, call.actor))
      : (action === 'update' ? await deps.manager.updateCoordinator(id, call.body, call.actor) : await deps.manager.deleteCoordinator(id, call.actor));
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, what, id, action }, 'домашние группы: изменение справочника');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /** Состав группы: любой вход (убрать человека из состава — обычная работа, запись только скрывается). */
  async function handleMember(req: IncomingMessage, res: ServerResponse, what: 'add' | 'update' | 'remove', id: number, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = what === 'add' ? await deps.members.add(id, call.body, call.actor)
      : what === 'update' ? await deps.members.update(id, call.body, call.actor)
      : await deps.members.remove(id, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, what, id }, 'домашние группы: изменение состава группы');
    sendJson(res, 200, outcome);
  }

  /** Карточка человека, внесённая вручную. Удалять может только полный вход, как и остальные справочники. */
  async function handlePersonCard(req: IncomingMessage, res: ServerResponse, id: number, action: string, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    if (action === 'delete' && call.role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Удалять может только полный вход.' } satisfies ActionError);
      return;
    }
    const outcome = action === 'update' ? await deps.members.updatePerson(id, call.body, call.actor) : await deps.members.deletePerson(id, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, id, action }, 'домашние группы: изменение карточки человека');
    sendJson(res, 200, outcome);
  }

  async function handlePersonCreate(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = await deps.members.createPerson(call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, key: outcome.personKey }, 'домашние группы: новая карточка человека');
    sendJson(res, 200, outcome);
  }

  async function handleContact(req: IncomingMessage, res: ServerResponse, key: string, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = await deps.contacts.update(key, call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    // Данные человека лежат и в регистрации, и в заявках, и от адреса зависит подбор: пересчитываются все снимки.
    deps.invalidateViews();
    logger.info({ actor: call.actor, key }, 'домашние группы: правка данных человека');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /** Чат помощника. Тела вопросов и ответов в журнал не пишутся: в них имена и данные людей. */
  async function handleAssistantChat(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    // Права спрашивающего — для вопросов техподдержки («почему не вижу…»): помощник сверяет их с базой знаний и записью.
    const role = await deps.auth.roleOf(sid);
    const identity = await deps.auth.identityOf?.(sid);
    const person = identity ? await deps.staff.personOf(identity.login) : null;
    const access: ChatAccess | undefined = role ? {
      role,
      login: identity?.login ?? null,
      name: identity ? (person?.name ?? identity.login) : null,
      teamRole: person?.teamRole ?? null,
      teamKinds: person?.teamKinds ?? [],
    } : undefined;
    const outcome = await deps.chat.ask(call.body, call.actor, access);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    logger.info({ actor: call.actor, queries: outcome.queries.length }, 'домашние группы: вопрос помощнику');
    sendJson(res, 200, outcome);
  }

  /** Очистка истории чата: стирается только разговор того, кто вошёл, чужой не тронуть. */
  async function handleAssistantChatClear(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    sendJson(res, 200, await deps.chat.clear(call.actor));
  }

  /** Разбор непонятных заявок помощником. Доступен обоим входам, пока помощник подключён и включён. */
  async function handleAssistantRun(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = await deps.assistant.run(call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, asked: outcome.asked, filled: outcome.filled, proposals: outcome.proposals }, 'домашние группы: помощник разобрал заявки');
    sendJson(res, 200, outcome);
  }

  /** Сразу несколько заявок: передать координатору или поставить отметку «нужен звонок». */
  async function handleBulk(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = await deps.actions.bulk(call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, done: outcome.done, skipped: outcome.skipped }, 'домашние группы: массовое действие над заявками');
    sendJson(res, 200, outcome);
  }

  /** Метка «Странный человек» по ключу человека из справочника. Доступна любому входу: ставит координатор или распределитель. */
  async function handlePersonGender(req: IncomingMessage, res: ServerResponse, sid: string | undefined, genders: Genders): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const done = await genders.set(call.body, call.actor);
    if (!done.ok) {
      sendJson(res, ACTION_STATUS[done.error], { error: done.error, message: done.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor }, 'домашние группы: пол человека');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /** Прогон моделью: наружу уходят отдельные слова из ФИО, поэтому только полный вход, как и подключение помощника. */
  async function handleGenderAi(req: IncomingMessage, res: ServerResponse, sid: string | undefined, genders: Genders): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    if ((await deps.auth.roleOf(sid)) !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Разбор пола моделью доступен полному входу.' } satisfies ActionError);
      return;
    }
    const outcome = await genders.fillWithAi();
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, filled: outcome.filled, left: outcome.left }, 'домашние группы: пол подсказан моделью');
    sendJson(res, 200, outcome);
  }

  async function handlePersonStrange(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const done = await deps.strange.forPerson(call.body, call.actor);
    if (!done.ok) {
      sendJson(res, ACTION_STATUS[done.error], { error: done.error, message: done.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor }, 'домашние группы: метка «странный человек» у человека');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
  }

  /**
   * Наборы. Отмена доступна любому входу, как и выдача: ошибку у стола исправляет тот, кто её сделал, а полного
   * входа рядом может не быть. Удалением отмена не считается — регистрация остаётся, снимается только отметка.
   */
  /** Кто смотрит — для скрытия контактов (contactsAccess.ts). null — сессии нет. */
  async function viewerOf(sid: string | undefined): Promise<Viewer | null> {
    const role = await deps.auth.roleOf(sid);
    if (!role) return null;
    const identity = await deps.auth.identityOf?.(sid);
    // Личный вход, не найденный в «Пользователях», — не общий вход: лишнего ему не показываем.
    const person = identity ? ((await deps.staff.personOf(identity.login)) ?? { name: identity.login, teamKinds: [] }) : null;
    return { role, person };
  }

  async function handleKit(req: IncomingMessage, res: ServerResponse, action: string, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = action === 'find' ? await deps.kits.find(call.body)
      : action === 'search' ? await deps.kits.search(call.body)
      : action === 'issue' ? await deps.kits.issue(call.body, call.actor)
      : await deps.kits.undo(call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    // Поиск ничего не меняет; после выдачи справочник людей должен сразу показать отметку.
    if ('changed' in outcome && 'person' in outcome && outcome.changed) {
      deps.invalidateViews();
      logger.info({ actor: call.actor, action, userId: outcome.person.userId }, 'домашние группы: выдача набора');
    }
    const viewer = 'person' in outcome ? await viewerOf(sid) : null;
    sendJson(res, 200, viewer && 'person' in outcome ? { ...outcome, person: kitPersonFor(outcome.person, viewer) } : outcome);
  }

  /** Разобрать сразу все обращения, у которых сервер находит ровно одну группу точно. */
  async function handleReconcileReady(req: IncomingMessage, res: ServerResponse, sid: string | undefined): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    const outcome = await deps.reconciler.applyReady(call.body, call.actor);
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    deps.invalidateViews();
    logger.info({ actor: call.actor, applied: outcome.applied, skipped: outcome.skipped }, 'домашние группы: обращения разобраны разом');
    sendJson(res, 200, outcome);
  }

  /** Выгрузка с телефонами: только полный вход, и каждая выгрузка остаётся в журнале. */
  async function handleExport(res: ServerResponse, what: string, sid: string | undefined): Promise<void> {
    const role = await deps.auth.roleOf(sid);
    if (role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Выгрузка доступна только полному входу.' } satisfies ActionError);
      return;
    }
    const identity = await deps.auth.identityOf?.(sid);
    const actor = identity?.login ?? deps.actorName(role);
    const csv = what === 'requests' ? await deps.exporter.requests() : await deps.exporter.people();
    await deps.audit(actor, 'export.csv', { what });
    logger.info({ actor, what }, 'домашние группы: выгрузка в CSV');
    res.writeHead(200, {
      ...BASE_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${what}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    });
    res.end(csv);
  }

  /** QR и печатная карточка регистрации: за сессией (проверена выше), с именем и телефоном — кэшировать нельзя. */
  async function handlePerson(res: ServerResponse, id: number, what: string): Promise<void> {
    if (what === 'qr') {
      const png = await deps.registrar.qr(id);
      if (!png) { sendJson(res, 404, { error: 'not_found' }); return; }
      res.writeHead(200, { ...BASE_HEADERS, 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
      return;
    }
    const info = await deps.registrar.card(id);
    if (!info) { sendText(res, 404, 'Регистрация не найдена.'); return; }
    sendHtml(res, 200, registrationCardPage(info, `/api/v1/people/${id}/qr`, LOGO_PATH));
  }

  /** Правка инструкций агентов: только полный вход, как и весь раздел «Настройки». */
  async function handleSettingsPost(
    req: IncomingMessage, res: ServerResponse, action: string, sid: string | undefined,
  ): Promise<void> {
    const call = await readAuthedJson(req, res, sid);
    if (!call) return;
    if (call.role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Раздел «Настройки» доступен только полному входу.' } satisfies ActionError);
      return;
    }
    if (action === 'assistant/llm-test') {
      // Отказ провайдера — обычный результат проверки, а не ошибка запроса: отвечаем 200 и показываем причину словами.
      const result = await deps.llmConfig.test(call.body);
      logger.info({ actor: call.actor, ok: result.ok, ...(result.ok ? {} : { code: result.code, status: result.status }) }, 'домашние группы: проверка подключения помощника');
      sendJson(res, 200, result);
      return;
    }
    if (action === 'geocoder-test') {
      const result = await deps.geocoderConfig.test(call.body);
      logger.info({ actor: call.actor, ok: result.ok }, 'домашние группы: проверка ключа геокодера');
      sendJson(res, 200, result);
      return;
    }
    const handlers: Record<string, () => Promise<{ ok: true } | { ok: false; error: ActionError['error']; message: string }>> = {
      'geocoder': () => deps.geocoderConfig.save(call.body, call.actor),
      'geocoder-retry': () => deps.geocodeAddresses.retry(call.body),
      'geocoder-reject': () => deps.geocodeAddresses.reject(call.body),
      'map': () => deps.mapConfig.save(call.body, call.actor),
      'prompts/save': () => deps.settings.savePrompt(call.body, call.actor),
      'prompts/activate': () => deps.settings.activatePrompt(call.body, call.actor),
      'staff/suggest': () => deps.staff.suggestLogin(call.body),
      'staff/create': () => deps.staff.create(call.body, call.actor),
      'staff/update': () => deps.staff.update(call.body, call.actor),
      'staff/invite': () => deps.staff.invite(call.body, call.actor),
      'staff/reset': () => deps.staff.reset(call.body, call.actor),
      'staff/personal-mode': () => deps.staff.setPersonalMode(call.body, call.actor),
      'staff/generate-password': () => deps.staff.generatePassword(call.body, call.actor),
      'staff/password': () => deps.staff.revealPassword(call.body, call.actor),
      'team-roles/create': () => deps.teamRoles.create(call.body, call.actor),
      'team-roles/update': () => deps.teamRoles.update(call.body, call.actor),
      'team-roles/delete': () => deps.teamRoles.delete(call.body, call.actor),
      'directions/create': () => deps.groupDirections.create(call.body, call.actor),
      'directions/update': () => deps.groupDirections.update(call.body, call.actor),
      'directions/delete': () => deps.groupDirections.delete(call.body, call.actor),
      'bot/extra-questions': () => deps.botSettings.setExtraQuestions(call.body, call.actor),
      'bot/send-extra-questions': () => deps.botSettings.sendExtraInvites(call.body, call.actor),
      'bot/send-coordinator-contacts': () => deps.botSettings.sendCoordinatorContacts(call.body, call.actor),
      'bot/send-leader-message': () => deps.botSettings.sendLeaderMessage(call.body, call.actor),
      'assistant/llm': () => deps.llmConfig.save(call.body, call.actor),
      'assistant/enabled': async () => {
        const b = call.body as { enabled?: unknown } | null;
        if (typeof b !== 'object' || b === null || typeof b.enabled !== 'boolean') {
          return { ok: false as const, error: 'bad_request' as const, message: 'Нужно указать: включить или выключить.' };
        }
        await deps.assistant.setEnabled(b.enabled, call.actor);
        return { ok: true as const };
      },
    };
    const outcome = await handlers[action]!();
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    // Название роли видно в справочнике команды и в «Сводке», направление — у групп: снимок с прежним названием сбрасываем.
    if (action.startsWith('team-roles/') || action.startsWith('directions/')) deps.invalidateViews();
    logger.info({ actor: call.actor, action }, 'домашние группы: изменение в настройках');
    // Ответ как есть: у создания и сброса там способ доставки ссылки, у подсказки логина — сам логин.
    sendJson(res, 200, outcome);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, sid: string | undefined): Promise<void> {
    // Стойка регистрации закрыта одним местом, до разбора маршрутов: новый маршрут ей недоступен, пока его не впишут
    // в `deskAllows`, — а не открыт, пока о ней не вспомнят.
    if ((await deps.auth.roleOf(sid)) === 'registration' && !deskAllows(req.method ?? 'GET', path)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Стойке регистрации доступны только регистрация участника и выдача наборов.' } satisfies ActionError);
      return;
    }
    if ((await deps.auth.roleOf(sid)) === 'readonly' && !readonlyAllows(req.method ?? 'GET', path)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Вход «Только чтение» ничего не меняет и не видит «Настроек» и сводки «Команды».' } satisfies ActionError);
      return;
    }
    const act = req.method === 'POST' ? ACTION_PATH.exec(path) : null;
    if (act) { await handleAction(req, res, Number(act[1]), act[2]!, sid); return; }
    const settingsPost = req.method === 'POST' ? SETTINGS_POST_PATH.exec(path) : null;
    if (settingsPost) { await handleSettingsPost(req, res, settingsPost[1]!, sid); return; }
    const create = req.method === 'POST' ? CREATE_PATH.exec(path) : null;
    if (create) { await handleCreate(req, res, create[1]!, sid); return; }
    const memberAdd = req.method === 'POST' ? MEMBER_ADD_PATH.exec(path) : null;
    if (memberAdd) { await handleMember(req, res, 'add', Number(memberAdd[1]), sid); return; }
    const memberEdit = req.method === 'POST' ? MEMBER_PATH.exec(path) : null;
    if (memberEdit) { await handleMember(req, res, memberEdit[2] === 'update' ? 'update' : 'remove', Number(memberEdit[1]), sid); return; }
    if (req.method === 'POST' && path === PERSON_CREATE_PATH) { await handlePersonCreate(req, res, sid); return; }
    const personEdit = req.method === 'POST' ? PERSON_EDIT_PATH.exec(path) : null;
    if (personEdit) { await handlePersonCard(req, res, Number(personEdit[1]), personEdit[2]!, sid); return; }
    const contact = req.method === 'POST' ? CONTACT_PATH.exec(path) : null;
    if (contact) { await handleContact(req, res, contact[1]!, sid); return; }
    if (req.method === 'POST' && path === MAP_LOADED_PATH) {
      // Открытие карты считает любой вход: карта нужна и координаторам, а расход общий.
      const call = await readAuthedJson(req, res, sid);
      if (call) sendJson(res, 200, await deps.mapConfig.recordLoad());
      return;
    }
    const kit = req.method === 'POST' ? KIT_POST_PATH.exec(path) : null;
    if (kit) { await handleKit(req, res, kit[1]!, sid); return; }
    if (req.method === 'POST' && path === BULK_PATH) { await handleBulk(req, res, sid); return; }
    if (req.method === 'POST' && path === PERSON_STRANGE_PATH) { await handlePersonStrange(req, res, sid); return; }
    if (req.method === 'POST' && path === PERSON_GENDER_PATH && deps.genders) { await handlePersonGender(req, res, sid, deps.genders); return; }
    if (req.method === 'POST' && path === PERSON_GENDER_AI_PATH && deps.genders) { await handleGenderAi(req, res, sid, deps.genders); return; }
    if (req.method === 'POST' && path === RECONCILE_READY_PATH) { await handleReconcileReady(req, res, sid); return; }
    if (req.method === 'POST' && path === ASSISTANT_CHAT_PATH) { await handleAssistantChat(req, res, sid); return; }
    if (req.method === 'POST' && path === ASSISTANT_CHAT_CLEAR_PATH) { await handleAssistantChatClear(req, res, sid); return; }
    if (req.method === 'POST' && path === ASSISTANT_RUN_PATH) { await handleAssistantRun(req, res, sid); return; }
    const manage = req.method === 'POST' ? MANAGE_PATH.exec(path) : null;
    if (manage) { await handleManage(req, res, manage[1]!, Number(manage[2]), manage[3]!, sid); return; }
    const match = req.method === 'POST' ? MATCHING_PATH.exec(path) : null;
    if (match) { await handleMatching(req, res, match[1]!, sid); return; }
    // Всё остальное — только чтение. Любой другой не-GET отвечает 404, как изменяющие маршруты
    // старого дашборда: так ничего не меняется «случайно» и нечем воспользоваться с чужой страницы.
    if (req.method !== 'GET') { sendJson(res, 404, { error: 'not_found' }); return; }
    if (!(await deps.auth.verify(sid))) { sendJson(res, 401, { error: 'unauthorized' }); return; }

    if (path === '/api/v1/me') {
      const role = await deps.auth.roleOf(sid);
      if (!role) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      const identity = await deps.auth.identityOf?.(sid);
      const person = identity ? await deps.staff.personOf(identity.login) : null;
      const me: Me = { role, assistant: await deps.assistant.status(), ...(person ? { person } : {}) };
      sendJson(res, 200, me);
      return;
    }

    // «Настройки»: чтение только для полного входа. Считается на каждый запрос, без общего снимка:
    // состояние сервера должно быть свежим, а журналы читают редко.
    const settingsRead: Record<string, () => Promise<unknown>> = {
      '/api/v1/settings/health': () => deps.settings.health(),
      '/api/v1/settings/errors': () => deps.settings.errors(),
      '/api/v1/settings/audit': () => deps.settings.audit(),
      '/api/v1/settings/prompts': () => deps.settings.prompts(),
      '/api/v1/settings/staff': () => deps.staff.view(),
      '/api/v1/settings/bot': () => deps.botSettings.view(),
      '/api/v1/settings/geocoder': () => deps.geocoderConfig.view(),
      '/api/v1/settings/geocoder/addresses': () => deps.geocodeAddresses.table(),
      '/api/v1/settings/map': () => deps.mapConfig.view(),
      '/api/v1/settings/team-roles': () => deps.teamRoles.view(),
      '/api/v1/settings/directions': () => deps.groupDirections.view(),
      '/api/v1/settings/assistant': async () => ({ ...(await deps.assistant.view()), llm: await deps.llmConfig.view() }),
    };
    const settingsRoute = Object.hasOwn(settingsRead, path) ? settingsRead[path] : undefined;
    if (settingsRoute) {
      if ((await deps.auth.roleOf(sid)) !== 'super') {
        sendJson(res, 403, { error: 'forbidden', message: 'Раздел «Настройки» доступен только полному входу.' } satisfies ActionError);
        return;
      }
      sendJson(res, 200, await settingsRoute());
      return;
    }

    if (path === ASSISTANT_CHAT_HISTORY_PATH) {
      const role = await deps.auth.roleOf(sid);
      if (!role) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      const identity = await deps.auth.identityOf?.(sid);
      // В истории настоящие имена людей; sendJson отдаёт её с no-store, так что в кэше браузера она не залежится.
      sendJson(res, 200, await deps.chat.history(identity?.login ?? deps.actorName(role)));
      return;
    }

    const exp = EXPORT_PATH.exec(path);
    if (exp) { await handleExport(res, exp[1]!, sid); return; }
    const draft = GROUP_DRAFT_PATH.exec(path);
    if (draft) {
      const views = await deps.views();
      const found = views.groupDrafts?.get(Number(draft[1]));
      if (!found) { sendJson(res, 404, { error: 'not_found', message: 'Заявка не найдена.' }); return; }
      const viewer = await viewerOf(sid);
      if (!viewer) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      sendJson(res, 200, draftFor(found, viewer, views.requests));
      return;
    }
    const fit = GROUP_FIT_PATH.exec(path);
    if (fit) {
      const found = (await deps.views()).groupFit?.(Number(fit[1]));
      if (!found) { sendJson(res, 404, { error: 'not_found', message: 'Заявка не найдена.' }); return; }
      sendJson(res, 200, found);
      return;
    }
    const person = PERSON_PATH.exec(path);
    if (person) { await handlePerson(res, Number(person[1]), person[2]!); return; }
    if (path === LOGO_PATH) {
      const png = deps.logo ? await deps.logo() : null;
      if (!png) { sendJson(res, 404, { error: 'not_found' }); return; }
      res.writeHead(200, { ...BASE_HEADERS, 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
      return;
    }
    if (path === '/api/v1/campaign') {
      const view = await deps.campaign();
      if (!view) { sendJson(res, 404, { error: 'not_found' }); return; }
      sendJson(res, 200, view);
      return;
    }
    if (path === KITS_PATH) { sendJson(res, 200, await deps.kits.view()); return; }
    const helpFile = HELP_FILE_PATH.exec(path);
    if (helpFile) {
      const png = deps.help ? await deps.help.image(helpFile[1]!) : null;
      if (!png) { sendJson(res, 404, { error: 'not_found' }); return; }
      res.writeHead(200, { ...BASE_HEADERS, 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
      return;
    }
    const help = HELP_PATH.exec(path);
    if (help) {
      const found = !deps.help ? null : help[1] ? await deps.help.article(help[1]) : await deps.help.index();
      if (!found) { sendJson(res, 404, { error: 'not_found' }); return; }
      sendJson(res, 200, found);
      return;
    }
    if (path === '/api/v1/map/config') { sendJson(res, 200, await deps.mapConfig.bootstrap()); return; }
    if (path === '/api/v1/form-meta') {
      const viewer = await viewerOf(sid);
      if (!viewer) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      sendJson(res, 200, await deps.formMeta());
      return;
    }

    // Контакты зависят от того, кто смотрит (contactsAccess.ts), а снимок один на всех: скрываем на выходе.
    const personal: Record<string, (v: Views, viewer: Viewer) => unknown> = {
      '/api/v1/requests': (v, viewer) => requestsFor(v.requests, viewer),
      '/api/v1/groups': (v, viewer) => groupsFor(v.groups, viewer, v.requests),
      '/api/v1/people': (v, viewer) => peopleFor(v.people, viewer, v.groups, v.requests),
    };
    const personalRoute = Object.hasOwn(personal, path) ? personal[path] : undefined;
    if (personalRoute) {
      const viewer = await viewerOf(sid);
      if (!viewer) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      sendJson(res, 200, personalRoute(await deps.views(), viewer));
      return;
    }

    const pick: Record<string, (v: Views) => unknown> = {
      '/api/v1/team': (v) => v.team,
      '/api/v1/today': (v) => v.today,
      '/api/v1/coordinators': (v) => v.coordinators,
    };
    const select = Object.hasOwn(pick, path) ? pick[path] : undefined;
    if (!select) { sendJson(res, 404, { error: 'not_found' }); return; }
    sendJson(res, 200, select(await deps.views()));
  }

  return createServer(async (req, res) => {
    let isApi = false;
    try {
      const raw = req.url ?? '/';
      const q = raw.indexOf('?');
      const rawPath = q === -1 ? raw : raw.slice(0, q);
      // Разбираем путь сами, а не через URL: «//хост/путь» URL принял бы за адрес другого сервера.
      let path: string;
      try {
        path = decodeURIComponent(rawPath);
      } catch {
        sendText(res, 400, 'Некорректный адрес.');
        return;
      }
      if (!path.startsWith('/')) { sendText(res, 404, 'Не найдено.'); return; }

      const method = req.method ?? 'GET';
      const sid = SessionService.readCookie(req.headers.cookie, COOKIE);
      isApi = path === '/api' || path.startsWith('/api/');

      if (path === '/health') {
        if (method !== 'GET' && method !== 'HEAD') { sendText(res, 404, 'Не найдено.'); return; }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }

      const query = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));

      if (path === '/forgot') {
        if (method === 'GET') { sendHtml(res, 200, forgotPage()); return; }
        if (method === 'POST') { await handleForgot(req, res); return; }
        sendText(res, 404, 'Не найдено.');
        return;
      }

      if (path === '/set-password') {
        if (method === 'GET' || method === 'POST') { await handleSetPassword(req, res, method, query); return; }
        sendText(res, 404, 'Не найдено.');
        return;
      }

      if (path === '/login') {
        if (method === 'GET') { sendHtml(res, 200, homeGroupsLoginPage(undefined, query.get('notice') ?? undefined, query.get('next') === REGISTRATION_PATH ? REGISTRATION_PATH : undefined)); return; }
        if (method === 'POST') { await handleLogin(req, res); return; }
        sendText(res, 404, 'Не найдено.');
        return;
      }

      // Выход только POST: по GET его мог бы вызвать любой тег-картинка на чужой странице.
      if (path === '/logout') {
        if (method !== 'POST') { sendText(res, 404, 'Не найдено.'); return; }
        await deps.auth.logout(sid);
        redirect(res, '/login', { 'set-cookie': cookie('', 0) });
        return;
      }

      if (isApi) { await handleApi(req, res, path, sid); return; }

      if (method !== 'GET' && method !== 'HEAD') { sendText(res, 404, 'Не найдено.'); return; }

      // Собранные файлы с хешем в имени: данных в них нет, а менять их под тем же именем нельзя —
      // поэтому без сессии и на год.
      if (path.startsWith('/assets/')) {
        await serveStatic(req, res, path, 'public, max-age=31536000, immutable');
        return;
      }
      // Остальные файлы с расширением (значок сайта и подобное) — тоже без данных, но имя не хешируется.
      if (extname(path) !== '') {
        await serveStatic(req, res, path, 'public, max-age=3600');
        return;
      }

      // Адрес страницы интерфейса (маршруты рисует сам интерфейс): отдаём index.html, но только своим.
      if (!(await deps.auth.verify(sid))) { redirect(res, path === REGISTRATION_PATH ? `/login?next=${REGISTRATION_PATH}` : '/login'); return; }
      if (!isRegistrationPage(path) && (await deps.auth.roleOf(sid)) === 'registration') { redirect(res, REGISTRATION_PATH); return; }
      const index = await readIfFile(resolve(deps.webDir, 'index.html'));
      if (!index) {
        sendText(res, 503, 'Интерфейс не собран.');
        return;
      }
      res.writeHead(200, {
        ...BASE_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': (await deps.mapConfig.bootstrap()).apiKey ? MAP_CSP : CSP,
      });
      res.end(method === 'HEAD' ? undefined : index);
    } catch (err) {
      // Внутренности клиенту не показываем, в журнале они нужны.
      logger.error({ err: (err as Error).message }, 'домашние группы: ошибка обработки запроса');
      deps.reportError('домашние группы', err, `${req.method ?? 'GET'} ${(req.url ?? '').split('?')[0]}`);
      if (res.headersSent) return;
      if (isApi) sendJson(res, 500, { error: 'internal' });
      else sendText(res, 500, 'Что-то пошло не так. Попробуйте ещё раз.');
    }
  });
}
