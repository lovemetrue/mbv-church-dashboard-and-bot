import { createPool } from '../db/pool.js';
import { RedisSessionStore } from '../dashboard/redisStore.js';
import { SessionService } from '../dashboard/sessions.js';
import { logger } from '../logger.js';
import { createActions } from './actions.js';
import { SettingsRepo } from '../db/repos/settings.repo.js';
import { StaffRepo } from '../db/repos/staff.repo.js';
import { PersonalAuth } from '../platform/auth/personalAuth.js';
import { mailerFromEnv } from '../platform/mail/mailer.js';
import { composeService, engine } from './composition.js';
import { startAutoMatching } from './matching/scheduler.js';
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
  const sessions = new SessionService(store, {
    password, login,
    superPassword, superLogin,
    ttlSeconds, maxAttempts: 5,
  });
  // Общие входы плюс личные: пока режим личных входов выключен, работает ровно то же, что и раньше.
  const auth = new PersonalAuth(sessions, store, new StaffRepo(db), new SettingsRepo(db), {
    sharedLogin: login, sharedSuperLogin: superLogin,
  });

  // План считается не чаще раза в десять секунд на всех посетителей разом.
  const { views, matching, placement, settings, errors, staff } = composeService(db, engine, {
    defaultCapacity, ttlMs: 10_000, timeZone: env('TIMEZONE', 'Europe/Moscow'),
    store,
    // Почта и публичный адрес необязательны: без них ссылки на пароль показываются администратору на экране.
    mailer: mailerFromEnv(process.env),
    publicUrl: process.env['HG_PUBLIC_URL']?.trim() || null,
    onStaffChange: () => auth.invalidate(),
    // Живое обращение к хранилищу входов: ответ не важен, важно, что оно отвечает.
    pingSessions: async () => { await store.get('health:ping'); },
  });
  const reportError = (source: string, err: unknown, context: string): void => {
    void errors.record(source, err instanceof Error ? err.message : String(err), context);
  };

  const server = createHomeGroupsServer({
    auth,
    staff,
    views,
    actions: createActions(placement, { defaultCapacity }),
    matching,
    settings,
    reportError,
    invalidateViews: () => views.invalidate(),
    actorName: (role) => (role === 'super' ? superLogin : login),
    sessionTtlSeconds: ttlSeconds,
    secureCookie: env('DASHBOARD_COOKIE_SECURE', 'true') !== 'false',
    webDir: env('HG_WEB_DIR', '/app/web-dist'),
  });

  // Автоматический подбор: переключатель в базе читается на каждом проходе, поэтому включается без перезапуска.
  const autoSeconds = Number(env('HG_AUTOMATCH_SECONDS', '120'));
  if (!Number.isInteger(autoSeconds) || autoSeconds < 30) throw new Error('HG_AUTOMATCH_SECONDS должна быть целым числом не меньше 30');
  const auto = startAutoMatching({ intervalMs: autoSeconds * 1000, isEnabled: () => matching.isAuto(), run: (actor) => matching.run(actor),
    onError: (err) => reportError('подбор', err, 'автоматический запуск') });

  server.listen(port, () => logger.info({ port, sessionDays: ttlDays, defaultCapacity }, 'домашние группы запущены'));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'домашние группы останавливаются');
    auto.stop();
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
