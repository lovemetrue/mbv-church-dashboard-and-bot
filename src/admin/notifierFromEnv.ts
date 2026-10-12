import type { Pool } from 'pg';
import { TelegramAdapter } from '../adapters/telegram.adapter.js';
import { MaxAdapter } from '../adapters/max.adapter.js';
import type { Platform, PlatformName } from '../core/platform.js';
import type { ScheduleOptions } from '../broadcast/schedule.js';
import type { RequestWithUser } from '../db/repos/requests.repo.js';
import { createDeps, type Deps } from '../deps.js';
import { logger } from '../logger.js';
import { splitAdminIds } from './access.js';
import { dashboardLink, requestLinkBuilder } from './links.js';
import { AdminNotifier } from './notify.js';

const readEnv = (env: NodeJS.ProcessEnv, name: string, fallback: string): string => env[name]?.trim() || fallback;

/**
 * Уведомление служителю о заявке для сервисов, которые сами заявки заводят (старый дашборд и «Домашние группы»).
 *
 * Дашборд и бот — один образ с общим `.env` (см. docker-compose.yml), поэтому токены и `ADMIN_IDS`
 * те же самые. Опрос платформ (`bot.start()`) при этом не запускаем: заявки тут не принимают,
 * а второй опрос одного и того же бота дрался бы с настоящим.
 *
 * Возвращает функцию, которая не бросает: уведомление не должно ронять сохранение заявки —
 * участнику важнее, чем служителю.
 */
export function notifierFromEnv(
  db: Pool,
  env: NodeJS.ProcessEnv,
  schedule: ScheduleOptions,
  service: string,
): (request: RequestWithUser) => Promise<void> {
  return serviceFromEnv(db, env, schedule, service).notify;
}

/**
 * То же, но вместе с собранными зависимостями: «Домашним группам» они нужны ещё и для кнопки «дослать вопросы»
 * (те же платформы, та же отправка с ограничением частоты, что у бота), и второй набор клиентов строить незачем.
 */
export function serviceFromEnv(
  db: Pool,
  env: NodeJS.ProcessEnv,
  schedule: ScheduleOptions,
  service: string,
): { notify: (request: RequestWithUser) => Promise<void>; deps: Deps } {
  const platforms = new Map<PlatformName, Platform>();
  const admins = new Map<PlatformName, string[]>();
  for (const name of readEnv(env, 'ENABLED_PLATFORMS', 'telegram').split(',').map((s) => s.trim().toLowerCase())) {
    if (name !== 'telegram' && name !== 'max') continue;
    const token = readEnv(env, name === 'telegram' ? 'BOT_TOKEN_TELEGRAM' : 'BOT_TOKEN_MAX', '');
    // Токен бот уже проверил на своём старте — если его нет, молча не уведомляем
    // этой платформой, а не роняем из-за этого весь сервис.
    if (!token) continue;
    platforms.set(
      name,
      name === 'telegram'
        ? new TelegramAdapter(token)
        : new MaxAdapter(token, logger, readEnv(env, 'MAX_API_URL', 'https://platform-api.max.ru')),
    );
    admins.set(name, splitAdminIds(readEnv(env, name === 'telegram' ? 'ADMIN_IDS_TELEGRAM' : 'ADMIN_IDS_MAX', '').split(',')).ids);
  }
  const requestUrl = requestLinkBuilder(env['HG_PUBLIC_URL']);
  const deps = createDeps({
    db, platforms, admins, schedule, broadcastRate: 20,
    dashboardUrl: dashboardLink(env['HG_PUBLIC_URL'], readEnv(env, 'DASHBOARD_URL', 'http://5.23.48.25:8090/groups')),
    extraQuestions: readEnv(env, 'EXTRA_QUESTIONS', 'off'),
    ...(requestUrl ? { requestUrl } : {}),
  });
  const notifier = new AdminNotifier(deps);
  // Без этой строки в логе не отличить «уведомления настроены, но не доходят» от
  // «сервис вообще не увидел токены/ADMIN_IDS» — второе тихо проходит мимо.
  if (notifier.hasAdmins()) {
    logger.info({ platforms: [...platforms.keys()] }, `${service}: уведомления о заявках служителю включены`);
  } else {
    logger.warn(`${service}: ADMIN_IDS/токен платформы не заданы — заявки, заведённые здесь, никого не уведомят`);
  }

  const notify = async (request: RequestWithUser): Promise<void> => {
    try {
      await notifier.notifyRequest(request);
    } catch (err) {
      logger.error({ err: (err as Error).message, requestId: request.id }, `${service}: не удалось уведомить служителя о заявке`);
    }
  };
  return { notify, deps };
}
