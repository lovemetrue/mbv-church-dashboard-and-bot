import type { Pool } from 'pg';
import { AuditRepo } from '../db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { StaffRepo } from '../db/repos/staff.repo.js';
import { createStaffService } from '../platform/auth/staffService.js';
import type { Mailer } from '../platform/mail/mailer.js';
import { unconfiguredMailer } from '../platform/mail/mailer.js';
import type { SessionStore } from '../dashboard/sessions.js';
import { ErrorsRepo } from '../db/repos/errors.repo.js';
import { PromptsRepo } from '../db/repos/prompts.repo.js';
import { PlacementRepo } from '../db/repos/placement.repo.js';
import { SettingsRepo } from '../db/repos/settings.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo } from '../db/repos/users.repo.js';
import { createViewsSource, type ViewsSource } from './api/snapshot.js';
import { createSettings } from '../platform/settings/service.js';
import { realHealthSources, collectHealth } from '../platform/settings/health.js';
import { createFormMeta, createRecordCreator } from './create.js';
import { createRegistrar } from './registration.js';
import { createManager } from './manage.js';
import { createBotSettings } from './botSettings.js';
import { createMembers } from './members.js';
import { createReconciler } from './reconcile/service.js';
import { createStrange } from './strange.js';
import { MembersRepo } from '../db/repos/members.repo.js';
import { StrangeRepo } from '../db/repos/strange.repo.js';
import { createAssistant } from './assistant/service.js';
import { ChatHistoryRepo } from '../db/repos/chatHistory.repo.js';
import { createChat } from './assistant/chat.js';
import { createReadonlyRunner } from './assistant/readonly.js';
import { loadPseudonyms } from './assistant/pseudonyms.js';
import { HintsRepo } from '../db/repos/hints.repo.js';
import type { LlmClient } from '../platform/llm/deepseek.js';
import { requestsToCsv } from './export.js';
import { usersToCsv } from '../core/csv.js';
import { campaignStats } from '../dashboard/campaignStats.js';
import { CampaignRepo } from '../db/repos/campaign.repo.js';
import { DeliveriesRepo } from '../db/repos/deliveries.repo.js';
import type { ScheduleOptions } from '../broadcast/schedule.js';
import type { CampaignView } from './contracts.js';
import type { RequestWithUser } from '../db/repos/requests.repo.js';
import { createLoader } from './loader.js';
import { createMatching } from './matching/run.js';
import type { PlanEngineApi } from './plan/types.js';
import type { ExtraInvites } from '../core/extraInvites.js';

export interface ComposeOptions { defaultCapacity: number; ttlMs: number; timeZone?: string }

/**
 * Склейка сервиса: настоящая база + движок = готовые представления и подбор для новых заявок.
 * Читают они одним загрузчиком, поэтому подбор видит ровно то, что и список.
 *
 * Движок приходит параметром, а не импортируется внутри: тесты подставляют поддельный.
 */
export function composeService(db: Pool, engine: PlanEngineApi, opts: ComposeOptions & {
    pingSessions?: () => Promise<void>;
    /** Хранилище сессий нужно ограничению частоты запросов сброса пароля. */
    store?: SessionStore;
    mailer?: Mailer;
    /** Публичный адрес сервиса для ссылок в письмах (`HG_PUBLIC_URL`). */
    publicUrl?: string | null;
    /** Значение `EXTRA_QUESTIONS` из `.env`: показывается в настройках как «по умолчанию». */
    extraQuestionsEnv?: string;
    /** Языковая модель помощника; null — ключ не задан, функция выключена. */
    llm?: LlmClient | null;
    /** Расписание кампании «40 дней»: без него вкладка кампании недоступна. */
    campaignSchedule?: ScheduleOptions;
    /** Уведомление служителю о новой заявке (необязательно: без него заявки заводятся молча). */
    notify?: (request: RequestWithUser) => Promise<void>;
    /** Досылка новых вопросов зарегистрированным; нет её (боты не подключены) — кнопка в «Настройках» недоступна. */
    invites?: ExtraInvites;
    /** Сбросить кэш входа после изменения людей и режима. */
    onStaffChange?: () => void;
  }) {
  const placement = new PlacementRepo(db);
  const appSettings = new SettingsRepo(db);
  const load = createLoader({
    groups: new GroupsRepo(db),
    requests: new RequestsRepo(db),
    users: new UsersRepo(db),
    coordinators: new CoordinatorsRepo(db),
    placement,
    audit: new AuditRepo(db),
    settings: appSettings,
    hints: new HintsRepo(db),
    members: new MembersRepo(db),
    strange: new StrangeRepo(db),
  }, { ...(opts.timeZone ? { timeZone: opts.timeZone } : {}), assistantAvailable: (opts.llm ?? null) !== null });
  const viewOptions = { defaultCapacity: opts.defaultCapacity, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) };

  const views = createViewsSource({ load, engine, ttlMs: opts.ttlMs, views: viewOptions });
  const matching = createMatching({
    load, engine, placement, settings: appSettings, options: viewOptions, invalidate: () => views.invalidate(),
  });
  const errors = new ErrorsRepo(db);
  const assistant = createAssistant({
    load, engine, viewOptions, llm: opts.llm ?? null, hints: new HintsRepo(db), prompts: new PromptsRepo(db), settings: appSettings,
    audit: new AuditRepo(db), matching, invalidate: () => views.invalidate(),
    reportError: (source, err, context) => { void errors.record(source, err instanceof Error ? err.message : String(err), context); },
    roleReady: async () => {
      try {
        const { rows } = await db.query<{ ok: boolean }>(`SELECT pg_has_role(current_user, 'assistant_ro', 'USAGE') AS ok FROM pg_roles WHERE rolname = 'assistant_ro'`);
        return rows[0]?.ok === true;
      } catch {
        return false;
      }
    },
  });
  const chat = createChat({
    llm: opts.llm ?? null, settings: appSettings, audit: new AuditRepo(db), history: new ChatHistoryRepo(db), runQuery: createReadonlyRunner(db),
    pseudonyms: () => loadPseudonyms(db), capacity: opts.defaultCapacity,
    reportError: (source, err, context) => { void errors.record(source, err instanceof Error ? err.message : String(err), context); },
  });
  const settings = createSettings({
    audit: new AuditRepo(db),
    errors,
    prompts: new PromptsRepo(db),
    health: () => collectHealth(realHealthSources(db, opts.pingSessions ?? (async () => undefined))),
  });
  const staffRepo = new StaffRepo(db);
  const staff = createStaffService({
    staff: staffRepo,
    settings: appSettings,
    mailer: opts.mailer ?? unconfiguredMailer,
    // Без хранилища (в тестах) ограничение частоты не действует: счётчик каждый раз начинается заново.
    store: opts.store ?? { async set() {}, async get() { return null; }, async del() {}, async incr() { return 1; } },
    publicUrl: opts.publicUrl ?? null,
    ...(opts.onStaffChange ? { onChange: opts.onStaffChange } : {}),
    reportError: (source, err, context) => { void errors.record(source, err instanceof Error ? err.message : String(err), context); },
  });
  const requestsRepo = new RequestsRepo(db);
  const notify = opts.notify ?? (async () => undefined);
  const creator = createRecordCreator({ requests: requestsRepo, groups: new GroupsRepo(db), audit: new AuditRepo(db), notify });
  const registrar = createRegistrar({ users: new UsersRepo(db), requests: requestsRepo, audit: new AuditRepo(db), notify });
  const reconciler = createReconciler({ load, placement });
  const strange = createStrange({ repo: new StrangeRepo(db) });
  const members = createMembers({ members: new MembersRepo(db), audit: new AuditRepo(db) });
  const usersRepo = new UsersRepo(db);
  const manager = createManager({
    groups: new GroupsRepo(db), coordinators: new CoordinatorsRepo(db), requests: requestsRepo, users: usersRepo, audit: new AuditRepo(db),
  });
  // Кампания «40 дней» (только чтение): те же репозитории и тот же расчёт, что у бота и старого дашборда.
  const campaign = async (): Promise<CampaignView | null> => opts.campaignSchedule
    ? campaignStats({ users: usersRepo, requests: requestsRepo, campaign: new CampaignRepo(db), deliveries: new DeliveriesRepo(db) }, opts.campaignSchedule)
    : null;
  const exporter = {
    requests: async () => requestsToCsv((await views()).requests.items),
    people: async () => usersToCsv(await usersRepo.exportRows()),
  };
  const botSettings = createBotSettings({
    settings: appSettings, audit: new AuditRepo(db), envValue: opts.extraQuestionsEnv ?? 'off', ...(opts.invites ? { invites: opts.invites } : {}),
  });
  const auditRepo = new AuditRepo(db);
  const audit = (actor: string, action: string, after: unknown) => auditRepo.write(actor, action, 'export', null, after);
  const formMeta = createFormMeta(new CoordinatorsRepo(db));
  return { views, matching, placement, settings, errors, staff, staffRepo, appSettings, creator, registrar, manager, exporter, audit, campaign, botSettings, assistant, chat, members, reconciler, strange, formMeta };
}

export function composeViews(db: Pool, engine: PlanEngineApi, opts: ComposeOptions): ViewsSource {
  return composeService(db, engine, opts).views;
}

/** Настоящий движок плана: в бою он внедряется в сервис, в тестах сервера вместо него поддельный. */
export { engine } from './plan/index.js';
