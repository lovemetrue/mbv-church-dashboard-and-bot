import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { SessionService } from '../dashboard/sessions.js';
import type { AuthPort } from '../platform/auth/personalAuth.js';
import type { StaffService } from '../platform/auth/staffService.js';
import { logger } from '../logger.js';
import { ACTION_STATUS, type RequestActions } from './actions.js';
import type { Settings } from '../platform/settings/service.js';
import type { ActionError, ActionOk, MatchingRunOk, Me, Role } from './contracts.js';
import type { Views } from './api/views.js';
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

export interface HomeGroupsDeps {
  /** Вход: общие логины или личные поверх них (`PersonalAuth`); сервер не знает, какой режим включён. */
  auth: AuthPort;
  /** Личные входы: пользователи, ссылки на пароль, сброс. */
  staff: StaffService;
  /** Готовые представления (снимок с общим кэшем, см. `api/snapshot.ts`). */
  views: () => Promise<Views>;
  /** Действия координатора (утвердить, отклонить, «нужен звонок»). */
  actions: RequestActions;
  /** Подбор для новых заявок: запуск и переключатель автоматического режима. */
  matching: {
    run(actor: string): Promise<MatchingRunOk>;
    setAuto(enabled: boolean, actor: string): Promise<void>;
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

const SETTINGS_POST_PATH = /^\/api\/v1\/settings\/(prompts\/save|prompts\/activate|staff\/suggest|staff\/create|staff\/update|staff\/invite|staff\/reset|staff\/personal-mode)$/;
const MATCHING_PATH = /^\/api\/v1\/matching\/(run|auto)$/;

/** `POST /api/v1/requests/12/approve`: номер заявки — цифры, длиннее пятнадцати не бывает (Number безопасен). */
const ACTION_PATH = /^\/api\/v1\/requests\/(\d{1,15})\/(approve|reject|need-call)$/;

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

    if (!result.ok) {
      logger.warn({ ip, lockedOut: result.lockedOut === true }, 'домашние группы: неудачный вход');
      if (result.lockedOut) sendHtml(res, 429, homeGroupsLoginPage('Слишком много попыток. Подождите 15 минут.'));
      else sendHtml(res, 401, homeGroupsLoginPage('Неверный логин или пароль.'));
      return;
    }
    logger.info({ ip, role: result.role }, 'домашние группы: вход выполнен');
    redirect(res, '/', { 'set-cookie': cookie(result.sid!, deps.sessionTtlSeconds) });
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
    const outcome = action === 'approve' ? await deps.actions.approve(requestId, body, actor)
      : action === 'reject' ? await deps.actions.reject(requestId, body, actor)
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

    if (action === 'run') {
      const result = await deps.matching.run(actor);
      logger.info({ actor, ...result }, 'домашние группы: подбор по кнопке');
      sendJson(res, 200, result);
      return;
    }
    if (role !== 'super') {
      sendJson(res, 403, { error: 'forbidden', message: 'Автоматический подбор включает только полный вход.' } satisfies ActionError);
      return;
    }
    const enabled = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['enabled'] : undefined;
    if (typeof enabled !== 'boolean') {
      sendJson(res, 400, { error: 'bad_request', message: 'Нужно указать enabled: true или false.' } satisfies ActionError);
      return;
    }
    await deps.matching.setAuto(enabled, actor);
    logger.info({ actor, enabled }, 'домашние группы: автоматический подбор переключён');
    sendJson(res, 200, { ok: true } satisfies ActionOk);
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
    const handlers: Record<string, () => Promise<{ ok: true } | { ok: false; error: ActionError['error']; message: string }>> = {
      'prompts/save': () => deps.settings.savePrompt(call.body, call.actor),
      'prompts/activate': () => deps.settings.activatePrompt(call.body, call.actor),
      'staff/suggest': () => deps.staff.suggestLogin(call.body),
      'staff/create': () => deps.staff.create(call.body, call.actor),
      'staff/update': () => deps.staff.update(call.body, call.actor),
      'staff/invite': () => deps.staff.invite(call.body, call.actor),
      'staff/reset': () => deps.staff.reset(call.body, call.actor),
      'staff/personal-mode': () => deps.staff.setPersonalMode(call.body, call.actor),
    };
    const outcome = await handlers[action]!();
    if (!outcome.ok) {
      sendJson(res, ACTION_STATUS[outcome.error], { error: outcome.error, message: outcome.message } satisfies ActionError);
      return;
    }
    logger.info({ actor: call.actor, action }, 'домашние группы: изменение в настройках');
    // Ответ как есть: у создания и сброса там способ доставки ссылки, у подсказки логина — сам логин.
    sendJson(res, 200, outcome);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, sid: string | undefined): Promise<void> {
    const act = req.method === 'POST' ? ACTION_PATH.exec(path) : null;
    if (act) { await handleAction(req, res, Number(act[1]), act[2]!, sid); return; }
    const settingsPost = req.method === 'POST' ? SETTINGS_POST_PATH.exec(path) : null;
    if (settingsPost) { await handleSettingsPost(req, res, settingsPost[1]!, sid); return; }
    const match = req.method === 'POST' ? MATCHING_PATH.exec(path) : null;
    if (match) { await handleMatching(req, res, match[1]!, sid); return; }
    // Всё остальное — только чтение. Любой другой не-GET отвечает 404, как изменяющие маршруты
    // старого дашборда: так ничего не меняется «случайно» и нечем воспользоваться с чужой страницы.
    if (req.method !== 'GET') { sendJson(res, 404, { error: 'not_found' }); return; }
    if (!(await deps.auth.verify(sid))) { sendJson(res, 401, { error: 'unauthorized' }); return; }

    if (path === '/api/v1/me') {
      const role = await deps.auth.roleOf(sid);
      if (!role) { sendJson(res, 401, { error: 'unauthorized' }); return; }
      const me: Me = { role };
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

    const pick: Record<string, (v: Views) => unknown> = {
      '/api/v1/today': (v) => v.today,
      '/api/v1/requests': (v) => v.requests,
      '/api/v1/groups': (v) => v.groups,
      '/api/v1/people': (v) => v.people,
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
        if (method === 'GET') { sendHtml(res, 200, homeGroupsLoginPage(undefined, query.get('notice') ?? undefined)); return; }
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
      if (!(await deps.auth.verify(sid))) { redirect(res, '/login'); return; }
      const index = await readIfFile(resolve(deps.webDir, 'index.html'));
      if (!index) {
        sendText(res, 503, 'Интерфейс не собран.');
        return;
      }
      res.writeHead(200, {
        ...BASE_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': CSP,
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
