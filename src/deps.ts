import type { Pool } from 'pg';
import type { Platform, PlatformName } from './core/platform.js';
import { AdminSessionsRepo } from './db/repos/adminSessions.repo.js';
import { MaintenanceRepo } from './db/repos/maintenance.repo.js';
import { CampaignRepo } from './db/repos/campaign.repo.js';
import { DeliveriesRepo } from './db/repos/deliveries.repo.js';
import { GroupsRepo } from './db/repos/groups.repo.js';
import { RequestsRepo } from './db/repos/requests.repo.js';
import { SessionsRepo } from './db/repos/sessions.repo.js';
import { UsersRepo } from './db/repos/users.repo.js';
import { BroadcastSender } from './broadcast/sender.js';
import { RateLimiter } from './broadcast/throttle.js';
import type { ScheduleOptions } from './broadcast/schedule.js';
import { logger as defaultLogger, type Logger } from './logger.js';

export interface DepsInput {
  db: Pool;
  platforms: Map<PlatformName, Platform>;
  /** Кто может выполнять админские команды, по платформам. */
  admins: Map<PlatformName, string[]>;
  schedule: ScheduleOptions;
  broadcastRate: number;
  /** Разрешена ли служителям кнопка очистки базы (только для тестов). */
  allowDbReset?: boolean;
  /** Сколько дней хранить закрытые заявки. */
  requestsRetentionDays?: number;
  /** Адрес дашборда: бот отправляет туда служителя за статистикой и заявками. */
  dashboardUrl?: string;
  logger?: Logger;
}

export interface Deps {
  db: Pool;
  users: UsersRepo;
  sessions: SessionsRepo;
  adminSessions: AdminSessionsRepo;
  requests: RequestsRepo;
  groups: GroupsRepo;
  campaign: CampaignRepo;
  deliveries: DeliveriesRepo;
  platforms: Map<PlatformName, Platform>;
  admins: Map<PlatformName, string[]>;
  schedule: ScheduleOptions;
  sender: BroadcastSender;
  maintenance: MaintenanceRepo;
  allowDbReset: boolean;
  requestsRetentionDays: number;
  dashboardUrl: string;
  logger: Logger;
  /** Исходные параметры: нужны, чтобы пересобрать зависимости (например, в тестах). */
  raw: DepsInput;
}

/** Собирает все зависимости бота в одном месте. */
export function createDeps(input: DepsInput): Deps {
  const { db, platforms, admins, schedule } = input;
  const logger = input.logger ?? defaultLogger;

  const users = new UsersRepo(db);
  const groups = new GroupsRepo(db);
  const deliveries = new DeliveriesRepo(db);

  // Свой ограничитель на каждую платформу: лимиты у них независимые.
  const limiters = new Map<PlatformName, RateLimiter>();
  for (const name of platforms.keys()) limiters.set(name, new RateLimiter(input.broadcastRate));

  const sender = new BroadcastSender({ deliveries, users, platforms, limiters, logger });

  return {
    db,
    users,
    sessions: new SessionsRepo(db),
    adminSessions: new AdminSessionsRepo(db),
    requests: new RequestsRepo(db),
    groups,
    campaign: new CampaignRepo(db),
    deliveries,
    platforms,
    admins,
    schedule,
    sender,
    maintenance: new MaintenanceRepo(db),
    allowDbReset: input.allowDbReset ?? false,
    requestsRetentionDays: input.requestsRetentionDays ?? 90,
    dashboardUrl: input.dashboardUrl ?? 'https://bloodofjesus.ru/groups',
    logger,
    raw: input,
  };
}
