import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { RequestsRepo, type RequestWithUser } from '../db/repos/requests.repo.js';
import { UsersRepo, type ManualRegistrationInput } from '../db/repos/users.repo.js';
import { usersToCsv } from '../core/csv.js';
import { allChurchOptions } from '../core/churches.js';
import { mdgRequestType } from '../core/fsm.js';
import { splitAdminIds } from '../admin/access.js';
import { AdminNotifier } from '../admin/notify.js';
import { TelegramAdapter } from '../adapters/telegram.adapter.js';
import { MaxAdapter } from '../adapters/max.adapter.js';
import type { Platform, PlatformName } from '../core/platform.js';
import { campaignStats } from './campaignStats.js';
import { CampaignRepo } from '../db/repos/campaign.repo.js';
import { DeliveriesRepo } from '../db/repos/deliveries.repo.js';
import { createPool } from '../db/pool.js';
import { qrPng } from '../core/qr.js';
import { RedisSessionStore } from './redisStore.js';
import { createDashboardServer } from './server.js';
import { SessionService } from './sessions.js';
import { createDeps } from '../deps.js';
import { logger } from '../logger.js';

const env = (name: string, fallback?: string): string => {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Не задана переменная окружения ${name}`);
};

async function main(): Promise<void> {
  const password = env('DASHBOARD_PASSWORD');
  if (password.length < 8) throw new Error('DASHBOARD_PASSWORD короче восьми символов');

  const port = Number(env('DASHBOARD_PORT', '8090'));
  const ttlDays = Number(env('DASHBOARD_SESSION_DAYS', '7'));
  const ttlSeconds = Math.round(ttlDays * 86400);

  // Свой Valkey (сервис valkey в docker-compose.yml), ни с кем не общий.
  const store = new RedisSessionStore(env('REDIS_URL', 'redis://valkey:6379/0'));
  await store.connect();

  // Ведущие, заведённые служителями через бота. Дашборд читает их напрямую из базы,
  // поэтому запись появляется на странице сразу, без пересборки образа.
  const db = createPool(env('DATABASE_URL'));
  const groups = new GroupsRepo(db);
  const requests = new RequestsRepo(db);
  const coordinators = new CoordinatorsRepo(db);
  const users = new UsersRepo(db);
  const campaign = new CampaignRepo(db);
  const deliveries = new DeliveriesRepo(db);

  // Расписание кампании читается из тех же переменных, что у бота: иначе номер дня
  // в дашборде и в боте разошёлся бы.
  const schedule = {
    startDate: env('CAMPAIGN_START_DATE', '2026-11-01'),
    broadcastTime: env('BROADCAST_TIME', '07:00'),
    totalDays: Number(env('CAMPAIGN_DAYS', '40')),
    timezone: env('TIMEZONE', 'Europe/Moscow'),
  };

  /*
   * Уведомление служителю о заявке — то же самое, что бот шлёт при заявке из чата
   * (AdminNotifier), только вызывается здесь, при заведении заявки из дашборда
   * (вручную через «Заявку» или через ответ про малую группу при регистрации).
   * Дашборд и бот — один образ с общим .env (см. docker-compose.yml), поэтому
   * токены и ADMIN_IDS те же самые; polling (bot.start()) при этом не запускаем —
   * дашборд заявки не принимает и не должен опрашивать платформы за ботом.
   */
  const platforms = new Map<PlatformName, Platform>();
  const admins = new Map<PlatformName, string[]>();
  for (const name of env('ENABLED_PLATFORMS', 'telegram').split(',').map((s) => s.trim().toLowerCase())) {
    if (name !== 'telegram' && name !== 'max') continue;
    const token = env(name === 'telegram' ? 'BOT_TOKEN_TELEGRAM' : 'BOT_TOKEN_MAX', '');
    // Токен бот уже проверил на своём старте — если его нет, молча не уведомляем
    // этой платформой, а не роняем из-за этого весь дашборд.
    if (!token) continue;
    platforms.set(
      name,
      name === 'telegram' ? new TelegramAdapter(token) : new MaxAdapter(token, logger, env('MAX_API_URL', 'https://platform-api.max.ru')),
    );
    admins.set(name, splitAdminIds(env(name === 'telegram' ? 'ADMIN_IDS_TELEGRAM' : 'ADMIN_IDS_MAX', '').split(',')).ids);
  }
  const notifier = new AdminNotifier(createDeps({
    db, platforms, admins, schedule, broadcastRate: 20,
    dashboardUrl: env('DASHBOARD_URL', 'http://5.23.48.25:8090/groups'),
  }));

  /** Уведомление не должно ронять сохранение заявки — участнику важнее, чем служителю. */
  const notifySafely = async (request: RequestWithUser): Promise<void> => {
    try {
      await notifier.notifyRequest(request);
    } catch (err) {
      logger.error({ err: (err as Error).message, requestId: request.id }, 'дашборд: не удалось уведомить служителя о заявке');
    }
  };

  const auth = new SessionService(store, { password, ttlSeconds, maxAttempts: 5 });
  const server = createDashboardServer({
    auth,
    htmlPath: env('DASHBOARD_HTML', '/app/dashboard/home-groups.html'),
    sessionTtlSeconds: ttlSeconds,
    secureCookie: env('DASHBOARD_COOKIE_SECURE', 'true') !== 'false',
    // Три набора одним запросом к странице: иначе она делала бы три обращения
    // и часть блоков рисовалась бы раньше остальных.
    data: async () => ({
      groups: await groups.forDashboard(),
      requests: await requests.forDashboard(),
      coordinators: await coordinators.listActive(),
      leaderCandidates: await users.leaderCandidates(),
      users: await users.listRegistered(),
      campaign: await campaignStats({ users, requests, campaign, deliveries }, schedule),
      churchOptions: allChurchOptions(),
    }),
    deleteGroup: async (id) => (await groups.archive(id)) !== null,
    // Что заведено в дашборде, помечается source='ui': видно, откуда взялась запись,
    // и импорт выгрузки такие строки не затирает.
    createGroup: async (input) => (await groups.create(input as never, 'ui')).id,
    createRequest: async (input) => {
      const id = await requests.createFromDashboard(input as never);
      // Заявка из «Добавить» — тот же повод уведомить служителя, что и заявка из
      // чата с ботом (см. notifySafely выше): иначе её видно только зайдя в дашборд.
      const created = await requests.findById(id);
      if (created) await notifySafely(created);
      return id;
    },
    updateRequest: (id, patch) => requests.updateFromDashboard(id, patch as never),
    deleteRequest: (id) => requests.archive(id),
    setRequestStatus: (id, status, responsible, groupId) => requests.setStatus(id, status as never, responsible, groupId),
    updateGroup: async (id, input) => (await groups.update(id, input as never)) !== null,
    createCoordinator: async (input) => (await coordinators.create(input as never)).id,
    updateCoordinator: async (id, input) => (await coordinators.update(id, input as never)) !== null,
    deleteCoordinator: (id) => coordinators.archive(id),
    // Своего чата с ботом у такого участника нет: платформа тут условная, только
    // чтобы удовлетворить ограничение схемы. «дашборд» вместо id служителя — вход
    // там по паролю, а не по учётке конкретного человека.
    createRegistration: async (input) => {
      const created = await users.createManual({
        ...(input as ManualRegistrationInput), platform: 'telegram', byAdminId: 'дашборд',
      });
      // Тот же принцип, что и у бота (см. mdgRequestType, showSummary в fsm.ts):
      // ответ про малую группу заводит заявку служителю — иначе человек, которого
      // зарегистрировали вручную по ссылке /registration, для «Заявок» невидим,
      // хотя в боте та же анкета создала бы заявку сразу. И там, и здесь заявка
      // сразу же уходит уведомлением служителю в Telegram/MAX.
      const requestType = mdgRequestType((input as ManualRegistrationInput).mdgStatus);
      if (requestType) {
        const request = await requests.create(created.id, requestType, undefined, 'ui');
        await notifySafely(request);
      }
      return created.id;
    },
    // QR без диплинка: дашборд не знает, из какого он бота, а у зарегистрированного
    // тут человека чата с ботом всё равно нет. Служитель сканирует его своим
    // телефоном при выдаче набора — так же, как карточку регистрации из бота.
    registrationQr: async (id) => {
      const user = await users.findById(id);
      if (!user?.registration_no) return null;
      return qrPng(`Регистрация №${user.registration_no}`);
    },
    registrationCard: async (id) => {
      const user = await users.findById(id);
      if (!user?.registration_no) return null;
      return {
        registrationNo: user.registration_no,
        fullName: user.full_name,
        phone: user.phone,
        church: user.church,
        mdgStatus: user.mdg_status,
      };
    },
    deleteRegistration: (id) => users.delete(id),
    exportUsers: async () => usersToCsv(await users.exportRows()),
  });

  server.listen(port, () => logger.info({ port, sessionDays: ttlDays }, 'дашборд запущен'));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'дашборд останавливается');
    server.close();
    await store.close().catch(() => undefined);
    await db.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'дашборд не запустился');
  process.exit(1);
});
