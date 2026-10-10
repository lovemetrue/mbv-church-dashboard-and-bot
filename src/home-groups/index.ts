import { createPool } from '../db/pool.js';
import { RedisSessionStore } from '../dashboard/redisStore.js';
import { SessionService } from '../dashboard/sessions.js';
import { logger } from '../logger.js';
import { PlacementRepo } from '../db/repos/placement.repo.js';
import { createActions } from './actions.js';
import { composeViews, engine } from './composition.js';
import { createHomeGroupsServer } from './server.js';

const env = (name: string, fallback?: string): string => {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Не задана переменная окружения ${name}`);
};

/**
 * Сервис «Домашние группы»: свой контейнер, свой порт, корень сайта — сам сервис.
 *
 * От старого дашборда отличается тем, что бот-платформы и уведомления ему не нужны. Пишет он в
 * базу только действиями координатора над заявками (`actions.ts`), каждое — с записью в журнал. Пароли и Redis те же — один вход на оба сервиса, но с разными куками.
 * Новых обязательных переменных нет: всё, чего не задано, берётся из значений по умолчанию.
 */
async function main(): Promise<void> {
  const password = env('DASHBOARD_PASSWORD');
  if (password.length < 8) throw new Error('DASHBOARD_PASSWORD короче восьми символов');
  // Без отдельного пароля обычный вход получил бы все права (см. SessionService.roleFor):
  // лучше не стартовать, чем молча открыть полный доступ.
  const superPassword = env('DASHBOARD_SUPER_PASSWORD');
  if (superPassword === password) throw new Error('DASHBOARD_SUPER_PASSWORD совпадает с DASHBOARD_PASSWORD');

  const port = Number(env('HG_PORT', '8092'));
  const ttlDays = Number(env('DASHBOARD_SESSION_DAYS', '30'));
  const ttlSeconds = Math.round(ttlDays * 86400);
  const defaultCapacity = Number(env('HG_DEFAULT_CAPACITY', '10'));
  if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1) {
    throw new Error('HG_DEFAULT_CAPACITY должна быть целым числом не меньше 1');
  }

  const store = new RedisSessionStore(env('REDIS_URL', 'redis://valkey:6379/0'));
  await store.connect();
  const db = createPool(env('DATABASE_URL'));

  const login = env('DASHBOARD_LOGIN', 'mbv_admin');
  const superLogin = env('DASHBOARD_SUPER_LOGIN', 'super_mbv_admin');
  const auth = new SessionService(store, {
    password, login,
    superPassword, superLogin,
    ttlSeconds, maxAttempts: 5,
  });

  // План считается не чаще раза в десять секунд на всех посетителей разом.
  const views = composeViews(db, engine, { defaultCapacity, ttlMs: 10_000, timeZone: env('TIMEZONE', 'Europe/Moscow') });

  const server = createHomeGroupsServer({
    auth,
    views,
    actions: createActions(new PlacementRepo(db), { defaultCapacity }),
    invalidateViews: () => views.invalidate(),
    actorName: (role) => (role === 'super' ? superLogin : login),
    sessionTtlSeconds: ttlSeconds,
    secureCookie: env('DASHBOARD_COOKIE_SECURE', 'true') !== 'false',
    webDir: env('HG_WEB_DIR', '/app/web-dist'),
  });

  server.listen(port, () => logger.info({ port, sessionDays: ttlDays, defaultCapacity }, 'домашние группы запущены'));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'домашние группы останавливаются');
    server.close();
    await store.close().catch(() => undefined);
    await db.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'домашние группы не запустились');
  process.exit(1);
});
