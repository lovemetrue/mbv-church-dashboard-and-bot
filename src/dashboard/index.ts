import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo, type ManualRegistrationInput } from '../db/repos/users.repo.js';
import { usersToCsv } from '../core/csv.js';
import { campaignStats } from './campaignStats.js';
import { CampaignRepo } from '../db/repos/campaign.repo.js';
import { DeliveriesRepo } from '../db/repos/deliveries.repo.js';
import { createPool } from '../db/pool.js';
import { qrPng } from '../core/qr.js';
import { RedisSessionStore } from './redisStore.js';
import { createDashboardServer } from './server.js';
import { SessionService } from './sessions.js';
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
    }),
    deleteGroup: async (id) => (await groups.archive(id)) !== null,
    // Что заведено в дашборде, помечается source='ui': видно, откуда взялась запись,
    // и импорт выгрузки такие строки не затирает.
    createGroup: async (input) => (await groups.create(input as never, 'ui')).id,
    createRequest: (input) => requests.createFromDashboard(input as never),
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
    createRegistration: async (input) =>
      (await users.createManual({ ...(input as ManualRegistrationInput), platform: 'telegram', byAdminId: 'дашборд' })).id,
    // QR без диплинка: дашборд не знает, из какого он бота, а у зарегистрированного
    // тут человека чата с ботом всё равно нет. Служитель сканирует его своим
    // телефоном при выдаче набора — так же, как карточку регистрации из бота.
    registrationQr: async (id) => {
      const user = await users.findById(id);
      if (!user?.registration_no) return null;
      return qrPng(`Регистрация №${user.registration_no}`);
    },
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
