import { MaxAdapter } from './adapters/max.adapter.js';
import { TelegramAdapter } from './adapters/telegram.adapter.js';
import { CampaignScheduler } from './broadcast/scheduler.js';
import { splitAdminIds } from './admin/access.js';
import { adminIds, loadConfig } from './config.js';
import { Router } from './core/router.js';
import type { Platform, PlatformName } from './core/platform.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createDeps } from './deps.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = createPool(cfg.DATABASE_URL);

  const applied = await runMigrations(db);
  logger.info({ applied: applied.length }, 'схема базы актуальна');

  // Адаптеры поднимаются только для платформ из ENABLED_PLATFORMS:
  // MAX можно включить позже, когда выдадут токен, не меняя код.
  const platforms = new Map<PlatformName, Platform>();
  for (const name of cfg.ENABLED_PLATFORMS) {
    platforms.set(
      name,
      name === 'telegram'
        ? new TelegramAdapter(cfg.BOT_TOKEN_TELEGRAM)
        : new MaxAdapter(cfg.BOT_TOKEN_MAX, logger, cfg.MAX_API_URL),
    );
  }

  const admins = new Map<PlatformName, string[]>();
  for (const name of cfg.ENABLED_PLATFORMS) {
    const { ids, invalid } = splitAdminIds(adminIds(cfg, name));
    admins.set(name, ids);
    // Бот при этом продолжает работать: регистрация участников важнее уведомлений служителям.
    if (invalid.length > 0) {
      logger.error(
        { platform: name, entries: invalid },
        'ADMIN_IDS: нужен числовой id, а не username. Такие записи пропущены, ' +
          'уведомления по ним не пойдут. Узнать свой id: команда /whoami в боте',
      );
    }
  }
  if ([...admins.values()].every((ids) => ids.length === 0)) {
    logger.warn('ADMIN_IDS не заданы: заявки участников никому не придут. Узнать свой id: команда /whoami');
  }

  const deps = createDeps({
    db,
    platforms,
    admins,
    schedule: {
      startDate: cfg.CAMPAIGN_START_DATE,
      broadcastTime: cfg.BROADCAST_TIME,
      totalDays: cfg.CAMPAIGN_DAYS,
      timezone: cfg.TIMEZONE,
    },
    broadcastRate: cfg.BROADCAST_RATE,
    allowDbReset: cfg.ALLOW_DB_RESET,
    requestsRetentionDays: cfg.REQUESTS_RETENTION_DAYS,
    dashboardUrl: cfg.DASHBOARD_URL,
    logger,
  });

  const router = new Router(deps);
  for (const platform of platforms.values()) {
    platform.onUpdate((update) => router.handle(update));
    await platform.start();
  }

  // Рассылки, не доехавшие до конца из-за остановки процесса, доходят при старте.
  const resumed = await deps.sender.resumeUnfinished();
  if (resumed.length > 0) logger.info({ broadcasts: resumed.length }, 'незавершённые рассылки досланы');

  const scheduler = new CampaignScheduler(deps);
  scheduler.start();

  logger.info(
    {
      platforms: [...platforms.keys()],
      campaignStart: cfg.CAMPAIGN_START_DATE,
      broadcastTime: `${cfg.BROADCAST_TIME} ${cfg.TIMEZONE}`,
    },
    'бот запущен',
  );

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'останавливаюсь');
    scheduler.stop();
    for (const platform of platforms.values()) {
      await platform.stop().catch((err) => logger.warn({ err }, 'ошибка остановки адаптера'));
    }
    await db.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'бот не запустился');
  process.exit(1);
});
