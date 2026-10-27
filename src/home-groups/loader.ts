import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { HintsRepo } from '../db/repos/hints.repo.js';
import type { MembersRepo } from '../db/repos/members.repo.js';
import type { GeocodeRepo } from '../db/repos/geocode.repo.js';
import type { GroupsRepo } from '../db/repos/groups.repo.js';
import type { PlacementRepo } from '../db/repos/placement.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { StrangeRepo } from '../db/repos/strange.repo.js';
import type { GendersRepo } from '../db/repos/genders.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ViewsInput } from './api/views.js';

export interface LoaderRepos {
  groups: Pick<GroupsRepo, 'forDashboard'>;
  requests: Pick<RequestsRepo, 'forDashboard'>;
  users: Pick<UsersRepo, 'listRegistered'>;
  coordinators: Pick<CoordinatorsRepo, 'listActive'>;
  placement: Pick<PlacementRepo, 'rejectedGroups' | 'activeProposals' | 'restorableProposals' | 'placedSinceFeedback'>;
  settings: Pick<SettingsRepo, 'get'>;
  audit: Pick<AuditRepo, 'requestEntries' | 'activitySince'>;
  hints: Pick<HintsRepo, 'all'>;
  members: Pick<MembersRepo, 'all' | 'allPersons'>;
  /** Метки «Странный человек»; без репозитория (в тестах) меток нет. */
  strange?: Pick<StrangeRepo, 'all'>;
  /** Пол, поставленный вручную или моделью; без репозитория (в тестах) пол только из ФИО. */
  genders?: Pick<GendersRepo, 'all'>;
  /** Кэш координат адресов; без него (в тестах) подбор сравнивает улицы по названию. */
  geocode?: Pick<GeocodeRepo, 'all'>;
}

/**
 * Читает всё нужное сервису одним заходом. SQL здесь нет: только существующие репозитории
 * (тот же слой, что у старого дашборда), поэтому архивные записи и закрытые поля отсекаются там же.
 */
export function createLoader(repos: LoaderRepos, opts: { timeZone?: string; assistantAvailable?: boolean | (() => Promise<boolean>) } = {}): () => Promise<ViewsInput> {
  return async () => {
    const [groups, requests, participants, coordinators, rejectedGroups, audit, activity, activeProposals, restorable, placedNew, auto, lastRun, hints, assistantEnabled, members, persons] = await Promise.all([
      repos.groups.forDashboard(),
      repos.requests.forDashboard(),
      repos.users.listRegistered(),
      repos.coordinators.listActive(),
      repos.placement.rejectedGroups(),
      repos.audit.requestEntries(),
      repos.audit.activitySince(7),
      repos.placement.activeProposals(),
      repos.placement.restorableProposals(),
      repos.placement.placedSinceFeedback(opts.timeZone),
      repos.settings.get<boolean>('matching.auto'),
      repos.settings.get<NonNullable<ViewsInput['matching']>['lastRun']>('matching.last_run'),
      repos.hints.all(),
      repos.settings.get<boolean>('assistant.enabled'),
      repos.members.all(),
      repos.members.allPersons(),
    ]);
    const strange = repos.strange ? await repos.strange.all() : undefined;
    const geo = repos.geocode ? await repos.geocode.all() : undefined;
    const genders = repos.genders ? await repos.genders.all() : undefined;
    return {
      strange, geo, genders,
      groups, requests, participants, coordinators, rejectedGroups, audit, activity, activeProposals, restorable, placedNew,
      matching: { auto: auto === true, lastRun: lastRun ?? null },
      hints,
      members,
      persons,
      assistant: { available: (typeof opts.assistantAvailable === 'function' ? await opts.assistantAvailable() : opts.assistantAvailable) === true, enabled: assistantEnabled === true },
    };
  };
}
