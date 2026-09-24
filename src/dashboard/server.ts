import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  parseCoordinatorForm, parseCoordinatorUpdate, parseGroupForm, parseGroupUpdate, parseId,
  parseRegistrationForm, parseRequestForm, parseRequestStatus, parseRequestUpdate,
} from './forms.js';
import { loginPage } from './loginPage.js';
import { registrationCardPage, type RegistrationCardInfo } from './registrationCard.js';
import { SessionService } from './sessions.js';
import { logger } from '../logger.js';

const COOKIE = 'hg_sid';
/** Путь монтирования за nginx. Внутри сервиса пути нормализуются к корню. */
const MOUNT = '/groups';

export interface DashboardData {
  groups: readonly object[];
  requests: readonly object[];
  coordinators: readonly object[];
  /** Зарегистрированные участники, готовые открыть группу или предоставить дом. */
  leaderCandidates: readonly object[];
  /** Все, кому присвоен номер регистрации: и через бота, и вручную из дашборда. */
  users: readonly object[];
  /** Показатели кампании: то, что раньше показывала команда /stats в боте. */
  campaign?: object | null;
}

const EMPTY_DATA: DashboardData = {
  groups: [], requests: [], coordinators: [], leaderCandidates: [], users: [], campaign: null,
};

export interface DashboardDeps {
  auth: SessionService;
  htmlPath: string;
  sessionTtlSeconds: number;
  secureCookie: boolean;
  /** Всё, что показывает дашборд: группы, заявки и координаторы из базы. */
  data?: () => Promise<DashboardData>;
  /** Убрать запись, заведённую здесь. false — записи нет или её уже убрали. */
  deleteGroup?: (id: number) => Promise<boolean>;
  /** Завести группу из формы. Возвращает номер новой записи. */
  createGroup?: (input: unknown) => Promise<number>;
  /** Завести заявку из формы. Возвращает номер новой записи. */
  createRequest?: (input: unknown) => Promise<number>;
  /** Исправить заявку. false — заявки нет. */
  updateRequest?: (id: number, patch: unknown) => Promise<boolean>;
  /** Убрать заявку со страницы. false — её нет или уже убрали. */
  deleteRequest?: (id: number) => Promise<boolean>;
  /** Быстрая смена статуса заявки из списка. false — заявки нет. */
  setRequestStatus?: (id: number, status: string, responsible: string | null, groupId: number | null) => Promise<boolean>;
  /** Исправить группу. false — записи нет. */
  updateGroup?: (id: number, input: unknown) => Promise<boolean>;
  /** Завести координатора из формы. Возвращает номер новой записи. */
  createCoordinator?: (input: unknown) => Promise<number>;
  /** Исправить координатора. false — записи нет. */
  updateCoordinator?: (id: number, input: unknown) => Promise<boolean>;
  /** Убрать координатора со страницы. false — его нет или уже убрали. */
  deleteCoordinator?: (id: number) => Promise<boolean>;
  /** Зарегистрировать участника из дашборда. Возвращает id новой записи. */
  createRegistration?: (input: unknown) => Promise<number>;
  /** QR для выдачи набора. null — такой регистрации нет. */
  registrationQr?: (id: number) => Promise<Buffer | null>;
  /** Данные для печатной карточки регистрации (QR и все заполненные поля разом). */
  registrationCard?: (id: number) => Promise<RegistrationCardInfo | null>;
  /** Удалить регистрацию — жёстко, без возможности восстановить. false — её нет или уже удалили. */
  deleteRegistration?: (id: number) => Promise<boolean>;
  /** Выгрузка участников кампании в CSV. */
  exportUsers?: () => Promise<string>;
}

/** Адрес клиента: за nginx настоящий адрес приходит заголовком. */
function clientIp(req: IncomingMessage): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // Форма входа крошечная: всё, что больше, это не наш запрос.
      if (data.length > limit) { req.destroy(); reject(new Error('слишком большое тело запроса')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // Страница с персональными данными: в поиск ей нельзя, во фрейм тоже.
    'x-robots-tag': 'noindex, nofollow',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/**
 * Вживляет кнопку выхода в отданный дашборд.
 *
 * Сам файл дашборда трогать нельзя: он должен оставаться самодостаточным и открываться
 * из файла, без сервера. Поэтому кнопку добавляем на отдаче. Стиль берём у штатного .chip,
 * место — в правой части шапки; если шапки нет, кнопка просто прижимается к углу.
 */
export function withLogout(html: string): string {
  const snippet = `
<form class="hg-logout" action="${MOUNT}/logout" method="post"><button class="chip" type="submit">Выйти</button></form>
<style>
  .hg-logout { position: fixed; top: 14px; right: 16px; z-index: 60; margin: 0; }
  .topbar-right .hg-logout { position: static; }
  .hg-logout button { cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 500; }
</style>
<script>
  (function () {
    var form = document.querySelector('.hg-logout');
    var slot = document.querySelector('.topbar-right');
    if (form && slot) slot.appendChild(form);
  })();
</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${snippet}\n</body>`) : html + snippet;
}

/**
 * Кладёт данные из базы в страницу отдельным блоком перед основным скриптом.
 *
 * Экранируем «<», иначе имя вида «</script>» закрыло бы тег и сломало страницу
 * (а заодно дало бы вставить произвольную разметку).
 *
 * Заодно сообщаем странице префикс монтирования. Без него запросы со страницы
 * уходят не туда: адрес «/groups» без косой черты разрешает относительный путь
 * от корня, и «leader/delete» превращается в «/leader/delete».
 */
export function withLive(html: string, data: DashboardData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const block = `<script>window.HG_LIVE = ${json}; window.HG_BASE = ${JSON.stringify(MOUNT + '/')};</script>\n`;
  const at = html.indexOf('<script>');
  return at === -1 ? block + html : html.slice(0, at) + block + html.slice(at);
}

export function createDashboardServer(deps: DashboardDeps) {
  const cookie = (sid: string, maxAge: number) =>
    `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=${MOUNT}; Max-Age=${maxAge}` +
    (deps.secureCookie ? '; Secure' : '');

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // За nginx путь приходит вместе с префиксом монтирования.
      const path = url.pathname.replace(new RegExp(`^${MOUNT}`), '') || '/';
      const sid = SessionService.readCookie(req.headers.cookie, COOKIE);

      if (path === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }

      // Фавикон: браузер запрашивает его до входа, поэтому без авторизации.
      // Лежит рядом с home-groups.html — тем же путём, каким сервис читает саму страницу.
      if (path === '/assets/computer.png') {
        try {
          const png = await readFile(join(dirname(deps.htmlPath), 'assets', 'computer.png'));
          // Без долгого кэша: файл можно заменить на сервере в любой момент (как уже
          // бывало), и браузер не должен сутками показывать старую картинку по тому же URL.
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          res.end(png);
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      // Эмблема церкви на печатной карточке регистрации (см. ниже) — в отличие от
      // фавикона нужна только там, а та страница и так за паролем, поэтому здесь
      // проверяем сессию, а не отдаём всем подряд.
      if (path === '/assets/church-logo.png') {
        if (!(await deps.auth.verify(sid))) {
          res.writeHead(401);
          res.end();
          return;
        }
        try {
          const png = await readFile(join(dirname(deps.htmlPath), 'assets', 'church-logo.png'));
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          res.end(png);
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      if (req.method === 'POST' && path === '/login') {
        const body = await readBody(req);
        const password = new URLSearchParams(body).get('password') ?? '';
        const ip = clientIp(req);
        const result = await deps.auth.login(password, ip);

        if (!result.ok) {
          logger.warn({ ip, lockedOut: result.lockedOut === true }, 'дашборд: неудачный вход');
          send(res, 401, loginPage(result.lockedOut
            ? 'Слишком много попыток. Подождите 15 минут.'
            : 'Неверный пароль.'));
          return;
        }

        logger.info({ ip }, 'дашборд: вход выполнен');
        send(res, 303, '', { location: MOUNT, 'set-cookie': cookie(result.sid!, deps.sessionTtlSeconds) });
        return;
      }

      /* Формы создания. Проверки те же, что у удаления: только POST, живая сессия,
         затем разбор. Тело крупнее — в комментарий к группе влезает много текста. */
      if (path === '/group/create' || path === '/request/create') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }

        const isGroup = path === '/group/create';
        const handler = isGroup ? deps.createGroup : deps.createRequest;
        if (!handler) {
          send(res, 404, loginPage());
          return;
        }

        // Кириллица в URL-кодировке занимает шесть байт на символ, поэтому лимит
        // щедрый: длинный комментарий к группе должен проходить целиком.
        let body: string;
        try {
          body = await readBody(req, 64 * 1024);
        } catch {
          send(res, 413, 'Слишком много текста. Сократите комментарий.');
          return;
        }
        const form = new URLSearchParams(body);
        const parsed = isGroup ? parseGroupForm(form) : parseRequestForm(form);
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const id = await handler(parsed.value);
        logger.info({ id, what: isGroup ? 'группа' : 'заявка' }, 'дашборд: запись создана');
        send(res, 200, String(id));
        return;
      }

      /* Быстрая смена статуса заявки: то, что раньше делала команда /close. */
      if (path === '/request/status') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.setRequestStatus) {
          send(res, 404, loginPage());
          return;
        }

        const parsed = parseRequestStatus(new URLSearchParams(await readBody(req)));
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const { id, status, responsible, groupId } = parsed.value;
        const changed = await deps.setRequestStatus(id, status, responsible, groupId);
        logger.info({ id, status, changed }, 'дашборд: статус заявки изменён');
        send(res, changed ? 200 : 404, changed ? 'ok' : 'Заявка не найдена');
        return;
      }

      /* Координаторы: тот же список людей, что стоит и «Координатором» у группы,
         и «Ответственным» у заявки — один человек годится на обе роли. */
      if (path === '/coordinator/create') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.createCoordinator) {
          send(res, 404, loginPage());
          return;
        }

        const parsed = parseCoordinatorForm(new URLSearchParams(await readBody(req)));
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const id = await deps.createCoordinator(parsed.value);
        logger.info({ id }, 'дашборд: участник добавлен');
        send(res, 200, String(id));
        return;
      }

      if (path === '/coordinator/update') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.updateCoordinator) {
          send(res, 404, loginPage());
          return;
        }

        const parsed = parseCoordinatorUpdate(new URLSearchParams(await readBody(req)));
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const { id, input } = parsed.value;
        const changed = await deps.updateCoordinator(id, input);
        logger.info({ id, changed }, 'дашборд: участник исправлен');
        send(res, changed ? 200 : 404, changed ? 'ok' : 'Запись не найдена или уже убрана');
        return;
      }

      if (path === '/coordinator/delete') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.deleteCoordinator) {
          send(res, 404, loginPage());
          return;
        }

        const id = parseId(new URLSearchParams(await readBody(req)), 'участника');
        if (!id.ok) {
          send(res, 400, id.error);
          return;
        }

        const removed = await deps.deleteCoordinator(id.value);
        logger.info({ id: id.value, removed }, 'дашборд: участник убран');
        send(res, removed ? 200 : 404, removed ? 'ok' : 'Запись не найдена или уже убрана');
        return;
      }

      /* Регистрация из дашборда — для тех, кто заполнил анкету на бумаге и своего
         чата с ботом не имеет. QR отдаётся тут же, отдельным маршрутом: страница
         показывает его сразу, без похода в чат бота. */
      if (path === '/registration/create') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.createRegistration) {
          send(res, 404, loginPage());
          return;
        }

        const parsed = parseRegistrationForm(new URLSearchParams(await readBody(req)));
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const id = await deps.createRegistration(parsed.value);
        logger.info({ id }, 'дашборд: участник зарегистрирован');
        send(res, 200, String(id));
        return;
      }

      if (path === '/registration/qr') {
        if (req.method !== 'GET') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.registrationQr) {
          send(res, 404, loginPage());
          return;
        }

        const idRaw = url.searchParams.get('id') ?? '';
        const id = Number(idRaw);
        if (!/^\d+$/.test(idRaw) || !Number.isSafeInteger(id) || id <= 0) {
          send(res, 400, 'Неверный номер участника.');
          return;
        }

        const png = await deps.registrationQr(id);
        if (!png) {
          send(res, 404, 'Регистрация не найдена.');
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
        return;
      }

      /*
       * Печатная карточка: QR и все заполненные данные одной страницей. Открыв
       * голый QR (маршрут выше), служитель видел только штрихкод без имени и
       * телефона — эта страница специально для того, чтобы распечатать или
       * переслать всё сразу, как в подписи к фото в Telegram.
       */
      if (path === '/registration/card') {
        if (req.method !== 'GET') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.registrationCard) {
          send(res, 404, loginPage());
          return;
        }

        const cardIdRaw = url.searchParams.get('id') ?? '';
        const cardId = Number(cardIdRaw);
        if (!/^\d+$/.test(cardIdRaw) || !Number.isSafeInteger(cardId) || cardId <= 0) {
          send(res, 400, 'Неверный номер участника.');
          return;
        }

        const info = await deps.registrationCard(cardId);
        if (!info) {
          send(res, 404, 'Регистрация не найдена.');
          return;
        }
        send(res, 200, registrationCardPage(info, `${MOUNT}/registration/qr?id=${cardId}`, `${MOUNT}/assets/church-logo.png`));
        return;
      }

      /* Удалить регистрацию (заведена по ошибке, дубль, человек попросил).
         В отличие от группы/участника/заявки ниже — удаление жёсткое, по явному
         решению церкви: запись физически стирается, а не архивируется. */
      if (path === '/registration/delete') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.deleteRegistration) {
          send(res, 404, loginPage());
          return;
        }

        const id = parseId(new URLSearchParams(await readBody(req)), 'регистрации');
        if (!id.ok) {
          send(res, 400, id.error);
          return;
        }

        const removed = await deps.deleteRegistration(id.value);
        logger.info({ id: id.value, removed }, 'дашборд: регистрация удалена');
        send(res, removed ? 200 : 404, removed ? 'ok' : 'Запись не найдена или уже удалена');
        return;
      }

      /* Правка и удаление прямо в списках. Проверки везде одни: только POST,
         живая сессия, затем разбор. Удаление мягкое — запись остаётся в базе. */
      if (path === '/group/update' || path === '/request/update') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }

        const isGroup = path === '/group/update';
        const handler = isGroup ? deps.updateGroup : deps.updateRequest;
        if (!handler) {
          send(res, 404, loginPage());
          return;
        }

        let body: string;
        try {
          body = await readBody(req, 64 * 1024);
        } catch {
          send(res, 413, 'Слишком много текста. Сократите комментарий.');
          return;
        }

        const form = new URLSearchParams(body);
        const parsed = isGroup ? parseGroupUpdate(form) : parseRequestUpdate(form);
        if (!parsed.ok) {
          send(res, 400, parsed.error);
          return;
        }

        const { id, input } = parsed.value;
        const changed = await handler(id, input);
        logger.info({ id, what: isGroup ? 'группа' : 'заявка', changed }, 'дашборд: запись исправлена');
        send(res, changed ? 200 : 404, changed ? 'ok' : 'Запись не найдена или уже убрана');
        return;
      }

      if (path === '/group/delete' || path === '/request/delete') {
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }

        const isGroup = path === '/group/delete';
        const handler = isGroup ? deps.deleteGroup : deps.deleteRequest;
        if (!handler) {
          send(res, 404, loginPage());
          return;
        }

        const id = parseId(new URLSearchParams(await readBody(req)), isGroup ? 'группы' : 'заявки');
        if (!id.ok) {
          send(res, 400, id.error);
          return;
        }

        const removed = await handler(id.value);
        logger.info({ id: id.value, what: isGroup ? 'группа' : 'заявка', removed }, 'дашборд: запись убрана');
        send(res, removed ? 200 : 404, removed ? 'ok' : 'Запись не найдена или уже убрана');
        return;
      }

      /* Выгрузка участников. GET допустим: это чтение, ничего не меняет. */
      if (path === '/export.csv') {
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.exportUsers) {
          send(res, 404, loginPage());
          return;
        }
        const csv = await deps.exportUsers();
        send(res, 200, csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="participants.csv"',
        });
        return;
      }

      /* Удаление записи, заведённой через бота.
         Только POST: по GET её могла бы стереть любая картинка на сторонней странице.
         Кука SameSite=Lax на межсайтовый POST не отправляется, поэтому отдельного
         токена здесь не нужно. Удаление мягкое — запись остаётся в базе. */
      if (path === '/leader/delete') {   // прежний адрес удаления группы: не ломаем закладки
        if (req.method !== 'POST') {
          send(res, 404, loginPage());
          return;
        }
        if (!(await deps.auth.verify(sid))) {
          send(res, 401, loginPage('Сессия истекла. Войдите заново.'));
          return;
        }
        if (!deps.deleteGroup) {
          send(res, 404, loginPage());
          return;
        }

        const raw = new URLSearchParams(await readBody(req)).get('id') ?? '';
        const id = Number(raw);
        if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(id) || id <= 0) {
          send(res, 400, 'Неверный номер записи');
          return;
        }

        const removed = await deps.deleteGroup(id);
        logger.info({ id, removed }, 'дашборд: удаление ведущего');
        send(res, removed ? 200 : 404, removed ? 'ok' : 'Запись не найдена или уже убрана');
        return;
      }

      if (req.method === 'POST' && path === '/logout') {
        await deps.auth.logout(sid);
        send(res, 303, '', { location: MOUNT, 'set-cookie': cookie('', 0) });
        return;
      }

      if (path !== '/' && path !== '') {
        send(res, 404, loginPage());
        return;
      }

      if (!(await deps.auth.verify(sid))) {
        send(res, 200, loginPage());
        return;
      }

      // Файл читаем на каждый запрос: дашборд можно обновить, не перезапуская сервис.
      const html = await readFile(deps.htmlPath, 'utf8');
      // База может быть недоступна — дашборд должен открыться и сказать об этом,
      // а не отдать пятисотую.
      let data = EMPTY_DATA;
      try {
        data = (await deps.data?.()) ?? EMPTY_DATA;
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'дашборд: не удалось прочитать данные из базы');
      }
      send(res, 200, withLive(withLogout(html), data));
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'дашборд: ошибка обработки запроса');
      if (!res.headersSent) send(res, 500, loginPage('Что-то пошло не так. Попробуйте ещё раз.'));
    }
  });
}
